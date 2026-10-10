-- =====================================================================================
-- AutoFlow production hardening, part 5: audit log.
--
-- public.audit_log gets one row per change to the key tables: who (auth.uid(), NULL for the
-- system), which table and row, INSERT/UPDATE/DELETE, and changed = {column: [old, new]} for
-- the watched columns that changed. For customers only the names of the changed columns are
-- kept ({column: "changed"}), never the personal values. Append-only for everyone; admins read it.
-- =====================================================================================

-- TG_ARGV: [0] the row-id column, [1] 'values' or 'names', [2..] watched columns (none = all)
CREATE OR REPLACE FUNCTION public.trg_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id_col text := TG_ARGV[0];
  _names_only boolean := TG_ARGV[1] = 'names';
  _cols text[] := CASE WHEN TG_NARGS > 2 THEN TG_ARGV[2:TG_NARGS - 1] ELSE '{}'::text[] END;
  _old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  _new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  _changed jsonb := '{}'::jsonb;
  _c text;
BEGIN
  FOR _c IN
    SELECT k FROM jsonb_object_keys(coalesce(_new, _old)) AS k
    WHERE (cardinality(_cols) = 0 OR k = ANY (_cols))
      AND k NOT IN ('id', 'created_at', 'updated_at', 'search_text')
    ORDER BY k
  LOOP
    IF TG_OP = 'UPDATE' AND (_old -> _c) IS NOT DISTINCT FROM (_new -> _c) THEN CONTINUE; END IF;
    IF TG_OP = 'INSERT' AND coalesce(_new -> _c, 'null'::jsonb) = 'null'::jsonb THEN CONTINUE; END IF;
    IF TG_OP = 'DELETE' AND coalesce(_old -> _c, 'null'::jsonb) = 'null'::jsonb THEN CONTINUE; END IF;
    _changed := _changed || jsonb_build_object(_c,
      CASE WHEN _names_only THEN to_jsonb('changed'::text)
           ELSE jsonb_build_array(coalesce(_old -> _c, 'null'::jsonb), coalesce(_new -> _c, 'null'::jsonb)) END);
  END LOOP;

  IF TG_OP = 'UPDATE' AND _changed = '{}'::jsonb THEN RETURN NULL; END IF;
  INSERT INTO public.audit_log (actor, table_name, row_id, action, changed)
  VALUES (auth.uid(), TG_TABLE_NAME, coalesce(_new, _old) ->> _id_col, TG_OP, nullif(_changed, '{}'::jsonb));
  RETURN NULL;
END $$;

-- nobody updates or deletes audit rows (the API roles have no privileges either)
CREATE OR REPLACE FUNCTION public.trg_audit_log_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS audit_log_append_only ON public.audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log_append_only();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_audit_log_append_only();

DROP POLICY IF EXISTS "Admins can read the audit log" ON public.audit_log;
CREATE POLICY "Admins can read the audit log" ON public.audit_log FOR SELECT TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- ---------------------------------------------------------------- what is audited
DROP TRIGGER IF EXISTS audit_deals ON public.deals;
CREATE TRIGGER audit_deals AFTER INSERT OR UPDATE OR DELETE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit('id', 'values',
    'status', 'dealer_id', 'loan_amount', 'down_payment', 'apr', 'term_months', 'monthly_payment',
    'credit_decision', 'credit_decision_by', 'credit_decision_at', 'credit_decision_notes', 'credit_conditions',
    'credit_score', 'credit_tier', 'credit_bureau',
    'funding_checklist', 'funding_approved_at', 'funding_approved_by', 'funded_at', 'funded_amount', 'funded_by',
    'decision_by', 'decision_at', 'decision_notes', 'dealer_message');

DROP TRIGGER IF EXISTS audit_customers ON public.customers;
CREATE TRIGGER audit_customers AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit('id', 'names');

DROP TRIGGER IF EXISTS audit_income_sources ON public.income_sources;
CREATE TRIGGER audit_income_sources AFTER INSERT OR UPDATE OR DELETE ON public.income_sources
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit('id', 'values',
    'deal_id', 'source_type', 'stated_monthly_income', 'calculated_monthly_income', 'calc_method', 'gross_per_period',
    'pay_frequency', 'hourly_rate', 'hours_per_week', 'contract_months', 'tip_percentage', 'ytd_gross', 'ytd_months',
    'manual_override_amount', 'manual_override_reason', 'benefit_cap_applied', 'vehicle_for_work',
    'verification_status', 'verified_by', 'calc_locked');

DROP TRIGGER IF EXISTS audit_documents ON public.documents;
CREATE TRIGGER audit_documents AFTER UPDATE OF type, status OR DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit('id', 'values', 'deal_id', 'name', 'storage_path', 'type', 'status');

DROP TRIGGER IF EXISTS audit_user_roles ON public.user_roles;
CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit('user_id', 'values', 'role');

DROP TRIGGER IF EXISTS audit_dealer_users ON public.dealer_users;
CREATE TRIGGER audit_dealer_users AFTER INSERT OR UPDATE OR DELETE ON public.dealer_users
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit('user_id', 'values', 'dealer_id');

DROP TRIGGER IF EXISTS audit_profiles ON public.profiles;
CREATE TRIGGER audit_profiles AFTER UPDATE OF is_active, name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit('user_id', 'values', 'is_active', 'name');

DROP TRIGGER IF EXISTS audit_app_settings ON public.app_settings;
CREATE TRIGGER audit_app_settings AFTER UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit('id', 'values',
    'automations', 'required_documents', 'funding_checklist_items', 'preferences');
