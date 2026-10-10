-- =====================================================================================
-- AutoFlow production hardening, part 1: schema, settings defaults and access helpers.
--
-- The hardening is split over the 20261010010000…20261010019999 files:
--   010000  schema, new tables, preference defaults, who-is-who helpers, input helpers
--   010100  checklist, document requests and routing (locking, settled rule, policy declines)
--   010200  deal actions: deals are only changed through these functions; submission checks
--   010300  documents, income sources, history, notifications, profiles and accounts
--   010400  audit log
--   010500  search text and the front-end aggregates
--   010600  AI usage, internal secrets, document sweep and cron
--   019999  who may call which function
-- =====================================================================================

-- ---------------------------------------------------------------- optional extensions
-- unaccent (accent-free search) and pg_trgm (fast ilike search) are used when available.
DO $$
BEGIN
  BEGIN
    CREATE SCHEMA IF NOT EXISTS extensions;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
  EXCEPTION WHEN others THEN RAISE NOTICE 'unaccent not available: %', SQLERRM;
  END;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
  EXCEPTION WHEN others THEN RAISE NOTICE 'pg_trgm not available: %', SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------- new columns
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_documents_processing_due ON public.documents (processing_status, next_attempt_at);

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS credit_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dealer_message text,
  ADD COLUMN IF NOT EXISTS search_text text;
DO $$ BEGIN
  ALTER TABLE public.deals ADD CONSTRAINT deals_credit_conditions_is_array CHECK (jsonb_typeof(credit_conditions) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.income_sources ADD COLUMN IF NOT EXISTS calc_locked boolean NOT NULL DEFAULT false;
ALTER TABLE public.income_sources ALTER COLUMN ytd_months TYPE numeric(5,2) USING ytd_months::numeric(5,2);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr';
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_language_check CHECK (language IN ('fr', 'en'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The plaintext SSN column was never used by the app or the edge functions.
ALTER TABLE public.customers DROP COLUMN IF EXISTS ssn;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_created ON public.deal_timeline (created_at);
CREATE INDEX IF NOT EXISTS idx_deals_funded_at ON public.deals (funded_at) WHERE funded_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_created_at ON public.deals (created_at);

-- ---------------------------------------------------------------- logs (append-only)
-- Every change to the key tables (filled by triggers, see 20261010010400).
CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor uuid,
  table_name text NOT NULL,
  row_id text,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  changed jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_log_row ON public.audit_log (table_name, row_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON public.audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log (actor, at DESC);

-- Every signed file link handed out by the document-url edge function (service role).
CREATE TABLE IF NOT EXISTS public.document_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  document_id uuid,
  deal_id uuid,
  kind text NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'preview'))
);
CREATE INDEX IF NOT EXISTS idx_document_access_log_document ON public.document_access_log (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_access_log_user ON public.document_access_log (user_id, created_at DESC);

-- Every AI request made by the edge functions (service role). No foreign keys on purpose: a
-- usage row must never be lost because its document or deal was deleted meanwhile.
--   purpose:    classify | extract | escalate | verify_employer
--   error_code: timeout | rate_limit | credits | auth | upstream | bad_reply | network (| config)
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deal_id uuid,
  document_id uuid,
  user_id uuid,
  purpose text NOT NULL,
  model text,
  ok boolean NOT NULL DEFAULT false,
  error_code text,
  error_detail text,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  cost numeric
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_deal ON public.ai_usage (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON public.ai_usage (created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
-- written only by triggers (audit_log) or the edge functions (the other two); never changed
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.document_access_log, public.ai_usage FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.document_access_log, public.ai_usage FROM service_role;
GRANT SELECT ON public.audit_log, public.document_access_log, public.ai_usage TO authenticated, service_role;
GRANT INSERT ON public.document_access_log, public.ai_usage TO service_role;

-- ---------------------------------------------------------------- settings: preference defaults
-- Business rules the app reads from app_settings.preferences. Missing keys are always filled
-- with these defaults; keys an admin already set are never overwritten.
CREATE OR REPLACE FUNCTION public.app_preference_defaults()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT '{
    "company_name": "AutoFlow",
    "support_email": null,
    "min_apr": 0,
    "max_apr": 29.99,
    "default_term_months": 72,
    "allowed_terms": [36, 48, 60, 72, 84, 96],
    "funding_approval_limit": 75000,
    "max_dti": 45,
    "max_pti": 20,
    "decline_vehicle_for_work": true,
    "require_staff_mfa": false
  }'::jsonb
$$;

CREATE OR REPLACE FUNCTION public.trg_app_settings_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.preferences := public.app_preference_defaults()
                     || CASE WHEN jsonb_typeof(NEW.preferences) = 'object' THEN NEW.preferences ELSE '{}'::jsonb END;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS app_settings_defaults ON public.app_settings;
CREATE TRIGGER app_settings_defaults BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.trg_app_settings_defaults();

ALTER TABLE public.app_settings ALTER COLUMN preferences SET DEFAULT public.app_preference_defaults();
UPDATE public.app_settings SET preferences = preferences WHERE id;   -- merge (the trigger keeps existing keys)

-- a boolean preference, tolerant of "true"/"false" strings; _default when unset
CREATE OR REPLACE FUNCTION public.pref_bool(_key text, _default boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT CASE lower(preferences ->> _key) WHEN 'true' THEN true WHEN 'false' THEN false END
                   FROM public.app_settings WHERE id), _default)
$$;

-- ---------------------------------------------------------------- storage bucket limits
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('storage.buckets') AND attname = 'file_size_limit' AND NOT attisdropped)
     AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('storage.buckets') AND attname = 'allowed_mime_types' AND NOT attisdropped) THEN
    UPDATE storage.buckets
       SET file_size_limit = 15 * 1024 * 1024,
           allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
     WHERE id = 'documents';
  END IF;
END $$;

-- ---------------------------------------------------------------- who is who
-- When staff must use two-step sign-in (preference require_staff_mfa), a staff session counts
-- only once its JWT says aal2.
CREATE OR REPLACE FUNCTION public.session_mfa_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.pref_bool('require_staff_mfa', false)
      OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Staff = a non-dealer role. A signed-in caller who is not staff (dealer, no role) only learns
-- about themselves: asking about anyone else gives false. Database / service-role calls (no
-- signed-in user) see the real answer. These read user_roles as their owner, so the row-level
-- rules that call them never recurse.
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    WHEN auth.uid() IS NULL THEN
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role <> 'dealer')
    WHEN NOT (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role <> 'dealer')
              AND public.session_mfa_ok()) THEN false
    ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role <> 'dealer')
  END
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS NULL OR _role IS NULL THEN false
    WHEN auth.uid() IS NULL THEN
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
    WHEN _user_id = auth.uid() THEN
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
      AND (_role = 'dealer' OR public.session_mfa_ok())
    WHEN public.is_staff(auth.uid()) THEN
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
    ELSE false
  END
$$;

-- the caller's dealership, only while they hold the dealer role
CREATE OR REPLACE FUNCTION public.current_dealer_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT du.dealer_id FROM public.dealer_users du
  WHERE du.user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = du.user_id AND r.role = 'dealer')
$$;

CREATE OR REPLACE FUNCTION public.admin_exists()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin')
$$;

-- ---------------------------------------------------------------- input helpers
-- Text from the app: control characters removed (line breaks kept when _multiline), trimmed,
-- '' → NULL, at most _max characters (else ERRCODE 22023 "<field>: …").
CREATE OR REPLACE FUNCTION public.clean_text(_v text, _field text, _max integer DEFAULT 200, _multiline boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE _t text;
BEGIN
  IF _v IS NULL THEN RETURN NULL; END IF;
  IF _multiline THEN
    _t := regexp_replace(_v, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]', '', 'g');
  ELSE
    _t := regexp_replace(_v, '[\x01-\x1F\x7F-\x9F]', ' ', 'g');
  END IF;
  _t := btrim(_t);
  IF length(_t) > _max THEN
    RAISE EXCEPTION '%: must be at most % characters', _field, _max USING ERRCODE = '22023';
  END IF;
  RETURN nullif(_t, '');
END $$;

-- A number from a JSON payload: a JSON number, or a string of digits with an optional sign and
-- decimals. Empty / missing → NULL. NaN, Infinity, "12abc", objects… → ERRCODE 22023.
CREATE OR REPLACE FUNCTION public.parse_number(_v jsonb, _field text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE _s text;
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(_v) NOT IN ('number', 'string') THEN
    RAISE EXCEPTION '%: must be a number', _field USING ERRCODE = '22023';
  END IF;
  _s := btrim(_v #>> '{}');
  IF _s = '' THEN RETURN NULL; END IF;
  IF length(_s) > 40 OR _s !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$' THEN
    RAISE EXCEPTION '%: must be a number', _field USING ERRCODE = '22023';
  END IF;
  RETURN _s::numeric;
END $$;

-- ---------------------------------------------------------------- deal numbers
-- AF-YYYY-00001 … AF-YYYY-99999, then AF-YYYY-100000 … (never truncated)
CREATE OR REPLACE FUNCTION public.generate_deal_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _n text;
BEGIN
  IF NEW.deal_number IS NULL OR NEW.deal_number = '' THEN
    _n := nextval('public.deal_number_seq')::text;
    NEW.deal_number := 'AF-' || to_char(now(), 'YYYY') || '-' || lpad(_n, greatest(5, length(_n)), '0');
  END IF;
  RETURN NEW;
END $$;
