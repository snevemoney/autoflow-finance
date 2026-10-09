-- AI settings (OpenRouter key and model chains) can be stored in Supabase Vault, encrypted
-- at rest, instead of edge-function secrets. The edge functions read the function secrets
-- first and fall back to these. Only the service role (the edge functions) can read them.
--
-- Set or change a value:
--   select vault.create_secret('<value>', 'OPENROUTER_API_KEY');                 -- first time
--   select vault.update_secret(id, '<value>') from vault.secrets where name = 'OPENROUTER_API_KEY';
CREATE OR REPLACE FUNCTION public.get_ai_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(s.name, s.decrypted_secret), '{}'::jsonb)
  FROM vault.decrypted_secrets s
  WHERE s.name IN ('OPENROUTER_API_KEY', 'AI_MODELS', 'AI_ESCALATION_MODELS', 'AI_DATA_COLLECTION', 'AI_ZDR', 'APP_URL')
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_settings() TO service_role;
