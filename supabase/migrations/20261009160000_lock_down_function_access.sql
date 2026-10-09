-- Postgres lets everyone (PUBLIC) execute a new function, so revoking from anon alone left
-- these callable without signing in. Remove PUBLIC/anon/authenticated access from every
-- function in public, then grant signed-in users only what the app calls and the helpers the
-- access rules use. Calls from triggers and other SECURITY DEFINER functions run as the
-- function owner, so the automations are unaffected.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- what the app calls (each checks the caller's role itself)
GRANT EXECUTE ON FUNCTION public.deal_checklist(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_deal(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_document(uuid, public.document_type, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_missing_documents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_credit_decision(uuid, text, text, integer, public.credit_tier, public.credit_bureau) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_funding_checklist(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_funding(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_funded(uuid, numeric) TO authenticated;

-- used inside the row-level security rules, which run as the signed-in user
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_deal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_document_path(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_dealer_id() TO authenticated;

-- pure label lookups, used by the status trigger that runs as the signed-in user
GRANT EXECUTE ON FUNCTION public.document_type_label(public.document_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deal_status_label(public.deal_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.status_department(public.deal_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.department_role(public.department) TO authenticated;

-- functions added later are not callable by everyone unless granted on purpose
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- fixed search path on the small label helpers
ALTER FUNCTION public.document_type_label(public.document_type) SET search_path = public;
ALTER FUNCTION public.deal_status_label(public.deal_status) SET search_path = public;
ALTER FUNCTION public.status_department(public.deal_status) SET search_path = public;
ALTER FUNCTION public.department_role(public.department) SET search_path = public;

-- the one-time import rule above is retired (allows nothing)
ALTER POLICY "temp import pay stub" ON storage.objects WITH CHECK (false);
