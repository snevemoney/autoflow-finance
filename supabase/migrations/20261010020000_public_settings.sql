-- The few settings a dealer's screens need (company name, support email, the rate range and
-- terms the submission form offers). Dealers can't read app_settings itself.
CREATE OR REPLACE FUNCTION public.public_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE (
    SELECT jsonb_build_object(
      'company_name', p -> 'company_name', 'support_email', p -> 'support_email',
      'min_apr', p -> 'min_apr', 'max_apr', p -> 'max_apr',
      'default_term_months', p -> 'default_term_months', 'allowed_terms', p -> 'allowed_terms')
    FROM (SELECT public.app_preference_defaults() || coalesce(preferences, '{}'::jsonb) AS p FROM public.app_settings WHERE id) s)
  END
$$;
REVOKE EXECUTE ON FUNCTION public.public_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_settings() TO authenticated, service_role;
