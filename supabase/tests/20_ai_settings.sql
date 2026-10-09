-- AI settings in the vault are readable by the edge functions (service role) only.
\set QUIET on
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', _what; END IF;
  RAISE NOTICE 'ok - %', _what;
END $$;
SET client_min_messages = notice;

INSERT INTO vault.decrypted_secrets VALUES
  ('OPENROUTER_API_KEY', 'test-key'), ('AI_MODELS', 'a/one,b/two'), ('UNRELATED_SECRET', 'nope')
ON CONFLICT (name) DO UPDATE SET decrypted_secret = excluded.decrypted_secret;

SET ROLE service_role;
SELECT pg_temp.check((public.get_ai_settings() ->> 'OPENROUTER_API_KEY') = 'test-key', 'the edge functions can read the AI key from the vault');
SELECT pg_temp.check(public.get_ai_settings() ? 'AI_MODELS' AND NOT public.get_ai_settings() ? 'UNRELATED_SECRET',
                     'only AI settings are exposed, not other vault secrets');
RESET ROLE;

DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM public.get_ai_settings();
  RAISE EXCEPTION 'FAILED: a signed-in user could read the AI settings';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok - signed-in users cannot read the AI settings';
END $$;
RESET ROLE;
DO $$
BEGIN
  SET LOCAL ROLE anon;
  PERFORM public.get_ai_settings();
  RAISE EXCEPTION 'FAILED: anonymous visitors could read the AI settings';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok - anonymous visitors cannot read the AI settings';
END $$;
RESET ROLE;
DELETE FROM vault.decrypted_secrets;
SELECT 'ai settings: all checks passed';
