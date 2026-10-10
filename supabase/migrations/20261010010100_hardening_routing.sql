-- =====================================================================================
-- AutoFlow production hardening, part 2: checklist, document requests and routing.
--
--  * A document holds the deal back only while it is being read for the first time:
--    pending for less than 30 minutes, or processing for less than 15 minutes. A document that
--    was already read once (processed_at set) still counts while it is re-read, so a re-read
--    never opens a request or notifies anyone.
--  * One checklist item per income category, needing one document per income source of that
--    category ("Pay Stub (2)"); trade-in documents whenever a trade-in is recorded.
--  * A request closes when its checklist item is satisfied (an employment letter closes a
--    Pay Stub request). Requests are opened in Document Review and, when an item becomes
--    unsatisfied later (rejected / deleted document), in Credit Review, Income Verification
--    and Funding Review too. Routing never moves a deal backwards.
--  * autoroute_deal locks the deal before looking at its documents (two documents finishing
--    at the same time no longer both conclude "the other one is still being read").
--  * A vehicle used for work declines the deal (preference decline_vehicle_for_work).
--  * Switching an automation (or the vehicle-for-work rule) on re-checks every open deal.
-- =====================================================================================

-- ---------------------------------------------------------------- small rules
-- counts towards the checklist: not rejected, and read (or already read once and being re-read)
CREATE OR REPLACE FUNCTION public.document_counts(_status public.document_status, _processing_status text, _processed_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _status <> 'rejected'
     AND (_processing_status NOT IN ('pending', 'processing') OR _processed_at IS NOT NULL)
$$;

-- holds the deal back: a first read that is still plausibly running
CREATE OR REPLACE FUNCTION public.document_blocks(_processing_status text, _processed_at timestamptz,
  _created_at timestamptz, _processing_started_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT _processed_at IS NULL AND (
       (_processing_status = 'pending' AND _created_at > now() - interval '30 minutes')
    OR (_processing_status = 'processing' AND coalesce(_processing_started_at, _created_at) > now() - interval '15 minutes'))
$$;

CREATE OR REPLACE FUNCTION public.deal_has_trade_in(_vin text, _make text, _value numeric, _payoff numeric)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(btrim(_vin), '') <> '' OR coalesce(btrim(_make), '') <> ''
      OR coalesce(_value, 0) > 0 OR coalesce(_payoff, 0) > 0
$$;

CREATE OR REPLACE FUNCTION public.income_category(_t public.income_source_type)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _t IN ('self_employed', 'contractor') THEN 'self_employed'
    WHEN _t IN ('pension', 'government_assistance', 'unemployed') THEN 'benefits'
    ELSE 'employment' END
$$;

-- ---------------------------------------------------------------- checklist
-- Internal (no access check): what the deal needs, and whether it is there.
CREATE OR REPLACE FUNCTION public.deal_checklist_items(_deal_id uuid)
RETURNS TABLE (item_key text, label text, doc_types public.document_type[], satisfied boolean,
               document_count integer, open_request_id uuid, required_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH deal AS (
    SELECT * FROM public.deals WHERE id = _deal_id
  ), cats AS (
    SELECT public.income_category(s.source_type) AS cat, count(*)::int AS n
    FROM public.income_sources s WHERE s.deal_id = _deal_id
    GROUP BY 1
  ), items AS (
    SELECT u.t::text AS k, public.document_type_label(u.t) AS l, ARRAY[u.t] AS types, 1 AS need, u.ord::int AS ord
    FROM public.app_settings st, unnest(st.required_documents) WITH ORDINALITY AS u(t, ord)
    WHERE st.id
    UNION ALL
    SELECT 'trade_in', 'Trade-In Documentation', ARRAY['trade_in'::public.document_type], 1, 50
    FROM deal WHERE public.deal_has_trade_in(deal.trade_in_vin, deal.trade_in_make, deal.trade_in_value, deal.trade_in_payoff)
    UNION ALL
    SELECT 'income_' || c.cat,
           CASE c.cat WHEN 'self_employed' THEN 'Bank Statements (self-employed income)'
                      WHEN 'benefits' THEN 'Benefit / Pension Letter'
                      ELSE 'Pay Stub' END
             || CASE WHEN c.n > 1 THEN ' (' || c.n || ')' ELSE '' END,
           CASE c.cat WHEN 'self_employed' THEN ARRAY['bank_statement']::public.document_type[]
                      WHEN 'benefits' THEN ARRAY['income_verification', 'bank_statement']::public.document_type[]
                      ELSE ARRAY['pay_stub', 'income_verification']::public.document_type[] END,
           c.n, 20
    FROM cats c
    UNION ALL
    SELECT 'income_employment', 'Pay Stub', ARRAY['pay_stub', 'income_verification']::public.document_type[], 1, 20
    FROM deal WHERE NOT EXISTS (SELECT 1 FROM cats)
  )
  SELECT i.k, i.l, i.types, cnt.n >= i.need, cnt.n,
         (SELECT r.id FROM public.document_requests r
          WHERE r.deal_id = _deal_id AND r.status = 'open' AND r.doc_type = ANY (i.types)
          ORDER BY (r.doc_type = i.types[1]) DESC, r.created_at LIMIT 1),
         i.need
  FROM items i
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS n FROM public.documents d
    WHERE d.deal_id = _deal_id AND d.type = ANY (i.types)
      AND public.document_counts(d.status, d.processing_status, d.processed_at)
  ) cnt
  ORDER BY i.ord, i.k
$$;

-- The app's view of the checklist (staff, or the dealer who owns the deal).
-- required_count is new: how many documents the item needs (e.g. 2 for "Pay Stub (2)").
DROP FUNCTION IF EXISTS public.deal_checklist(uuid);
CREATE FUNCTION public.deal_checklist(_deal_id uuid)
RETURNS TABLE (item_key text, label text, doc_types public.document_type[], satisfied boolean,
               document_count integer, open_request_id uuid, required_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_access_deal(_deal_id) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.deal_checklist_items(_deal_id);
END $$;

-- nothing on the deal is still being read for the first time
CREATE OR REPLACE FUNCTION public.deal_documents_settled(_deal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.documents d
                     WHERE d.deal_id = _deal_id
                       AND public.document_blocks(d.processing_status, d.processed_at, d.created_at, d.processing_started_at))
$$;

-- a document that was read before is being read again right now
CREATE OR REPLACE FUNCTION public.deal_rereading(_deal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.documents d
                 WHERE d.deal_id = _deal_id AND d.processed_at IS NOT NULL AND d.processing_status = 'processing'
                   AND coalesce(d.processing_started_at, d.created_at) > now() - interval '15 minutes')
$$;

-- ---------------------------------------------------------------- notifications
-- Only users holding exactly that role (so admins only when the role is admin), and never the
-- same title about the same deal to the same person twice within 60 seconds.
CREATE OR REPLACE FUNCTION public.notify_role(_role public.app_role, _title text, _message text,
  _type public.notification_type, _deal_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, title, message, type, deal_id)
  SELECT DISTINCT ur.user_id, _title, _message, _type, _deal_id
  FROM public.user_roles ur
  WHERE ur.role = _role
    AND NOT EXISTS (SELECT 1 FROM public.notifications n
                    WHERE n.user_id = ur.user_id AND n.title = _title AND n.deal_id IS NOT DISTINCT FROM _deal_id
                      AND n.created_at > now() - interval '60 seconds')
$$;

-- dealer accounts of the dealership (still holding the dealer role); same message not repeated within 60 s
CREATE OR REPLACE FUNCTION public.notify_dealer(_dealer_id uuid, _title text, _message text,
  _type public.notification_type, _deal_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, title, message, type, deal_id)
  SELECT DISTINCT du.user_id, _title, _message, _type, _deal_id
  FROM public.dealer_users du
  JOIN public.user_roles r ON r.user_id = du.user_id AND r.role = 'dealer'
  WHERE du.dealer_id = _dealer_id
    AND NOT EXISTS (SELECT 1 FROM public.notifications n
                    WHERE n.user_id = du.user_id AND n.title = _title AND n.message = _message
                      AND n.deal_id IS NOT DISTINCT FROM _deal_id AND n.created_at > now() - interval '60 seconds')
$$;

-- ---------------------------------------------------------------- request sync
CREATE OR REPLACE FUNCTION public.sync_document_requests(_deal_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _deal public.deals%ROWTYPE;
  _r record;
  _item record;
  _doc uuid;
  _opened integer := 0;
BEGIN
  SELECT * INTO _deal FROM public.deals WHERE id = _deal_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- close requests whose checklist item is satisfied
  FOR _r IN SELECT * FROM public.document_requests WHERE deal_id = _deal_id AND status = 'open' ORDER BY created_at LOOP
    _doc := NULL;
    SELECT c.* INTO _item FROM public.deal_checklist_items(_deal_id) c
    WHERE CASE WHEN _r.source = 'automation' THEN c.doc_types[1] = _r.doc_type ELSE _r.doc_type = ANY (c.doc_types) END
    ORDER BY (c.doc_types[1] = _r.doc_type) DESC
    LIMIT 1;

    IF _item.item_key IS NULL THEN
      IF _r.source = 'automation' THEN
        -- the item is no longer on the checklist (trade-in removed, income type changed…)
        UPDATE public.document_requests SET status = 'cancelled' WHERE id = _r.id;
        CONTINUE;
      END IF;
      -- a staff request for something outside the checklist: a new document of that type
      SELECT d.id INTO _doc FROM public.documents d
      WHERE d.deal_id = _deal_id AND d.type = _r.doc_type AND d.created_at >= _r.created_at
        AND public.document_counts(d.status, d.processing_status, d.processed_at)
      ORDER BY d.created_at DESC LIMIT 1;
    ELSIF _r.source = 'automation' THEN
      IF _item.satisfied THEN
        SELECT d.id INTO _doc FROM public.documents d
        WHERE d.deal_id = _deal_id AND d.type = ANY (_item.doc_types)
          AND public.document_counts(d.status, d.processing_status, d.processed_at)
        ORDER BY d.created_at DESC LIMIT 1;
      END IF;
    ELSE
      -- staff asked for it explicitly: a new document for the item, sent after the request
      SELECT d.id INTO _doc FROM public.documents d
      WHERE d.deal_id = _deal_id AND d.type = ANY (_item.doc_types) AND d.created_at >= _r.created_at
        AND public.document_counts(d.status, d.processing_status, d.processed_at)
      ORDER BY d.created_at DESC LIMIT 1;
    END IF;

    IF _doc IS NOT NULL THEN
      UPDATE public.document_requests SET status = 'fulfilled', fulfilled_at = now(), fulfilled_document_id = _doc
      WHERE id = _r.id;
    END IF;
  END LOOP;

  IF _deal.status IN ('declined', 'funded') THEN
    UPDATE public.document_requests SET status = 'cancelled' WHERE deal_id = _deal_id AND status = 'open';
    RETURN 0;
  END IF;

  -- open requests for what is missing: only once nothing is being read for the first time,
  -- never while an already-read document is being re-read, and only after the dealer sent something
  IF NOT public.automation_enabled('auto_request_docs')
     OR _deal.status NOT IN ('document_review', 'credit_review', 'income_verification', 'funding_review')
     OR NOT public.deal_documents_settled(_deal_id)
     OR public.deal_rereading(_deal_id)
     OR NOT EXISTS (SELECT 1 FROM public.documents WHERE deal_id = _deal_id) THEN
    RETURN 0;
  END IF;

  FOR _item IN SELECT * FROM public.deal_checklist_items(_deal_id) WHERE NOT satisfied AND open_request_id IS NULL LOOP
    INSERT INTO public.document_requests (deal_id, dealer_id, doc_type, label, message, source)
    VALUES (_deal_id, _deal.dealer_id, _item.doc_types[1], _item.label,
            CASE WHEN _deal.status = 'document_review' THEN 'Missing from submission' ELSE 'Needed to complete the file' END,
            'automation')
    ON CONFLICT DO NOTHING;
    IF FOUND THEN _opened := _opened + 1; END IF;
  END LOOP;
  RETURN _opened;
END $$;

-- ---------------------------------------------------------------- declining
-- Moves an open deal to Declined, logs the internal reason on the staff history, tells the
-- dealer (dealer_message, or a generic sentence) and cancels open requests. _actor is NULL
-- for automatic declines. Used by decline_deal, record_credit_decision and the policy rules.
CREATE OR REPLACE FUNCTION public.decline_deal_internal(_deal_id uuid, _reason text, _dealer_message text,
  _reason_code text, _actor uuid)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d public.deals%ROWTYPE;
BEGIN
  SELECT * INTO _d FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002'; END IF;
  IF _d.status IN ('declined', 'funded') THEN
    RAISE EXCEPTION 'Deal is already %', lower(public.deal_status_label(_d.status)) USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'status_change', 'Declined — ' || _reason, _actor,
          jsonb_build_object('from', _d.status, 'to', 'declined', 'reason', _reason, 'reason_code', _reason_code,
                             'dealer_message', _dealer_message, 'manual', _actor IS NOT NULL)
          || CASE WHEN _actor IS NULL THEN jsonb_build_object('automation', 'policy') ELSE '{}'::jsonb END);

  PERFORM set_config('autoflow.action', 'on', true);
  UPDATE public.deals SET status = 'declined', decision_by = _actor, decision_at = now(), dealer_message = _dealer_message
  WHERE id = _deal_id;
  PERFORM set_config('autoflow.action', 'off', true);

  PERFORM public.notify_dealer(_d.dealer_id, 'Deal ' || _d.deal_number || ': Declined',
    coalesce(_dealer_message, 'The lender declined this application.'), 'error', _deal_id);
  PERFORM public.sync_document_requests(_deal_id);
  RETURN 'declined';
END $$;

-- ---------------------------------------------------------------- routing
CREATE OR REPLACE FUNCTION public.next_deal_status(_deal public.deals, OUT next_status public.deal_status, OUT reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  next_status := NULL; reason := NULL;
  CASE _deal.status
    WHEN 'new_submission' THEN
      next_status := 'document_review'; reason := 'Submission received';
    WHEN 'document_review' THEN
      IF public.deal_documents_settled(_deal.id)
         AND NOT EXISTS (SELECT 1 FROM public.deal_checklist_items(_deal.id) c WHERE NOT c.satisfied) THEN
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
  -- Lock the deal FIRST, before its documents are looked at. Two documents of one deal that
  -- finish at the same moment are then handled one after the other, and the second (READ
  -- COMMITTED: every statement below takes a fresh snapshot) sees the first one as read, so
  -- the missing-document requests are opened. Without the lock, each saw the other as
  -- "still being read" and nobody opened them.
  SELECT * INTO _deal FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- an admin is moving this deal by hand right now (admin_move_deal): leave it where it is put
  IF current_setting('autoflow.hold_deal', true) = _deal_id::text THEN
    RETURN _deal.status;
  END IF;

  -- policy: a vehicle used for work is not financed
  IF _deal.status NOT IN ('declined', 'funded') AND public.pref_bool('decline_vehicle_for_work', true)
     AND EXISTS (SELECT 1 FROM public.income_sources WHERE deal_id = _deal_id AND vehicle_for_work) THEN
    RETURN public.decline_deal_internal(_deal_id, 'Vehicle used for work (not eligible)',
      'This vehicle use isn''t eligible for financing.', 'vehicle_for_work', NULL);
  END IF;

  PERFORM public.sync_document_requests(_deal_id);
  IF NOT public.automation_enabled('auto_route') THEN
    RETURN _deal.status;
  END IF;

  LOOP
    _i := _i + 1;
    SELECT * INTO _deal FROM public.deals WHERE id = _deal_id FOR UPDATE;
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

    -- a status change can open or close requests
    PERFORM public.sync_document_requests(_deal_id);
  END LOOP;
  RETURN _deal.status;
END $$;

-- ---------------------------------------------------------------- triggers
-- status changes made outside the routing: the AutoFlow actions log and notify themselves
-- (autoflow.action); anything else (service role, SQL) is still logged and told to the dealer.
CREATE OR REPLACE FUNCTION public.trg_deals_status_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR coalesce(current_setting('autoflow.routing', true), 'off') = 'on' THEN
    RETURN NULL;
  END IF;
  IF coalesce(current_setting('autoflow.action', true), 'off') <> 'on' THEN
    INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
    VALUES (NEW.id, 'status_change',
            'Moved from ' || public.deal_status_label(OLD.status) || ' to ' || public.deal_status_label(NEW.status),
            auth.uid(), jsonb_build_object('from', OLD.status, 'to', NEW.status, 'manual', true));
    PERFORM public.notify_dealer(NEW.dealer_id, 'Deal ' || NEW.deal_number || ': ' || public.deal_status_label(NEW.status),
      'Status updated by the lender.',
      CASE WHEN NEW.status = 'declined' THEN 'error' WHEN NEW.status IN ('approved', 'funded') THEN 'success' ELSE 'info' END::public.notification_type,
      NEW.id);
  END IF;
  PERFORM public.sync_document_requests(NEW.id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS deals_route_on_decision ON public.deals;
CREATE TRIGGER deals_route_on_decision
  AFTER UPDATE OF credit_decision, funding_approved_at, funded_at, trade_in_vin, trade_in_make, trade_in_value, trade_in_payoff
  ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_deals_route();

DROP TRIGGER IF EXISTS income_sources_route ON public.income_sources;
CREATE TRIGGER income_sources_route
  AFTER INSERT OR DELETE OR UPDATE OF verification_status, source_type, vehicle_for_work ON public.income_sources
  FOR EACH ROW EXECUTE FUNCTION public.trg_income_sources_route();

-- Switching an automation from off to on (or the vehicle-for-work rule, or changing the
-- required documents) re-checks every open deal.
CREATE OR REPLACE FUNCTION public.trg_app_settings_reevaluate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _turned_on boolean;
  _id uuid;
BEGIN
  SELECT coalesce(bool_or(lower(coalesce(NEW.automations ->> o.key, 'true')) <> 'false'), false) INTO _turned_on
  FROM jsonb_each_text(coalesce(OLD.automations, '{}'::jsonb)) o
  WHERE lower(o.value) = 'false';

  _turned_on := _turned_on
    OR (lower(coalesce(OLD.preferences ->> 'decline_vehicle_for_work', 'true')) = 'false'
        AND lower(coalesce(NEW.preferences ->> 'decline_vehicle_for_work', 'true')) <> 'false')
    OR NEW.required_documents IS DISTINCT FROM OLD.required_documents;

  IF _turned_on THEN
    FOR _id IN SELECT id FROM public.deals WHERE status NOT IN ('declined', 'funded', 'incomplete') ORDER BY created_at LOOP
      PERFORM public.autoroute_deal(_id);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS app_settings_reevaluate ON public.app_settings;
CREATE TRIGGER app_settings_reevaluate AFTER UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.trg_app_settings_reevaluate();
