-- =====================================================================================
-- AutoFlow production hardening, part 4: documents, income sources, history,
-- notifications, profiles and accounts.
--
-- Guard triggers below check current_user: 'authenticated' / 'anon' means the statement came
-- straight from the app. Statements run by AutoFlow's own SECURITY DEFINER functions (owner),
-- the edge functions (service_role) or migrations are not restricted by them.
-- =====================================================================================

-- ---------------------------------------------------------------- documents
-- Inserts from the app are normalised: the uploader is the caller, the document starts
-- unread, and its file (and preview) must already be in the "documents" bucket under
-- "<deal_id>/". The caller only sees storage objects they may access (storage RLS), so a
-- dealer can never point a document at another deal's file.
CREATE OR REPLACE FUNCTION public.trg_documents_before_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _prefix text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  NEW.uploaded_by := auth.uid();
  NEW.status := 'pending';
  NEW.processing_status := 'pending';
  NEW.processing_error := NULL;
  NEW.classification_confidence := NULL;
  NEW.ai_model := NULL;
  NEW.processed_at := NULL;
  NEW.processing_started_at := NULL;
  NEW.attempt_count := 0;
  NEW.next_attempt_at := NULL;
  NEW.created_at := now();
  NEW.type_source := CASE WHEN NEW.type = 'other' THEN 'auto' ELSE 'manual' END;
  NEW.name := coalesce(public.clean_text(NEW.name, 'name', 255), 'document');
  NEW.notes := public.clean_text(NEW.notes, 'notes', 2000, true);
  NEW.file_size := greatest(coalesce(NEW.file_size, 0), 0);

  _prefix := NEW.deal_id::text || '/';
  IF NEW.storage_path IS NULL OR NOT starts_with(NEW.storage_path, _prefix) OR NEW.storage_path ~ '(^|/)\.\.?(/|$)'
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'documents' AND o.name = NEW.storage_path) THEN
    RAISE EXCEPTION 'storage_path: upload the file under %/ in the documents bucket first', NEW.deal_id USING ERRCODE = '22023';
  END IF;
  IF NEW.preview_path IS NOT NULL AND (NOT starts_with(NEW.preview_path, _prefix) OR NEW.preview_path ~ '(^|/)\.\.?(/|$)'
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'documents' AND o.name = NEW.preview_path)) THEN
    RAISE EXCEPTION 'preview_path: upload the preview under %/ in the documents bucket first', NEW.deal_id USING ERRCODE = '22023';
  END IF;
  NEW.file_url := NEW.storage_path;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS documents_before_insert ON public.documents;
CREATE TRIGGER documents_before_insert BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.trg_documents_before_insert();

-- staff may change only the type, how it was typed, the review status and the notes
CREATE OR REPLACE FUNCTION public.trg_documents_before_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - ARRAY['type', 'type_source', 'status', 'notes'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['type', 'type_source', 'status', 'notes']) THEN
    RAISE EXCEPTION 'Only the type, status and notes of a document can be changed' USING ERRCODE = '42501';
  END IF;
  -- a person who changes the type owns it (the AI never overwrites a manual type)
  IF NEW.type IS DISTINCT FROM OLD.type AND NEW.type_source IS NOT DISTINCT FROM OLD.type_source THEN
    NEW.type_source := 'manual';
  END IF;
  NEW.notes := public.clean_text(NEW.notes, 'notes', 2000, true);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS documents_before_update ON public.documents;
CREATE TRIGGER documents_before_update BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.trg_documents_before_update();

DROP POLICY IF EXISTS "Staff and owning dealer can add documents" ON public.documents;
CREATE POLICY "Staff and owning dealer can add documents" ON public.documents FOR INSERT TO authenticated
  WITH CHECK (public.can_access_deal(deal_id));
DROP POLICY IF EXISTS "Staff can update documents" ON public.documents;
CREATE POLICY "Staff can update documents" ON public.documents FOR UPDATE TO authenticated
  USING ((SELECT public.is_staff(auth.uid()))) WITH CHECK ((SELECT public.is_staff(auth.uid())));
DROP POLICY IF EXISTS "Staff can delete documents" ON public.documents;
DROP POLICY IF EXISTS "Admins can delete documents" ON public.documents;
CREATE POLICY "Admins can delete documents" ON public.documents FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

DROP POLICY IF EXISTS "Staff can delete documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete documents" ON storage.objects;
CREATE POLICY "Admins can delete documents" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND public.has_role(auth.uid(), 'admin'));

-- The owning dealer or staff can ask for a failed read to be tried again (5 attempts at most).
-- Returns false when there is nothing to retry. Call process-document afterwards.
CREATE OR REPLACE FUNCTION public.retry_document(_document_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d public.documents%ROWTYPE;
BEGIN
  SELECT * INTO _d FROM public.documents WHERE id = _document_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.can_access_deal(_d.deal_id) THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002';
  END IF;
  IF _d.processing_status <> 'failed' OR _d.attempt_count >= 5 THEN
    RETURN false;
  END IF;
  UPDATE public.documents
     SET processing_status = 'pending', processing_error = NULL, next_attempt_at = NULL, processing_started_at = NULL
   WHERE id = _document_id;
  RETURN true;
END $$;

-- ---------------------------------------------------------------- income sources
-- Analysts and verifiers work on income; only verifiers (and admins) verify it or change a
-- verified source; deleting is for verifiers and admins.
DROP POLICY IF EXISTS "Staff can insert income sources" ON public.income_sources;
DROP POLICY IF EXISTS "Underwriters can add income sources" ON public.income_sources;
CREATE POLICY "Underwriters can add income sources" ON public.income_sources FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'credit_analyst')) OR (SELECT public.has_role(auth.uid(), 'income_verifier'))
              OR (SELECT public.has_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Staff can update income sources" ON public.income_sources;
DROP POLICY IF EXISTS "Underwriters can update income sources" ON public.income_sources;
CREATE POLICY "Underwriters can update income sources" ON public.income_sources FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'credit_analyst')) OR (SELECT public.has_role(auth.uid(), 'income_verifier'))
         OR (SELECT public.has_role(auth.uid(), 'admin')))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'credit_analyst')) OR (SELECT public.has_role(auth.uid(), 'income_verifier'))
              OR (SELECT public.has_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Admins can delete income sources" ON public.income_sources;
DROP POLICY IF EXISTS "Income verifiers can delete income sources" ON public.income_sources;
CREATE POLICY "Income verifiers can delete income sources" ON public.income_sources FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'income_verifier')) OR (SELECT public.has_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Staff can view income sources" ON public.income_sources;
CREATE POLICY "Staff can view income sources" ON public.income_sources FOR SELECT TO authenticated
  USING ((SELECT public.is_staff(auth.uid())));

CREATE OR REPLACE FUNCTION public.trg_income_sources_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _verifier boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  _verifier := public.has_role(auth.uid(), 'income_verifier') OR public.has_role(auth.uid(), 'admin');
  IF TG_OP = 'UPDATE' AND OLD.verification_status = 'verified' AND NOT _verifier
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'Only an income verifier can change a verified income source' USING ERRCODE = '42501';
  END IF;
  IF NEW.verification_status = 'verified'
     AND (TG_OP = 'INSERT' OR OLD.verification_status IS DISTINCT FROM 'verified') THEN
    IF NOT _verifier THEN
      RAISE EXCEPTION 'Only an income verifier can mark income as verified' USING ERRCODE = '42501';
    END IF;
    NEW.verified_by := auth.uid();
    NEW.verified_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS income_sources_guard ON public.income_sources;
CREATE TRIGGER income_sources_guard BEFORE INSERT OR UPDATE ON public.income_sources
  FOR EACH ROW EXECUTE FUNCTION public.trg_income_sources_guard();

-- ---------------------------------------------------------------- deal history (timeline)
-- Staff entries are always signed by the caller; nobody edits or deletes history.
CREATE OR REPLACE FUNCTION public.trg_deal_timeline_before_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.created_by := auth.uid();
    NEW.created_at := clock_timestamp();
    NEW.description := public.clean_text(NEW.description, 'description', 2000, true);
    IF NEW.description IS NULL THEN RAISE EXCEPTION 'description: is required' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS deal_timeline_before_insert ON public.deal_timeline;
CREATE TRIGGER deal_timeline_before_insert BEFORE INSERT ON public.deal_timeline
  FOR EACH ROW EXECUTE FUNCTION public.trg_deal_timeline_before_insert();
REVOKE UPDATE, DELETE, TRUNCATE ON public.deal_timeline FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS "Staff can view timeline" ON public.deal_timeline;
CREATE POLICY "Staff can view timeline" ON public.deal_timeline FOR SELECT TO authenticated
  USING ((SELECT public.is_staff(auth.uid())));
DROP POLICY IF EXISTS "Staff can add timeline" ON public.deal_timeline;
CREATE POLICY "Staff can add timeline" ON public.deal_timeline FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_staff(auth.uid())));

-- ---------------------------------------------------------------- notifications
-- Created only by AutoFlow's functions; a user may only mark their own as read.
DROP POLICY IF EXISTS "Staff can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
REVOKE INSERT, TRUNCATE ON public.notifications FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.trg_notifications_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND (to_jsonb(NEW) - 'read') IS DISTINCT FROM (to_jsonb(OLD) - 'read') THEN
    RAISE EXCEPTION 'Only the read flag of a notification can be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notifications_guard ON public.notifications;
CREATE TRIGGER notifications_guard BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.trg_notifications_guard();

-- ---------------------------------------------------------------- profiles
-- Users edit only their own name and language; email follows auth.users; the rest is set by
-- set_user_access / set_user_active.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "System can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own name and language" ON public.profiles;
CREATE POLICY "Users can update their own name and language" ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.trg_profiles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - ARRAY['name', 'language', 'updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['name', 'language', 'updated_at']) THEN
    RAISE EXCEPTION 'Only your name and language can be changed' USING ERRCODE = '42501';
  END IF;
  NEW.name := public.clean_text(NEW.name, 'name', 200);
  IF NEW.name IS NULL THEN RAISE EXCEPTION 'name: is required' USING ERRCODE = '22023'; END IF;
  IF NEW.language IS NULL OR NEW.language NOT IN ('fr', 'en') THEN
    RAISE EXCEPTION 'language: must be fr or en' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_guard ON public.profiles;
CREATE TRIGGER profiles_guard BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profiles_guard();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, email, language)
  VALUES (NEW.id,
          coalesce(left(public.clean_text(NEW.raw_user_meta_data ->> 'name', 'name', 100000), 200), NEW.email, 'User'),
          coalesce(NEW.email, ''),
          CASE WHEN NEW.raw_user_meta_data ->> 'language' IN ('fr', 'en') THEN NEW.raw_user_meta_data ->> 'language' ELSE 'fr' END)
  ON CONFLICT (user_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    UPDATE public.profiles SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed AFTER UPDATE OF email ON auth.users
  FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email) EXECUTE FUNCTION public.sync_profile_email();

UPDATE public.profiles p SET email = u.email
FROM auth.users u WHERE u.id = p.user_id AND u.email IS NOT NULL AND p.email IS DISTINCT FROM u.email;

-- ---------------------------------------------------------------- roles: never lose the last admin
CREATE OR REPLACE FUNCTION public.trg_user_roles_keep_admin()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND OLD.role = 'admin'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NEW.user_id <> OLD.user_id)
     AND NOT public.admin_exists() THEN
    RAISE EXCEPTION 'The last admin cannot lose admin access' USING ERRCODE = '22023';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS user_roles_keep_admin ON public.user_roles;
CREATE TRIGGER user_roles_keep_admin AFTER UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.trg_user_roles_keep_admin();

-- dealers, user_roles, dealer_users and app_settings: admin-write only (explicit WITH CHECK)
DROP POLICY IF EXISTS "Admins can manage dealers" ON public.dealers;
CREATE POLICY "Admins can manage dealers" ON public.dealers FOR ALL TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin'))) WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin'))) WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
DROP POLICY IF EXISTS "Admins manage dealer links" ON public.dealer_users;
CREATE POLICY "Admins manage dealer links" ON public.dealer_users FOR ALL TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin'))) WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
REVOKE INSERT, DELETE, TRUNCATE ON public.app_settings FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- accounts (admin only)
-- Replaces the user's role (NULL = no access). The dealer role needs _dealer_id; any other
-- role removes the dealer link. Also sets profiles.department.
CREATE OR REPLACE FUNCTION public.set_user_access(_user_id uuid, _role public.app_role DEFAULT NULL, _dealer_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change access' USING ERRCODE = '42501';
  END IF;
  IF _user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;
  IF _role IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _user_id AND NOT is_active) THEN
    RAISE EXCEPTION 'Reactivate this account before giving it access' USING ERRCODE = '22023';
  END IF;
  IF _role = 'dealer' THEN
    IF _dealer_id IS NULL THEN
      RAISE EXCEPTION 'dealer_id: a dealer account needs a dealership' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.dealers WHERE id = _dealer_id) THEN
      RAISE EXCEPTION 'dealer_id: dealership not found' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF _role IS DISTINCT FROM 'admin'
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin' AND user_id <> _user_id) THEN
    RAISE EXCEPTION 'The last admin cannot lose admin access' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id AND role IS DISTINCT FROM _role;
  IF _role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role) ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  IF _role = 'dealer' THEN
    INSERT INTO public.dealer_users (user_id, dealer_id) VALUES (_user_id, _dealer_id)
    ON CONFLICT (user_id) DO UPDATE SET dealer_id = EXCLUDED.dealer_id
    WHERE public.dealer_users.dealer_id IS DISTINCT FROM EXCLUDED.dealer_id;
  ELSE
    DELETE FROM public.dealer_users WHERE user_id = _user_id;
  END IF;
  UPDATE public.profiles SET department = CASE _role
      WHEN 'credit_analyst' THEN 'credit'::public.department
      WHEN 'income_verifier' THEN 'income'::public.department
      WHEN 'funding_manager' THEN 'funding'::public.department
      WHEN 'admin' THEN 'admin'::public.department
      ELSE NULL END
  WHERE user_id = _user_id;
END $$;

-- ban / unban in auth (GoTrue breaks on 'infinity', so a far date is used) and end sessions
CREATE OR REPLACE FUNCTION public.auth_set_banned(_user_id uuid, _banned boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('auth.users') AND attname = 'banned_until' AND NOT attisdropped) THEN
    EXECUTE 'UPDATE auth.users SET banned_until = $2 WHERE id = $1'
      USING _user_id, CASE WHEN _banned THEN timestamptz '2999-12-31 00:00:00+00' END;
  END IF;
  IF _banned THEN
    IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
      EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id::text = $1::text' USING _user_id;
    END IF;
    IF to_regclass('auth.sessions') IS NOT NULL THEN
      EXECUTE 'DELETE FROM auth.sessions WHERE user_id::text = $1::text' USING _user_id;
    END IF;
  END IF;
END $$;

-- Deactivate: remove role and dealer link, ban the sign-in and end every session.
-- Reactivate: lift the ban (the role must be given again). Nobody deactivates themselves.
CREATE OR REPLACE FUNCTION public.set_user_active(_user_id uuid, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change access' USING ERRCODE = '42501';
  END IF;
  IF _active IS NULL THEN RAISE EXCEPTION 'active: is required' USING ERRCODE = '22023'; END IF;
  IF _user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT _active THEN
    IF _user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot deactivate your own account' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = _user_id;
    DELETE FROM public.dealer_users WHERE user_id = _user_id;
    UPDATE public.profiles SET is_active = false, department = NULL WHERE user_id = _user_id;
    PERFORM public.auth_set_banned(_user_id, true);
  ELSE
    UPDATE public.profiles SET is_active = true WHERE user_id = _user_id;
    PERFORM public.auth_set_banned(_user_id, false);
  END IF;
END $$;
