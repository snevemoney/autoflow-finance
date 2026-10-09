-- =====================================================================================
-- AutoFlow end-to-end: dealer portal, document checklist + requests, auto-routing,
-- credit / income / funding decisions, and dealer-scoped security.
--
-- Deal flow (each arrow is automatic once its condition is met; staff can still move
-- deals by hand on the pipeline board):
--   new_submission → document_review            on submission
--   document_review → credit_review             every required document received and processed
--   credit_review → income_verification         credit approved (straight to funding_review
--                                               if income is already verified); declined → declined
--   income_verification → funding_review        every income source verified
--   funding_review → approved                   funding checklist complete + approved
--   approved → funded                           marked funded
-- =====================================================================================

-- ---------------------------------------------------------------- settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  automations jsonb NOT NULL DEFAULT '{"auto_sort": true, "auto_fill_income": true, "auto_request_docs": true, "auto_route": true}'::jsonb,
  required_documents public.document_type[] NOT NULL DEFAULT ARRAY['credit_application', 'id_verification', 'vehicle_invoice', 'insurance']::public.document_type[],
  funding_checklist_items jsonb NOT NULL DEFAULT '[
    {"key": "contract_signed", "label": "Retail contract signed by customer"},
    {"key": "id_confirmed", "label": "Customer identity confirmed"},
    {"key": "insurance_confirmed", "label": "Insurance in force, lender named as loss payee"},
    {"key": "invoice_matches", "label": "Dealer invoice matches deal structure"},
    {"key": "lien_registered", "label": "Lien registered"},
    {"key": "down_payment_received", "label": "Down payment received"}
  ]'::jsonb,
  -- free-form settings pages (company details, notification and email preferences, business rules)
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.app_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.pref_enabled(_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (preferences ->> _key)::boolean FROM public.app_settings WHERE id), true)
$$;

CREATE OR REPLACE FUNCTION public.automation_enabled(_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (automations ->> _key)::boolean FROM public.app_settings WHERE id), true)
$$;

-- ---------------------------------------------------------------- dealer accounts
CREATE TABLE IF NOT EXISTS public.dealer_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dealer_id uuid NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dealer_users_dealer ON public.dealer_users(dealer_id);

-- staff = anyone holding a non-dealer role
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role <> 'dealer')
$$;

CREATE OR REPLACE FUNCTION public.current_dealer_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dealer_id FROM public.dealer_users WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.can_access_deal(_deal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_staff(auth.uid())
      OR EXISTS (SELECT 1 FROM public.deals d
                 WHERE d.id = _deal_id AND d.dealer_id = public.current_dealer_id())
$$;

-- storage paths are "<deal_id>/<file>"; anything else is staff-only
CREATE OR REPLACE FUNCTION public.can_access_document_path(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _deal uuid;
BEGIN
  IF public.is_staff(auth.uid()) THEN RETURN true; END IF;
  BEGIN
    _deal := split_part(_name, '/', 1)::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN public.can_access_deal(_deal);
END $$;

-- ---------------------------------------------------------------- new columns
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS preview_path text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'manual'
    CHECK (processing_status IN ('pending', 'processing', 'done', 'failed', 'skipped', 'manual')),
  ADD COLUMN IF NOT EXISTS processing_error text,
  ADD COLUMN IF NOT EXISTS type_source text NOT NULL DEFAULT 'manual'
    CHECK (type_source IN ('manual', 'auto', 'rule')),
  ADD COLUMN IF NOT EXISTS classification_confidence text,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS credit_decision text NOT NULL DEFAULT 'pending'
    CHECK (credit_decision IN ('pending', 'approved', 'conditional', 'declined')),
  ADD COLUMN IF NOT EXISTS credit_decision_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS credit_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS credit_decision_notes text,
  ADD COLUMN IF NOT EXISTS income_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS funding_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS funding_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS funding_approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS funded_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS submitted_by_dealer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_routed_at timestamptz;

-- Existing deals: start their time-in-stage clock from their last update, and record the
-- credit approval that deals already past credit review were given before decisions
-- were stored. Runs before the routing triggers exist, so nothing is re-routed.
UPDATE public.deals SET status_changed_at = COALESCE(updated_at, created_at)
WHERE status_changed_at > COALESCE(updated_at, created_at);
UPDATE public.deals SET credit_decision = 'approved'
WHERE credit_decision = 'pending'
  AND status IN ('income_verification', 'funding_review', 'approved', 'funded');


ALTER TABLE public.income_sources
  ADD COLUMN IF NOT EXISTS gross_per_period numeric,
  ADD COLUMN IF NOT EXISTS auto_filled_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_fill_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- document requests
CREATE TABLE IF NOT EXISTS public.document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  dealer_id uuid NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  doc_type public.document_type NOT NULL,
  label text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'cancelled')),
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('automation', 'staff')),
  requested_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz,
  fulfilled_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_requests_open
  ON public.document_requests(deal_id, doc_type) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_document_requests_dealer ON public.document_requests(dealer_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_deal ON public.documents(deal_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON public.deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_dealer ON public.deals(dealer_id);
CREATE INDEX IF NOT EXISTS idx_income_sources_deal ON public.income_sources(deal_id);
CREATE INDEX IF NOT EXISTS idx_timeline_deal ON public.deal_timeline(deal_id, created_at);
-- several timeline rows are often written in one transaction (submit → auto-route → request);
-- clock_timestamp keeps them in the order they happened
ALTER TABLE public.deal_timeline ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- ---------------------------------------------------------------- labels + mapping
CREATE OR REPLACE FUNCTION public.document_type_label(_t public.document_type)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _t
    WHEN 'credit_application' THEN 'Credit Application'
    WHEN 'income_verification' THEN 'Income Verification'
    WHEN 'pay_stub' THEN 'Pay Stub'
    WHEN 'bank_statement' THEN 'Bank Statement'
    WHEN 'vehicle_invoice' THEN 'Vehicle Invoice'
    WHEN 'trade_in' THEN 'Trade-In Documentation'
    WHEN 'insurance' THEN 'Insurance Proof'
    WHEN 'id_verification' THEN 'ID Verification'
    ELSE 'Other' END
$$;

CREATE OR REPLACE FUNCTION public.deal_status_label(_s public.deal_status)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s
    WHEN 'new_submission' THEN 'New Submission'
    WHEN 'document_review' THEN 'Document Review'
    WHEN 'credit_review' THEN 'Credit Review'
    WHEN 'income_verification' THEN 'Income Verification'
    WHEN 'funding_review' THEN 'Funding Review'
    WHEN 'approved' THEN 'Approved'
    WHEN 'funded' THEN 'Funded'
    WHEN 'declined' THEN 'Declined'
    ELSE 'Incomplete' END
$$;

CREATE OR REPLACE FUNCTION public.status_department(_s public.deal_status)
RETURNS public.department LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s
    WHEN 'credit_review' THEN 'credit'::public.department
    WHEN 'income_verification' THEN 'income'::public.department
    WHEN 'funding_review' THEN 'funding'::public.department
    WHEN 'approved' THEN 'funding'::public.department
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.department_role(_d public.department)
RETURNS public.app_role LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _d
    WHEN 'credit' THEN 'credit_analyst'::public.app_role
    WHEN 'income' THEN 'income_verifier'::public.app_role
    WHEN 'funding' THEN 'funding_manager'::public.app_role
    ELSE 'admin'::public.app_role END
$$;

-- ---------------------------------------------------------------- notifications
CREATE OR REPLACE FUNCTION public.notify_dealer(_dealer_id uuid, _title text, _message text,
  _type public.notification_type, _deal_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, title, message, type, deal_id)
  SELECT du.user_id, _title, _message, _type, _deal_id FROM public.dealer_users du WHERE du.dealer_id = _dealer_id
$$;

CREATE OR REPLACE FUNCTION public.notify_role(_role public.app_role, _title text, _message text,
  _type public.notification_type, _deal_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, title, message, type, deal_id)
  SELECT DISTINCT ur.user_id, _title, _message, _type, _deal_id FROM public.user_roles ur WHERE ur.role = _role
$$;

-- ---------------------------------------------------------------- checklist
-- One row per thing the deal needs. Income items follow the deal's income sources:
-- employment → pay stub (or employment letter), self-employed/contractor → bank statements,
-- pension / benefits → benefit letter (or bank statement).
CREATE OR REPLACE FUNCTION public.deal_checklist(_deal_id uuid)
RETURNS TABLE (item_key text, label text, doc_types public.document_type[], satisfied boolean,
               document_count integer, open_request_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _req public.document_type[];
  _has_trade boolean;
BEGIN
  IF NOT public.can_access_deal(_deal_id) AND auth.uid() IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT required_documents INTO _req FROM public.app_settings WHERE id;
  SELECT trade_in_vin IS NOT NULL AND trade_in_vin <> '' INTO _has_trade FROM public.deals WHERE id = _deal_id;

  RETURN QUERY
  WITH items AS (
    SELECT t::text AS k, public.document_type_label(t) AS l, ARRAY[t] AS types, ord
    FROM unnest(coalesce(_req, ARRAY[]::public.document_type[])) WITH ORDINALITY AS u(t, ord)
    UNION ALL
    SELECT 'trade_in', 'Trade-In Documentation', ARRAY['trade_in'::public.document_type], 50
    WHERE coalesce(_has_trade, false)
    UNION ALL
    SELECT DISTINCT
      CASE
        WHEN s.source_type IN ('self_employed', 'contractor') THEN 'income_self_employed'
        WHEN s.source_type IN ('pension', 'government_assistance', 'unemployed') THEN 'income_benefits'
        ELSE 'income_employment' END,
      CASE
        WHEN s.source_type IN ('self_employed', 'contractor') THEN 'Bank Statements (self-employed income)'
        WHEN s.source_type IN ('pension', 'government_assistance', 'unemployed') THEN 'Benefit / Pension Letter'
        ELSE 'Pay Stub' END,
      CASE
        WHEN s.source_type IN ('self_employed', 'contractor') THEN ARRAY['bank_statement'::public.document_type]
        WHEN s.source_type IN ('pension', 'government_assistance', 'unemployed') THEN ARRAY['income_verification'::public.document_type, 'bank_statement'::public.document_type]
        ELSE ARRAY['pay_stub'::public.document_type, 'income_verification'::public.document_type] END,
      20::bigint
    FROM public.income_sources s WHERE s.deal_id = _deal_id
    UNION ALL
    SELECT 'income_employment', 'Pay Stub', ARRAY['pay_stub'::public.document_type, 'income_verification'::public.document_type], 20
    WHERE NOT EXISTS (SELECT 1 FROM public.income_sources s WHERE s.deal_id = _deal_id)
  )
  SELECT i.k, i.l, i.types,
         (cnt.n > 0),
         cnt.n,
         (SELECT r.id FROM public.document_requests r
           WHERE r.deal_id = _deal_id AND r.status = 'open' AND r.doc_type = i.types[1] LIMIT 1)
  FROM items i
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS n FROM public.documents d
    WHERE d.deal_id = _deal_id AND d.type = ANY (i.types) AND d.status <> 'rejected'
      AND d.processing_status NOT IN ('pending', 'processing')
  ) cnt
  ORDER BY i.ord, i.k;
END $$;

-- true once nothing on the deal is still being read (a read stuck for 30+ minutes no longer blocks)
CREATE OR REPLACE FUNCTION public.deal_documents_settled(_deal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.documents
                     WHERE deal_id = _deal_id AND processing_status IN ('pending', 'processing')
                       AND created_at > now() - interval '30 minutes')
$$;

-- ---------------------------------------------------------------- request sync
-- Closes requests that a received document satisfies; when automatic requests are on,
-- opens one request per missing item (only once every uploaded document is processed,
-- so a pay stub that is still being read is never requested again).
CREATE OR REPLACE FUNCTION public.sync_document_requests(_deal_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _deal public.deals%ROWTYPE;
  _item record;
  _doc uuid;
  _r record;
  _opened integer := 0;
BEGIN
  SELECT * INTO _deal FROM public.deals WHERE id = _deal_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- close requests that are now satisfied
  FOR _r IN SELECT * FROM public.document_requests WHERE deal_id = _deal_id AND status = 'open' LOOP
    SELECT d.id INTO _doc FROM public.documents d
    WHERE d.deal_id = _deal_id AND d.type = _r.doc_type AND d.status <> 'rejected'
      AND d.processing_status NOT IN ('pending', 'processing')
      AND (_r.source = 'automation' OR d.created_at >= _r.created_at)
    ORDER BY d.created_at DESC LIMIT 1;
    IF _doc IS NOT NULL THEN
      UPDATE public.document_requests SET status = 'fulfilled', fulfilled_at = now(), fulfilled_document_id = _doc
      WHERE id = _r.id;
    END IF;
  END LOOP;

  IF _deal.status IN ('declined', 'funded') THEN
    UPDATE public.document_requests SET status = 'cancelled' WHERE deal_id = _deal_id AND status = 'open';
    RETURN 0;
  END IF;

  IF NOT public.automation_enabled('auto_request_docs') OR _deal.status <> 'document_review'
     OR NOT public.deal_documents_settled(_deal_id)
     OR NOT EXISTS (SELECT 1 FROM public.documents WHERE deal_id = _deal_id) THEN
    RETURN 0;
  END IF;

  FOR _item IN SELECT * FROM public.deal_checklist(_deal_id) WHERE NOT satisfied AND open_request_id IS NULL LOOP
    INSERT INTO public.document_requests (deal_id, dealer_id, doc_type, label, message, source)
    VALUES (_deal_id, _deal.dealer_id, _item.doc_types[1], _item.label, 'Missing from submission', 'automation')
    ON CONFLICT DO NOTHING;
    _opened := _opened + 1;
  END LOOP;
  RETURN _opened;
END $$;

-- ---------------------------------------------------------------- routing
CREATE OR REPLACE FUNCTION public.deal_income_verified(_deal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.income_sources WHERE deal_id = _deal_id)
     AND NOT EXISTS (SELECT 1 FROM public.income_sources WHERE deal_id = _deal_id AND verification_status <> 'verified')
$$;

CREATE OR REPLACE FUNCTION public.next_deal_status(_deal public.deals, OUT next_status public.deal_status, OUT reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  next_status := NULL; reason := NULL;
  CASE _deal.status
    WHEN 'new_submission' THEN
      next_status := 'document_review'; reason := 'Submission received';
    WHEN 'document_review' THEN
      IF public.deal_documents_settled(_deal.id)
         AND NOT EXISTS (SELECT 1 FROM public.deal_checklist(_deal.id) c WHERE NOT c.satisfied) THEN
        next_status := 'credit_review'; reason := 'All required documents received';
      END IF;
    WHEN 'credit_review' THEN
      IF _deal.credit_decision = 'declined' THEN
        next_status := 'declined'; reason := 'Credit declined';
      ELSIF _deal.credit_decision IN ('approved', 'conditional') THEN
        IF public.deal_income_verified(_deal.id) THEN
          next_status := 'funding_review'; reason := 'Credit approved, income already verified';
        ELSE
          next_status := 'income_verification'; reason := 'Credit approved';
        END IF;
      END IF;
    WHEN 'income_verification' THEN
      IF public.deal_income_verified(_deal.id) THEN
        next_status := 'funding_review'; reason := 'All income sources verified';
      END IF;
    WHEN 'funding_review' THEN
      IF _deal.funding_approved_at IS NOT NULL THEN
        next_status := 'approved'; reason := 'Funding checklist complete';
      END IF;
    WHEN 'approved' THEN
      IF _deal.funded_at IS NOT NULL THEN
        next_status := 'funded'; reason := 'Loan funded';
      END IF;
    ELSE NULL;
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION public.autoroute_deal(_deal_id uuid)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _deal public.deals%ROWTYPE;
  _next public.deal_status;
  _reason text;
  _dept public.department;
  _i integer := 0;
BEGIN
  PERFORM public.sync_document_requests(_deal_id);
  IF NOT public.automation_enabled('auto_route') THEN
    RETURN (SELECT status FROM public.deals WHERE id = _deal_id);
  END IF;

  LOOP
    _i := _i + 1;
    SELECT * INTO _deal FROM public.deals WHERE id = _deal_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT n.next_status, n.reason INTO _next, _reason FROM public.next_deal_status(_deal) n;
    EXIT WHEN _next IS NULL OR _i > 8;

    _dept := public.status_department(_next);
    PERFORM set_config('autoflow.routing', 'on', true);
    UPDATE public.deals SET status = _next, assigned_department = coalesce(_dept, assigned_department),
           last_routed_at = now()
    WHERE id = _deal_id;
    PERFORM set_config('autoflow.routing', 'off', true);

    INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
    VALUES (_deal_id, 'status_change',
            'Auto-routed to ' || public.deal_status_label(_next) || ' — ' || _reason, NULL,
            jsonb_build_object('automation', 'auto_route', 'from', _deal.status, 'to', _next, 'reason', _reason));

    IF _dept IS NOT NULL AND _next <> 'approved' AND public.pref_enabled('notify_status') THEN
      PERFORM public.notify_role(public.department_role(_dept), 'Deal ' || _deal.deal_number || ' is in your queue',
        _reason || '. Routed to ' || public.deal_status_label(_next) || '.', 'info', _deal_id);
    END IF;
    PERFORM public.notify_dealer(_deal.dealer_id, 'Deal ' || _deal.deal_number || ': ' || public.deal_status_label(_next),
      _reason || '.', CASE WHEN _next = 'declined' THEN 'error' WHEN _next IN ('approved', 'funded') THEN 'success' ELSE 'info' END::public.notification_type,
      _deal_id);

    -- a status change can open or close requests (e.g. entering document review)
    PERFORM public.sync_document_requests(_deal_id);
  END LOOP;
  RETURN _deal.status;
END $$;

-- ---------------------------------------------------------------- triggers
CREATE OR REPLACE FUNCTION public.trg_documents_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.autoroute_deal(coalesce(NEW.deal_id, OLD.deal_id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS documents_route ON public.documents;
CREATE TRIGGER documents_route
  AFTER INSERT OR DELETE OR UPDATE OF type, status, processing_status ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.trg_documents_route();

CREATE OR REPLACE FUNCTION public.trg_income_sources_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _deal uuid := coalesce(NEW.deal_id, OLD.deal_id);
BEGIN
  UPDATE public.deals
     SET income_verified_at = CASE WHEN public.deal_income_verified(_deal) THEN coalesce(income_verified_at, now()) ELSE NULL END
   WHERE id = _deal;
  PERFORM public.autoroute_deal(_deal);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS income_sources_route ON public.income_sources;
CREATE TRIGGER income_sources_route
  AFTER INSERT OR DELETE OR UPDATE OF verification_status, source_type ON public.income_sources
  FOR EACH ROW EXECUTE FUNCTION public.trg_income_sources_route();

CREATE OR REPLACE FUNCTION public.trg_deals_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.autoroute_deal(NEW.id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS deals_route_on_insert ON public.deals;
-- deferred to commit so a submission is routed once its income source and documents exist
CREATE CONSTRAINT TRIGGER deals_route_on_insert AFTER INSERT ON public.deals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_deals_route();
DROP TRIGGER IF EXISTS deals_route_on_decision ON public.deals;
CREATE TRIGGER deals_route_on_decision
  AFTER UPDATE OF credit_decision, funding_approved_at, funded_at, trade_in_vin ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_deals_route();

-- manual status moves (pipeline drag, decline, …): stamp, re-assign, log, tell the dealer
CREATE OR REPLACE FUNCTION public.trg_deals_status_before()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    NEW.assigned_department := coalesce(public.status_department(NEW.status), NEW.assigned_department);
    IF NEW.status = 'funded' AND NEW.funded_at IS NULL THEN
      NEW.funded_at := now();
      NEW.funded_amount := coalesce(NEW.funded_amount, NEW.loan_amount);
    END IF;
    IF NEW.status = 'declined' AND NEW.decision_at IS NULL THEN
      NEW.decision_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS deals_status_before ON public.deals;
CREATE TRIGGER deals_status_before BEFORE UPDATE OF status ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_deals_status_before();

CREATE OR REPLACE FUNCTION public.trg_deals_status_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND coalesce(current_setting('autoflow.routing', true), 'off') <> 'on' THEN
    INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
    VALUES (NEW.id, 'status_change',
            'Moved from ' || public.deal_status_label(OLD.status) || ' to ' || public.deal_status_label(NEW.status),
            auth.uid(), jsonb_build_object('from', OLD.status, 'to', NEW.status, 'manual', true));
    PERFORM public.notify_dealer(NEW.dealer_id, 'Deal ' || NEW.deal_number || ': ' || public.deal_status_label(NEW.status),
      'Status updated by the lender.',
      CASE WHEN NEW.status = 'declined' THEN 'error' WHEN NEW.status IN ('approved', 'funded') THEN 'success' ELSE 'info' END::public.notification_type,
      NEW.id);
    PERFORM public.sync_document_requests(NEW.id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS deals_status_after ON public.deals;
CREATE TRIGGER deals_status_after AFTER UPDATE OF status ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_deals_status_after();

-- every new request is logged on the deal and pushed to the dealer's portal
CREATE OR REPLACE FUNCTION public.trg_document_requests_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _num text;
BEGIN
  SELECT deal_number INTO _num FROM public.deals WHERE id = NEW.deal_id;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
    VALUES (NEW.deal_id, 'document_request',
            CASE WHEN NEW.source = 'automation' THEN 'Requested from dealer automatically: ' ELSE 'Requested from dealer: ' END || NEW.label,
            NEW.requested_by, jsonb_build_object('request_id', NEW.id, 'doc_type', NEW.doc_type, 'source', NEW.source));
    PERFORM public.notify_dealer(NEW.dealer_id, 'Document needed — deal ' || _num,
      NEW.label || coalesce(': ' || NEW.message, ''), 'warning', NEW.deal_id);
  ELSIF NEW.status = 'fulfilled' AND OLD.status = 'open' THEN
    INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
    VALUES (NEW.deal_id, 'document_request', 'Received from dealer: ' || NEW.label, NULL,
            jsonb_build_object('request_id', NEW.id, 'doc_type', NEW.doc_type, 'fulfilled', true));
    IF public.pref_enabled('notify_uploads') THEN
      PERFORM public.notify_role(
        coalesce(public.department_role((SELECT public.status_department(status) FROM public.deals WHERE id = NEW.deal_id)), 'admin'),
        'Dealer sent ' || NEW.label || ' — deal ' || _num, 'The requested document was received.', 'success', NEW.deal_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS document_requests_after ON public.document_requests;
CREATE TRIGGER document_requests_after AFTER INSERT OR UPDATE OF status ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_document_requests_after();

-- ---------------------------------------------------------------- staff actions (RPC)
CREATE OR REPLACE FUNCTION public.record_credit_decision(_deal_id uuid, _decision text, _notes text DEFAULT NULL,
  _score integer DEFAULT NULL, _tier public.credit_tier DEFAULT NULL, _bureau public.credit_bureau DEFAULT NULL)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'credit_analyst') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only credit analysts can record a credit decision' USING ERRCODE = '42501';
  END IF;
  IF _decision NOT IN ('approved', 'conditional', 'declined') THEN
    RAISE EXCEPTION 'Unknown credit decision %', _decision USING ERRCODE = '22023';
  END IF;
  UPDATE public.deals SET
    credit_score = coalesce(_score, credit_score),
    credit_tier = coalesce(_tier, credit_tier),
    credit_bureau = coalesce(_bureau, credit_bureau),
    credit_pulled_at = CASE WHEN _score IS NOT NULL THEN coalesce(credit_pulled_at, now()) ELSE credit_pulled_at END,
    credit_decision_notes = _notes,
    credit_decision_by = auth.uid(),
    credit_decision_at = now(),
    decision_notes = CASE WHEN _decision = 'declined' THEN coalesce(_notes, decision_notes) ELSE decision_notes END,
    decision_by = CASE WHEN _decision = 'declined' THEN auth.uid() ELSE decision_by END,
    credit_decision = _decision
  WHERE id = _deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'decision', 'Credit ' || _decision || coalesce(' — ' || _notes, ''), auth.uid(),
          jsonb_build_object('decision', _decision, 'step', 'credit'));
  RETURN (SELECT status FROM public.deals WHERE id = _deal_id);
END $$;

CREATE OR REPLACE FUNCTION public.update_funding_checklist(_deal_id uuid, _items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'funding_manager') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only funding managers can update the funding checklist' USING ERRCODE = '42501';
  END IF;
  UPDATE public.deals SET funding_checklist = funding_checklist || coalesce(_items, '{}'::jsonb)
  WHERE id = _deal_id RETURNING funding_checklist INTO _out;
  RETURN _out;
END $$;

CREATE OR REPLACE FUNCTION public.approve_funding(_deal_id uuid, _notes text DEFAULT NULL)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _missing text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'funding_manager') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only funding managers can approve funding' USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(item ->> 'label', ', ') INTO _missing
  FROM public.app_settings s, jsonb_array_elements(s.funding_checklist_items) item, public.deals d
  WHERE s.id AND d.id = _deal_id AND coalesce((d.funding_checklist ->> (item ->> 'key'))::boolean, false) = false;
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'Funding checklist incomplete: %', _missing USING ERRCODE = '23514';
  END IF;
  UPDATE public.deals SET funding_approved_at = now(), funding_approved_by = auth.uid(),
         decision_by = auth.uid(), decision_at = now(), decision_notes = coalesce(_notes, decision_notes)
  WHERE id = _deal_id AND status IN ('funding_review', 'approved');
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal is not in funding review' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'decision', 'Approved for funding' || coalesce(' — ' || _notes, ''), auth.uid(),
          jsonb_build_object('step', 'funding_approval'));
  RETURN (SELECT status FROM public.deals WHERE id = _deal_id);
END $$;

CREATE OR REPLACE FUNCTION public.mark_funded(_deal_id uuid, _amount numeric DEFAULT NULL)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'funding_manager') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only funding managers can mark a deal funded' USING ERRCODE = '42501';
  END IF;
  UPDATE public.deals SET funded_at = now(), funded_by = auth.uid(), funded_amount = coalesce(_amount, loan_amount)
  WHERE id = _deal_id AND status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal must be approved before it is funded' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'decision', 'Loan funded', auth.uid(), jsonb_build_object('step', 'funded'));
  RETURN (SELECT status FROM public.deals WHERE id = _deal_id);
END $$;

CREATE OR REPLACE FUNCTION public.request_document(_deal_id uuid, _doc_type public.document_type, _message text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _dealer uuid;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can request documents' USING ERRCODE = '42501';
  END IF;
  SELECT dealer_id INTO _dealer FROM public.deals WHERE id = _deal_id;
  IF _dealer IS NULL THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002'; END IF;
  SELECT id INTO _id FROM public.document_requests WHERE deal_id = _deal_id AND doc_type = _doc_type AND status = 'open';
  IF _id IS NOT NULL THEN RETURN _id; END IF;
  INSERT INTO public.document_requests (deal_id, dealer_id, doc_type, label, message, source, requested_by)
  VALUES (_deal_id, _dealer, _doc_type, public.document_type_label(_doc_type), _message, 'staff', auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.request_missing_documents(_deal_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _item record; _n integer := 0;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Only staff can request documents' USING ERRCODE = '42501';
  END IF;
  FOR _item IN SELECT * FROM public.deal_checklist(_deal_id) WHERE NOT satisfied AND open_request_id IS NULL LOOP
    PERFORM public.request_document(_deal_id, _item.doc_types[1], 'Missing from submission');
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- ---------------------------------------------------------------- submission (dealer portal + staff)
-- Creates customer, vehicle, deal and the stated income source in one transaction.
-- Dealers can only submit for their own dealership.
CREATE OR REPLACE FUNCTION public.submit_deal(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _dealer uuid;
  _is_dealer boolean;
  _customer uuid;
  _vehicle uuid;
  _deal uuid;
  _c jsonb := coalesce(_payload -> 'customer', '{}'::jsonb);
  _v jsonb := coalesce(_payload -> 'vehicle', '{}'::jsonb);
  _f jsonb := coalesce(_payload -> 'financing', '{}'::jsonb);
  _e jsonb := coalesce(_payload -> 'employment', '{}'::jsonb);
  _t jsonb := _payload -> 'trade_in';
  _loan numeric; _down numeric; _apr numeric; _term integer; _rate numeric; _payment numeric; _price numeric;
  _income numeric;
  _dealer_name text;
BEGIN
  IF public.is_staff(auth.uid()) THEN
    _is_dealer := false;
    _dealer := nullif(_payload ->> 'dealer_id', '')::uuid;
  ELSE
    _is_dealer := true;
    _dealer := public.current_dealer_id();
  END IF;
  IF _dealer IS NULL THEN
    RAISE EXCEPTION 'No dealership linked to this account' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO _dealer_name FROM public.dealers WHERE id = _dealer AND status <> 'suspended';
  IF _dealer_name IS NULL THEN RAISE EXCEPTION 'Dealer is not active' USING ERRCODE = '42501'; END IF;

  IF coalesce(_c ->> 'first_name', '') = '' OR coalesce(_c ->> 'last_name', '') = '' THEN
    RAISE EXCEPTION 'Customer name is required' USING ERRCODE = '23502';
  END IF;

  _price := coalesce(nullif(_v ->> 'invoice_price', '')::numeric, 0);
  _down := coalesce(nullif(_f ->> 'down_payment', '')::numeric, 0);
  _loan := coalesce(nullif(_f ->> 'loan_amount', '')::numeric, greatest(_price - _down, 0));
  _apr := coalesce(nullif(_f ->> 'apr', '')::numeric, 0);
  _term := coalesce(nullif(_f ->> 'term_months', '')::integer, 60);
  IF _loan <= 0 OR _term <= 0 THEN RAISE EXCEPTION 'Loan amount and term are required' USING ERRCODE = '23502'; END IF;
  _rate := _apr / 100 / 12;
  _payment := CASE WHEN _rate = 0 THEN _loan / _term ELSE _loan * _rate / (1 - power(1 + _rate, -_term)) END;
  _payment := round(_payment, 2);
  _income := nullif(_e ->> 'monthly_income', '')::numeric;

  INSERT INTO public.customers (first_name, last_name, email, phone, street, city, state, zip, employer, job_title,
                                monthly_income, years_employed, date_of_birth)
  VALUES (_c ->> 'first_name', _c ->> 'last_name', coalesce(_c ->> 'email', ''), coalesce(_c ->> 'phone', ''),
          _c ->> 'street', _c ->> 'city', _c ->> 'state', _c ->> 'zip', nullif(_e ->> 'employer', ''), _e ->> 'job_title',
          _income, nullif(_e ->> 'years_employed', '')::numeric, nullif(_c ->> 'date_of_birth', '')::date)
  RETURNING id INTO _customer;

  INSERT INTO public.vehicles (year, make, model, trim, vin, mileage, color, condition, msrp, invoice_price)
  VALUES (coalesce(nullif(_v ->> 'year', '')::integer, extract(year FROM now())::integer), coalesce(_v ->> 'make', ''),
          coalesce(_v ->> 'model', ''), _v ->> 'trim', coalesce(_v ->> 'vin', ''), coalesce(nullif(_v ->> 'mileage', '')::integer, 0),
          _v ->> 'color', coalesce(nullif(_v ->> 'condition', ''), 'used')::public.vehicle_condition,
          nullif(_v ->> 'msrp', '')::numeric, _price)
  RETURNING id INTO _vehicle;

  INSERT INTO public.deals (customer_id, vehicle_id, dealer_id, priority, loan_amount, down_payment, apr, term_months,
                            monthly_payment, total_interest, total_cost, ltv, created_by, submitted_by_dealer,
                            trade_in_year, trade_in_make, trade_in_model, trade_in_vin, trade_in_mileage, trade_in_payoff, trade_in_value,
                            trade_in_credit)
  VALUES (_customer, _vehicle, _dealer, coalesce(nullif(_payload ->> 'priority', ''), 'normal')::public.deal_priority,
          _loan, _down, _apr, _term, _payment, round(_payment * _term - _loan, 2), round(_payment * _term + _down, 2),
          CASE WHEN _price > 0 THEN round(_loan / _price * 100, 1) ELSE NULL END, auth.uid(), _is_dealer,
          nullif(_t ->> 'year', '')::integer, _t ->> 'make', _t ->> 'model', nullif(_t ->> 'vin', ''),
          nullif(_t ->> 'mileage', '')::integer, nullif(_t ->> 'payoff', '')::numeric, nullif(_t ->> 'value', '')::numeric,
          CASE WHEN _t IS NOT NULL THEN nullif(_t ->> 'value', '')::numeric - coalesce(nullif(_t ->> 'payoff', '')::numeric, 0) END)
  RETURNING id INTO _deal;

  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal, 'status_change',
          CASE WHEN _is_dealer THEN 'Submitted by ' || _dealer_name ELSE 'Deal created for ' || _dealer_name END,
          auth.uid(), jsonb_build_object('submitted_by_dealer', _is_dealer));

  IF coalesce(_e ->> 'employer', '') <> '' OR _income IS NOT NULL THEN
    INSERT INTO public.income_sources (deal_id, customer_id, source_type, employer_name, job_title,
                                       stated_monthly_income, is_primary, verification_status, calc_method)
    VALUES (_deal, _customer, coalesce(nullif(_e ->> 'income_type', ''), 'salaried')::public.income_source_type,
            coalesce(nullif(_e ->> 'employer', ''), 'Not provided'), _e ->> 'job_title', coalesce(_income, 0), true,
            'unverified', 'mi');
  END IF;

  IF public.pref_enabled('notify_new') THEN
    PERFORM public.notify_role('admin', 'New deal from ' || _dealer_name,
      (_c ->> 'first_name') || ' ' || (_c ->> 'last_name'), 'info', _deal);
  END IF;
  RETURN _deal;
END $$;

-- ---------------------------------------------------------------- stats view
CREATE OR REPLACE VIEW public.dealer_stats WITH (security_invoker = true) AS
SELECT d.id AS dealer_id,
       count(x.id)::int AS total_deals,
       count(x.id) FILTER (WHERE x.status NOT IN ('funded', 'declined', 'incomplete'))::int AS active_deals,
       count(x.id) FILTER (WHERE x.status = 'funded')::int AS funded_deals,
       count(x.id) FILTER (WHERE x.status = 'declined')::int AS declined_deals,
       CASE WHEN count(x.id) FILTER (WHERE x.status IN ('funded', 'approved', 'declined')) = 0 THEN NULL
            ELSE round(100.0 * count(x.id) FILTER (WHERE x.status IN ('funded', 'approved'))
                 / count(x.id) FILTER (WHERE x.status IN ('funded', 'approved', 'declined')))::int END AS approval_rate
FROM public.dealers d LEFT JOIN public.deals x ON x.dealer_id = d.id
GROUP BY d.id;

-- ---------------------------------------------------------------- security: who sees what
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read settings" ON public.app_settings;
CREATE POLICY "Staff can read settings" ON public.app_settings FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Admins can update settings" ON public.app_settings;
CREATE POLICY "Admins can update settings" ON public.app_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can see own dealer link" ON public.dealer_users;
CREATE POLICY "Users can see own dealer link" ON public.dealer_users FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Admins manage dealer links" ON public.dealer_users;
CREATE POLICY "Admins manage dealer links" ON public.dealer_users FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Staff and owning dealer can view requests" ON public.document_requests;
CREATE POLICY "Staff and owning dealer can view requests" ON public.document_requests FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR dealer_id = public.current_dealer_id());
DROP POLICY IF EXISTS "Staff manage requests" ON public.document_requests;
CREATE POLICY "Staff manage requests" ON public.document_requests FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- profiles
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Staff can view profiles" ON public.profiles;
CREATE POLICY "Staff can view profiles" ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- dealers
DROP POLICY IF EXISTS "Authenticated users can view dealers" ON public.dealers;
DROP POLICY IF EXISTS "Staff and own dealer can view dealers" ON public.dealers;
CREATE POLICY "Staff and own dealer can view dealers" ON public.dealers FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR id = public.current_dealer_id());

-- customers / vehicles: staff, or the dealer whose deal they belong to
DROP POLICY IF EXISTS "Authenticated users can view customers" ON public.customers;
DROP POLICY IF EXISTS "Authenticated users can insert customers" ON public.customers;
DROP POLICY IF EXISTS "Staff and owning dealer can view customers" ON public.customers;
CREATE POLICY "Staff and owning dealer can view customers" ON public.customers FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.deals d WHERE d.customer_id = customers.id AND d.dealer_id = public.current_dealer_id()));
DROP POLICY IF EXISTS "Staff can insert customers" ON public.customers;
CREATE POLICY "Staff can insert customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can update customers" ON public.customers;
CREATE POLICY "Staff can update customers" ON public.customers FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Authenticated users can insert vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Staff and owning dealer can view vehicles" ON public.vehicles;
CREATE POLICY "Staff and owning dealer can view vehicles" ON public.vehicles FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.deals d WHERE d.vehicle_id = vehicles.id AND d.dealer_id = public.current_dealer_id()));
DROP POLICY IF EXISTS "Staff can insert vehicles" ON public.vehicles;
CREATE POLICY "Staff can insert vehicles" ON public.vehicles FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can update vehicles" ON public.vehicles;
CREATE POLICY "Staff can update vehicles" ON public.vehicles FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));

-- deals
DROP POLICY IF EXISTS "Authenticated users can view deals" ON public.deals;
DROP POLICY IF EXISTS "Authenticated users can insert deals" ON public.deals;
DROP POLICY IF EXISTS "Authenticated users can update deals" ON public.deals;
DROP POLICY IF EXISTS "Staff and owning dealer can view deals" ON public.deals;
CREATE POLICY "Staff and owning dealer can view deals" ON public.deals FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR dealer_id = public.current_dealer_id());
DROP POLICY IF EXISTS "Staff can insert deals" ON public.deals;
CREATE POLICY "Staff can insert deals" ON public.deals FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can update deals" ON public.deals;
CREATE POLICY "Staff can update deals" ON public.deals FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));

-- documents: dealers can view and add documents on their own deals, never change them
DROP POLICY IF EXISTS "Authenticated users can view documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated users can insert documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated users can update documents" ON public.documents;
DROP POLICY IF EXISTS "Staff and owning dealer can view documents" ON public.documents;
CREATE POLICY "Staff and owning dealer can view documents" ON public.documents FOR SELECT TO authenticated
  USING (public.can_access_deal(deal_id));
DROP POLICY IF EXISTS "Staff and owning dealer can add documents" ON public.documents;
CREATE POLICY "Staff and owning dealer can add documents" ON public.documents FOR INSERT TO authenticated
  WITH CHECK (public.can_access_deal(deal_id) AND (public.is_staff(auth.uid()) OR status = 'pending'));
DROP POLICY IF EXISTS "Staff can update documents" ON public.documents;
CREATE POLICY "Staff can update documents" ON public.documents FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can delete documents" ON public.documents;
CREATE POLICY "Staff can delete documents" ON public.documents FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

-- notes: internal notes are staff-only; dealers see and write the shared (non-internal) thread
DROP POLICY IF EXISTS "Authenticated users can view notes" ON public.deal_notes;
DROP POLICY IF EXISTS "Authenticated users can insert notes" ON public.deal_notes;
DROP POLICY IF EXISTS "Staff and owning dealer can view notes" ON public.deal_notes;
CREATE POLICY "Staff and owning dealer can view notes" ON public.deal_notes FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR (NOT is_internal AND public.can_access_deal(deal_id)));
DROP POLICY IF EXISTS "Staff and owning dealer can add notes" ON public.deal_notes;
CREATE POLICY "Staff and owning dealer can add notes" ON public.deal_notes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND public.can_access_deal(deal_id) AND (public.is_staff(auth.uid()) OR NOT is_internal));

-- timeline: staff only (dealers get notifications instead)
DROP POLICY IF EXISTS "Authenticated users can view timeline" ON public.deal_timeline;
DROP POLICY IF EXISTS "Authenticated users can insert timeline" ON public.deal_timeline;
DROP POLICY IF EXISTS "Staff can view timeline" ON public.deal_timeline;
CREATE POLICY "Staff can view timeline" ON public.deal_timeline FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can add timeline" ON public.deal_timeline;
CREATE POLICY "Staff can add timeline" ON public.deal_timeline FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

-- notifications can only be created by staff or by the database itself
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Staff can insert notifications" ON public.notifications;
CREATE POLICY "Staff can insert notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

-- underwriting data: staff only (these policies previously had no role restriction)
DROP POLICY IF EXISTS "Authenticated users can view extracted data" ON public.extracted_income_data;
DROP POLICY IF EXISTS "Authenticated users can insert extracted data" ON public.extracted_income_data;
DROP POLICY IF EXISTS "Authenticated users can update extracted data" ON public.extracted_income_data;
DROP POLICY IF EXISTS "Staff manage extracted data" ON public.extracted_income_data;
CREATE POLICY "Staff manage extracted data" ON public.extracted_income_data FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view income sources" ON public.income_sources;
DROP POLICY IF EXISTS "Authenticated users can insert income sources" ON public.income_sources;
DROP POLICY IF EXISTS "Authenticated users can update income sources" ON public.income_sources;
DROP POLICY IF EXISTS "Staff can view income sources" ON public.income_sources;
CREATE POLICY "Staff can view income sources" ON public.income_sources FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can insert income sources" ON public.income_sources;
CREATE POLICY "Staff can insert income sources" ON public.income_sources FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can update income sources" ON public.income_sources;
CREATE POLICY "Staff can update income sources" ON public.income_sources FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view debts" ON public.applicant_debts;
DROP POLICY IF EXISTS "Authenticated users can insert debts" ON public.applicant_debts;
DROP POLICY IF EXISTS "Authenticated users can update debts" ON public.applicant_debts;
DROP POLICY IF EXISTS "Staff can view debts" ON public.applicant_debts;
CREATE POLICY "Staff can view debts" ON public.applicant_debts FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can insert debts" ON public.applicant_debts;
CREATE POLICY "Staff can insert debts" ON public.applicant_debts FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Staff can update debts" ON public.applicant_debts;
CREATE POLICY "Staff can update debts" ON public.applicant_debts FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));

-- storage: files live under "<deal_id>/…"
DROP POLICY IF EXISTS "Authenticated users can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view documents" ON storage.objects;
DROP POLICY IF EXISTS "Deal members can upload documents" ON storage.objects;
CREATE POLICY "Deal members can upload documents" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND public.can_access_document_path(name));
DROP POLICY IF EXISTS "Deal members can view documents" ON storage.objects;
CREATE POLICY "Deal members can view documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND public.can_access_document_path(name));
DROP POLICY IF EXISTS "Staff can delete documents" ON storage.objects;
CREATE POLICY "Staff can delete documents" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND public.is_staff(auth.uid()));

-- ---------------------------------------------------------------- function access
REVOKE EXECUTE ON FUNCTION public.autoroute_deal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_document_requests(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_dealer(uuid, text, text, public.notification_type, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_role(public.app_role, text, text, public.notification_type, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.autoroute_deal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_document_requests(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.submit_deal(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_credit_decision(uuid, text, text, integer, public.credit_tier, public.credit_bureau) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_funding(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_funded(uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_document(uuid, public.document_type, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_missing_documents(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_funding_checklist(uuid, jsonb) FROM anon;

-- ---------------------------------------------------------------- realtime
DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['documents', 'document_requests', 'deal_timeline', 'income_sources'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = _t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', _t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------- roles bootstrap
-- Everyone who already had an account before this migration was internal staff
-- (there was no dealer access yet), so they keep full access as admins.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id)
ON CONFLICT DO NOTHING;

-- On a fresh project, the very first account becomes admin; later sign-ups wait for an
-- admin to give them a role or link them to a dealership.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.email), NEW.email);
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END $$;
