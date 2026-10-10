-- =====================================================================================
-- AutoFlow production hardening, part 7: AI usage helpers, internal secrets, the document
-- sweep and the database cron.
-- =====================================================================================

-- settings the edge functions read from Vault (function secrets win when both are set)
CREATE OR REPLACE FUNCTION public.get_ai_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(s.name, s.decrypted_secret), '{}'::jsonb)
  FROM vault.decrypted_secrets s
  WHERE s.name IN ('OPENROUTER_API_KEY', 'AI_MODELS', 'AI_ESCALATION_MODELS', 'AI_DATA_COLLECTION', 'AI_ZDR', 'APP_URL',
                   'ALLOWED_ORIGINS', 'AI_MAX_CALLS_PER_DEAL_DAY')
$$;

-- Vault secrets for AutoFlow's own plumbing; only names starting with INTERNAL_ (service role only)
CREATE OR REPLACE FUNCTION public.get_internal_secret(_name text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.decrypted_secret FROM vault.decrypted_secrets s
  WHERE starts_with(_name, 'INTERNAL_') AND s.name = _name
  LIMIT 1
$$;

-- AI requests logged for a deal in the last 24 hours (the per-deal daily cap)
CREATE OR REPLACE FUNCTION public.ai_calls_today(_deal_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.ai_usage
  WHERE deal_id = _deal_id AND created_at > now() - interval '24 hours'
$$;

-- ---------------------------------------------------------------- sweep (every 10 minutes)
-- 1. A document "processing" for more than 15 minutes was left by a run that died: it becomes
--    failed and due for a retry now (or for staff, once its 5 attempts are used).
-- 2. Deals waiting in Document Review whose documents are settled (e.g. an upload that was
--    never read within 30 minutes) are re-checked, so their requests open / they move on.
CREATE OR REPLACE FUNCTION public.sweep_documents()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _failed integer;
  _checked integer := 0;
  _deal uuid;
BEGIN
  WITH stuck AS (
    UPDATE public.documents
       SET processing_status = 'failed',
           next_attempt_at = CASE WHEN attempt_count < 5 THEN now() END,
           processing_error = CASE WHEN attempt_count < 5
                                   THEN 'Couldn''t be read automatically yet — AutoFlow will retry.'
                                   ELSE 'Couldn''t be read automatically — staff will review it.' END
     WHERE processing_status = 'processing'
       AND coalesce(processing_started_at, created_at) < now() - interval '15 minutes'
    RETURNING id
  )
  SELECT count(*) INTO _failed FROM stuck;

  FOR _deal IN
    SELECT d.id FROM public.deals d
    WHERE d.status = 'document_review' AND public.deal_documents_settled(d.id)
    ORDER BY d.created_at
  LOOP
    PERFORM public.autoroute_deal(_deal);
    _checked := _checked + 1;
  END LOOP;
  RETURN jsonb_build_object('failed', _failed, 'checked', _checked);
END $$;

-- ---------------------------------------------------------------- retry call (every 5 minutes)
-- POST <INTERNAL_FUNCTIONS_URL>/process-document {"retryDue": true} with the header
-- x-autoflow-internal: <INTERNAL_CRON_SECRET>. Quietly does nothing when either Vault value
-- or pg_net is missing.
CREATE OR REPLACE FUNCTION public.cron_retry_documents()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _url text := public.get_internal_secret('INTERNAL_FUNCTIONS_URL');
  _secret text := public.get_internal_secret('INTERNAL_CRON_SECRET');
BEGIN
  IF coalesce(btrim(_url), '') = '' OR coalesce(_secret, '') = '' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'net' AND p.proname = 'http_post') THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3)'
    USING rtrim(btrim(_url), '/') || '/process-document',
          '{"retryDue": true}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-autoflow-internal', _secret);
END $$;

-- ---------------------------------------------------------------- schedule (only where pg_cron exists)
-- On Supabase: pg_cron + pg_net. A database without them (local tests) migrates unchanged.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  EXCEPTION WHEN others THEN RAISE NOTICE 'pg_net not available: %', SQLERRM;
  END;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  EXCEPTION WHEN others THEN RAISE NOTICE 'pg_cron not available: %', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $c$SELECT cron.schedule('autoflow-sweep-documents', '*/10 * * * *', 'SELECT public.sweep_documents()')$c$;
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        EXECUTE $c$SELECT cron.schedule('autoflow-retry-documents', '*/5 * * * *', 'SELECT public.cron_retry_documents()')$c$;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'AutoFlow cron jobs were not scheduled: %', SQLERRM;
    END;
  END IF;
END $$;
