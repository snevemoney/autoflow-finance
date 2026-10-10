-- =====================================================================================
-- AutoFlow production hardening, last part: who may call which database function.
-- Every function in public: nobody but the service role, then signed-in users get exactly
-- the app's actions and the helpers that row-level rules and guard triggers call as them.
-- =====================================================================================
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

-- app actions (each checks the caller itself)
GRANT EXECUTE ON FUNCTION public.deal_checklist(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_deal(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_document(uuid, public.document_type, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_missing_documents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_credit_decision(uuid, text, text, integer, public.credit_tier, public.credit_bureau, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_credit_condition(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_funding_checklist(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_funding(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_funded(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_deal(uuid, public.deal_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_deal(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_document(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_access(uuid, public.app_role, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.queue_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_metrics(date, date) TO authenticated;

-- used by row-level rules and by guard triggers that run as the signed-in user
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_deal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_document_path(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_dealer_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_exists() TO authenticated;
GRANT EXECUTE ON FUNCTION public.clean_text(text, text, integer, boolean) TO authenticated;

-- pure label lookups, used by the status trigger
GRANT EXECUTE ON FUNCTION public.document_type_label(public.document_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deal_status_label(public.deal_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.status_department(public.deal_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.department_role(public.department) TO authenticated;
