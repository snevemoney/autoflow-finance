-- Who can call which database function through the API.
\set QUIET on
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', _what; END IF;
  RAISE NOTICE 'ok - %', _what;
END $$;
SET client_min_messages = notice;

SELECT pg_temp.check(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f' AND has_function_privilege('anon', p.oid, 'execute')),
  'visitors who are not signed in cannot call any database function');
SELECT pg_temp.check(has_function_privilege('authenticated', 'public.deal_checklist(uuid)', 'execute')
  AND has_function_privilege('authenticated', 'public.submit_deal(jsonb)', 'execute')
  AND has_function_privilege('authenticated', 'public.is_staff(uuid)', 'execute'),
  'signed-in users can call the app actions and the access-rule helpers');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.autoroute_deal(uuid)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.next_deal_status(public.deals)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.get_ai_settings()', 'execute'),
  'internal routing and settings functions are not callable from the app');
SELECT pg_temp.check(has_function_privilege('service_role', 'public.autoroute_deal(uuid)', 'execute')
  AND has_function_privilege('service_role', 'public.get_ai_settings()', 'execute'),
  'the edge functions (service role) can call everything');
SELECT 'function access: all checks passed';
