-- =====================================================================================
-- AutoFlow production hardening, part 3: deals change only through AutoFlow's actions.
--
-- Nobody signed in can INSERT, UPDATE or DELETE public.deals any more (privileges revoked,
-- policies dropped, and a trigger refuses it should the privileges ever come back). Every
-- change goes through a SECURITY DEFINER function that checks the caller's role:
--   admin_move_deal, decline_deal, record_credit_decision, set_credit_condition,
--   update_funding_checklist, approve_funding, mark_funded, submit_deal
-- Internal notes go to the staff-only history; dealers see deals.dealer_message only.
-- =====================================================================================

DROP POLICY IF EXISTS "Staff can update deals" ON public.deals;
DROP POLICY IF EXISTS "Staff can insert deals" ON public.deals;
DROP POLICY IF EXISTS "Admins can delete deals" ON public.deals;
DROP POLICY IF EXISTS "Authenticated users can insert deals" ON public.deals;
DROP POLICY IF EXISTS "Authenticated users can update deals" ON public.deals;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.deals FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_deals_api_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Deals can only be changed through AutoFlow actions' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS deals_api_guard ON public.deals;
CREATE TRIGGER deals_api_guard BEFORE INSERT OR UPDATE OR DELETE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_deals_api_guard();

-- pipeline order (declined / incomplete are outside it)
CREATE OR REPLACE FUNCTION public.deal_stage_rank(_s public.deal_status)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _s
    WHEN 'new_submission' THEN 1 WHEN 'document_review' THEN 2 WHEN 'credit_review' THEN 3
    WHEN 'income_verification' THEN 4 WHEN 'funding_review' THEN 5 WHEN 'approved' THEN 6
    WHEN 'funded' THEN 7 END
$$;

-- ---------------------------------------------------------------- admin_move_deal
-- Manual move (pipeline drag, "Move to…"), admins only, always logged with who did it.
-- Moving back clears what was decided after the target stage so the deal waits there:
--   to new submission / document review / credit review → the credit decision (and conditions)
--   to income verification → verified income sources go back to needs_review
--   to funding review or earlier → the funding approval
--   funded → approved (admin, with a note) → funded date and amount
-- Moving to funded needs an approved deal; declining goes through decline_deal.
CREATE OR REPLACE FUNCTION public.admin_move_deal(_deal_id uuid, _status public.deal_status, _note text DEFAULT NULL)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d public.deals%ROWTYPE;
  _note_t text;
  _to integer := public.deal_stage_rank(_status);
  _cleared text[] := '{}';
  _n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can move a deal by hand' USING ERRCODE = '42501';
  END IF;
  IF _status IS NULL THEN
    RAISE EXCEPTION 'status: is required' USING ERRCODE = '22023';
  END IF;
  IF _status = 'declined' THEN
    RAISE EXCEPTION 'status: use decline_deal to decline a deal' USING ERRCODE = '22023';
  END IF;
  _note_t := public.clean_text(_note, 'note', 2000, true);

  SELECT * INTO _d FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002'; END IF;
  IF _d.status = _status THEN RETURN _d.status; END IF;
  IF _status = 'funded' AND _d.status <> 'approved' THEN
    RAISE EXCEPTION 'status: only an approved deal can be moved to Funded' USING ERRCODE = '22023';
  END IF;
  IF _d.status = 'funded' AND (_status <> 'approved' OR _note_t IS NULL) THEN
    RAISE EXCEPTION 'note: a funded deal can only be moved back to Approved, with a note' USING ERRCODE = '22023';
  END IF;
  IF _d.status = 'declined' AND _d.credit_decision = 'declined' AND coalesce(_to, 0) > 3 THEN
    RAISE EXCEPTION 'status: credit declined this deal; move it to Credit Review for a new decision' USING ERRCODE = '22023';
  END IF;

  -- no automatic routing for this deal until the move is done
  PERFORM set_config('autoflow.hold_deal', _deal_id::text, true);

  IF _to IS NOT NULL AND _to <= 3 AND (_d.credit_decision <> 'pending' OR _d.credit_conditions <> '[]'::jsonb) THEN
    _cleared := _cleared || 'credit_decision'::text;
  END IF;
  IF _to = 4 THEN
    UPDATE public.income_sources SET verification_status = 'needs_review', verified_at = NULL, verified_by = NULL
    WHERE deal_id = _deal_id AND verification_status = 'verified';
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n > 0 OR _d.income_verified_at IS NOT NULL THEN _cleared := _cleared || 'income_verification'::text; END IF;
  END IF;
  IF _to IS NOT NULL AND _to <= 5 AND _d.funding_approved_at IS NOT NULL THEN
    _cleared := _cleared || 'funding_approval'::text;
  END IF;
  IF _to IS NOT NULL AND _to <= 6 AND _d.funded_at IS NOT NULL THEN
    _cleared := _cleared || 'funded'::text;
  END IF;

  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'status_change',
          'Moved from ' || public.deal_status_label(_d.status) || ' to ' || public.deal_status_label(_status)
            || coalesce(' — ' || _note_t, ''),
          auth.uid(),
          jsonb_build_object('from', _d.status, 'to', _status, 'manual', true, 'note', _note_t, 'cleared', to_jsonb(_cleared)));

  PERFORM set_config('autoflow.action', 'on', true);
  UPDATE public.deals SET
    status = _status,
    credit_decision = CASE WHEN 'credit_decision' = ANY (_cleared) THEN 'pending' ELSE credit_decision END,
    credit_decision_by = CASE WHEN 'credit_decision' = ANY (_cleared) THEN NULL ELSE credit_decision_by END,
    credit_decision_at = CASE WHEN 'credit_decision' = ANY (_cleared) THEN NULL ELSE credit_decision_at END,
    credit_conditions = CASE WHEN 'credit_decision' = ANY (_cleared) THEN '[]'::jsonb ELSE credit_conditions END,
    income_verified_at = CASE WHEN _to = 4 THEN NULL ELSE income_verified_at END,
    funding_approved_at = CASE WHEN 'funding_approval' = ANY (_cleared) THEN NULL ELSE funding_approved_at END,
    funding_approved_by = CASE WHEN 'funding_approval' = ANY (_cleared) THEN NULL ELSE funding_approved_by END,
    funded_at = CASE WHEN 'funded' = ANY (_cleared) THEN NULL WHEN _status = 'funded' THEN now() ELSE funded_at END,
    funded_amount = CASE WHEN 'funded' = ANY (_cleared) THEN NULL
                         WHEN _status = 'funded' THEN coalesce(funded_amount, loan_amount) ELSE funded_amount END,
    funded_by = CASE WHEN 'funded' = ANY (_cleared) THEN NULL WHEN _status = 'funded' THEN auth.uid() ELSE funded_by END,
    dealer_message = CASE WHEN _d.status = 'declined' THEN NULL ELSE dealer_message END
  WHERE id = _deal_id;
  PERFORM set_config('autoflow.action', 'off', true);
  PERFORM set_config('autoflow.hold_deal', '', true);

  PERFORM public.notify_dealer(_d.dealer_id, 'Deal ' || _d.deal_number || ': ' || public.deal_status_label(_status),
    'Status updated by the lender.',
    CASE WHEN _status IN ('approved', 'funded') THEN 'success' ELSE 'info' END::public.notification_type, _deal_id);
  RETURN _status;
END $$;

-- ---------------------------------------------------------------- decline_deal
-- From any open status. _reason is internal (staff history); _dealer_message is what the dealer sees.
CREATE OR REPLACE FUNCTION public.decline_deal(_deal_id uuid, _reason text, _dealer_message text DEFAULT NULL)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r text; _m text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'credit_analyst') OR public.has_role(auth.uid(), 'funding_manager')
          OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only credit analysts, funding managers and admins can decline a deal' USING ERRCODE = '42501';
  END IF;
  _r := public.clean_text(_reason, 'reason', 2000, true);
  IF _r IS NULL THEN RAISE EXCEPTION 'reason: is required' USING ERRCODE = '22023'; END IF;
  _m := public.clean_text(_dealer_message, 'dealer_message', 1000, true);
  RETURN public.decline_deal_internal(_deal_id, _r, _m, 'manual_decline', auth.uid());
END $$;

-- ---------------------------------------------------------------- record_credit_decision
DROP FUNCTION IF EXISTS public.record_credit_decision(uuid, text, text, integer, public.credit_tier, public.credit_bureau);
CREATE FUNCTION public.record_credit_decision(_deal_id uuid, _decision text, _notes text DEFAULT NULL,
  _score integer DEFAULT NULL, _tier public.credit_tier DEFAULT NULL, _bureau public.credit_bureau DEFAULT NULL,
  _conditions jsonb DEFAULT NULL, _dealer_message text DEFAULT NULL)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d public.deals%ROWTYPE;
  _admin boolean;
  _notes_t text;
  _msg text;
  _conds jsonb := '[]'::jsonb;
  _e jsonb;
  _label text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'credit_analyst') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only credit analysts can record a credit decision' USING ERRCODE = '42501';
  END IF;
  _admin := public.has_role(auth.uid(), 'admin');
  IF _decision IS NULL OR _decision NOT IN ('approved', 'conditional', 'declined') THEN
    RAISE EXCEPTION 'decision: must be approved, conditional or declined' USING ERRCODE = '22023';
  END IF;
  IF _score IS NOT NULL AND (_score < 300 OR _score > 900) THEN
    RAISE EXCEPTION 'score: must be between 300 and 900' USING ERRCODE = '22023';
  END IF;
  _notes_t := public.clean_text(_notes, 'notes', 2000, true);
  _msg := public.clean_text(_dealer_message, 'dealer_message', 1000, true);

  IF _decision = 'conditional' THEN
    IF _conditions IS NULL OR jsonb_typeof(_conditions) <> 'array'
       OR jsonb_array_length(_conditions) < 1 OR jsonb_array_length(_conditions) > 10 THEN
      RAISE EXCEPTION 'conditions: a conditional approval needs 1 to 10 conditions' USING ERRCODE = '22023';
    END IF;
    FOR _e IN SELECT value FROM jsonb_array_elements(_conditions) LOOP
      _label := public.clean_text(CASE jsonb_typeof(_e) WHEN 'object' THEN _e ->> 'label' WHEN 'string' THEN _e #>> '{}' END,
                                  'conditions', 200);
      IF _label IS NULL THEN
        RAISE EXCEPTION 'conditions: every condition needs a label' USING ERRCODE = '22023';
      END IF;
      _conds := _conds || jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'label', _label,
                                                               'cleared_at', NULL, 'cleared_by', NULL));
    END LOOP;
  ELSIF _conditions IS NOT NULL AND jsonb_typeof(_conditions) = 'array' AND jsonb_array_length(_conditions) > 0 THEN
    RAISE EXCEPTION 'conditions: only a conditional approval has conditions' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _d FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT (_d.status = 'credit_review'
          OR (_admin AND _d.status IN ('income_verification', 'funding_review', 'approved'))) THEN
    RAISE EXCEPTION 'A credit decision can only be recorded while the deal is in Credit Review' USING ERRCODE = '22023';
  END IF;

  -- the decision first, then what it causes (history reads in order)
  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'decision', 'Credit ' || _decision || coalesce(' — ' || _notes_t, ''), auth.uid(),
          jsonb_build_object('decision', _decision, 'step', 'credit', 'notes', _notes_t, 'conditions', _conds,
                             'dealer_message', _msg, 'score', _score, 'tier', _tier, 'bureau', _bureau,
                             'override', _d.status <> 'credit_review'));

  IF _decision = 'declined' THEN
    PERFORM public.decline_deal_internal(_deal_id, 'Credit declined', _msg, 'credit_declined', auth.uid());
  END IF;

  UPDATE public.deals SET
    credit_score = coalesce(_score, credit_score),
    credit_tier = coalesce(_tier, credit_tier),
    credit_bureau = coalesce(_bureau, credit_bureau),
    credit_pulled_at = CASE WHEN _score IS NOT NULL THEN coalesce(credit_pulled_at, now()) ELSE credit_pulled_at END,
    credit_decision_by = auth.uid(),
    credit_decision_at = now(),
    credit_conditions = _conds,
    dealer_message = _msg,
    credit_decision = _decision
  WHERE id = _deal_id;
  RETURN (SELECT status FROM public.deals WHERE id = _deal_id);
END $$;

-- ---------------------------------------------------------------- set_credit_condition
CREATE OR REPLACE FUNCTION public.set_credit_condition(_deal_id uuid, _condition_id text, _cleared boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d public.deals%ROWTYPE;
  _idx integer;
  _e jsonb;
  _new jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'funding_manager') OR public.has_role(auth.uid(), 'credit_analyst')
          OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only credit analysts, funding managers and admins can clear conditions' USING ERRCODE = '42501';
  END IF;
  IF _cleared IS NULL THEN RAISE EXCEPTION 'cleared: is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _d FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002'; END IF;
  IF _d.status IN ('declined', 'funded') THEN
    RAISE EXCEPTION 'Deal is closed' USING ERRCODE = '22023';
  END IF;
  SELECT (t.ord - 1)::int, t.e INTO _idx, _e
  FROM jsonb_array_elements(_d.credit_conditions) WITH ORDINALITY AS t(e, ord)
  WHERE t.e ->> 'id' = _condition_id;
  IF _idx IS NULL THEN RAISE EXCEPTION 'Condition not found' USING ERRCODE = 'P0002'; END IF;
  IF (_e ->> 'cleared_at' IS NOT NULL) = _cleared THEN
    RETURN _d.credit_conditions;
  END IF;

  _new := jsonb_set(_d.credit_conditions, ARRAY[_idx::text],
    _e || jsonb_build_object('cleared_at', CASE WHEN _cleared THEN to_jsonb(now()) END,
                             'cleared_by', CASE WHEN _cleared THEN to_jsonb(auth.uid()) END));
  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'decision', CASE WHEN _cleared THEN 'Condition cleared: ' ELSE 'Condition reopened: ' END || (_e ->> 'label'),
          auth.uid(), jsonb_build_object('step', 'credit_condition', 'condition_id', _condition_id, 'cleared', _cleared));
  UPDATE public.deals SET credit_conditions = _new WHERE id = _deal_id;
  RETURN _new;
END $$;

-- ---------------------------------------------------------------- funding
CREATE OR REPLACE FUNCTION public.update_funding_checklist(_deal_id uuid, _items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb; _status public.deal_status;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'funding_manager') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only funding managers can update the funding checklist' USING ERRCODE = '42501';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'object' THEN
    RAISE EXCEPTION 'items: must be an object of true/false values' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(_items) WHERE jsonb_typeof(value) <> 'boolean') THEN
    RAISE EXCEPTION 'items: must be an object of true/false values' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO _status FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002'; END IF;
  IF _status IN ('declined', 'funded') THEN RAISE EXCEPTION 'Deal is closed' USING ERRCODE = '22023'; END IF;
  UPDATE public.deals SET funding_checklist = funding_checklist || _items
  WHERE id = _deal_id RETURNING funding_checklist INTO _out;
  RETURN _out;
END $$;

-- Refuses while the funding checklist, a credit condition or the document checklist is open.
CREATE OR REPLACE FUNCTION public.approve_funding(_deal_id uuid, _notes text DEFAULT NULL)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _d public.deals%ROWTYPE;
  _missing text;
  _notes_t text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'funding_manager') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only funding managers can approve funding' USING ERRCODE = '42501';
  END IF;
  _notes_t := public.clean_text(_notes, 'notes', 2000, true);
  SELECT * INTO _d FROM public.deals WHERE id = _deal_id FOR UPDATE;
  IF NOT FOUND OR _d.status NOT IN ('funding_review', 'approved') THEN
    RAISE EXCEPTION 'Deal is not in funding review' USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(item ->> 'label', ', ') INTO _missing
  FROM public.app_settings s, jsonb_array_elements(s.funding_checklist_items) item
  WHERE s.id AND coalesce((_d.funding_checklist ->> (item ->> 'key'))::boolean, false) = false;
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'Funding checklist incomplete: %', _missing USING ERRCODE = '23514';
  END IF;

  SELECT string_agg(e ->> 'label', ', ') INTO _missing
  FROM jsonb_array_elements(_d.credit_conditions) e WHERE e ->> 'cleared_at' IS NULL;
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'Credit conditions not cleared: %', _missing USING ERRCODE = '23514';
  END IF;

  SELECT string_agg(c.label, ', ') INTO _missing FROM public.deal_checklist_items(_deal_id) c WHERE NOT c.satisfied;
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'Documents missing: %', _missing USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'decision', 'Approved for funding' || coalesce(' — ' || _notes_t, ''), auth.uid(),
          jsonb_build_object('step', 'funding_approval', 'notes', _notes_t));
  UPDATE public.deals SET funding_approved_at = now(), funding_approved_by = auth.uid(),
         decision_by = auth.uid(), decision_at = now()
  WHERE id = _deal_id;
  RETURN (SELECT status FROM public.deals WHERE id = _deal_id);
END $$;

CREATE OR REPLACE FUNCTION public.mark_funded(_deal_id uuid, _amount numeric DEFAULT NULL)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'funding_manager') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only funding managers can mark a deal funded' USING ERRCODE = '42501';
  END IF;
  IF _amount IS NOT NULL AND (_amount <= 0 OR _amount > 10000000 OR _amount = 'NaN'::numeric) THEN
    RAISE EXCEPTION 'amount: must be greater than 0 and at most 10,000,000' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.deals WHERE id = _deal_id AND status = 'approved' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal must be approved before it is funded' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'decision', 'Loan funded', auth.uid(), jsonb_build_object('step', 'funded', 'amount', _amount));
  UPDATE public.deals SET funded_at = now(), funded_by = auth.uid(), funded_amount = coalesce(_amount, loan_amount)
  WHERE id = _deal_id;
  RETURN (SELECT status FROM public.deals WHERE id = _deal_id);
END $$;

-- ---------------------------------------------------------------- submission
-- Creates customer, vehicle, deal and the primary income source in one transaction, after
-- checking every field. Errors: ERRCODE 22023, message "<field>: <problem>" where <field> is
-- the payload key (trade-in fields: trade_in_<key>).
CREATE OR REPLACE FUNCTION public.submit_deal(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _dealer uuid;
  _is_dealer boolean;
  _customer uuid;
  _vehicle uuid;
  _deal uuid;
  _c jsonb; _v jsonb; _f jsonb; _e jsonb; _t jsonb;
  _loan numeric; _down numeric; _apr numeric; _term_n numeric; _term integer; _rate numeric; _payment numeric; _price numeric;
  _income numeric; _years numeric; _year_n numeric; _mileage_n numeric; _msrp numeric;
  _ti_year numeric; _ti_mileage numeric; _ti_value numeric; _ti_payoff numeric; _ti_vin text;
  _vin text; _email text; _dob_t text; _dob date; _dealer_t text;
  _first text; _last text; _notes text;
  _condition text; _priority text; _income_type text;
  _max_year integer := extract(year FROM now())::integer + 2;
  _dealer_name text;
BEGIN
  IF _payload IS NULL OR jsonb_typeof(_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload: must be an object' USING ERRCODE = '22023';
  END IF;
  _c := CASE WHEN jsonb_typeof(_payload -> 'customer') = 'object' THEN _payload -> 'customer' ELSE '{}'::jsonb END;
  _v := CASE WHEN jsonb_typeof(_payload -> 'vehicle') = 'object' THEN _payload -> 'vehicle' ELSE '{}'::jsonb END;
  _f := CASE WHEN jsonb_typeof(_payload -> 'financing') = 'object' THEN _payload -> 'financing' ELSE '{}'::jsonb END;
  _e := CASE WHEN jsonb_typeof(_payload -> 'employment') = 'object' THEN _payload -> 'employment' ELSE '{}'::jsonb END;
  _t := CASE WHEN jsonb_typeof(_payload -> 'trade_in') = 'object' THEN _payload -> 'trade_in' END;

  -- who is submitting, for which dealership
  IF public.is_staff(auth.uid()) THEN
    _is_dealer := false;
    _dealer_t := btrim(coalesce(_payload ->> 'dealer_id', ''));
    IF _dealer_t = '' THEN RAISE EXCEPTION 'dealer_id: is required' USING ERRCODE = '22023'; END IF;
    IF _dealer_t !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'dealer_id: must be a valid id' USING ERRCODE = '22023';
    END IF;
    _dealer := _dealer_t::uuid;
  ELSE
    _is_dealer := true;
    _dealer := public.current_dealer_id();
    IF _dealer IS NULL THEN
      RAISE EXCEPTION 'No dealership linked to this account' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT name INTO _dealer_name FROM public.dealers WHERE id = _dealer AND status <> 'suspended';
  IF _dealer_name IS NULL THEN RAISE EXCEPTION 'Dealer is not active' USING ERRCODE = '42501'; END IF;

  -- customer
  _first := public.clean_text(_c ->> 'first_name', 'first_name');
  _last := public.clean_text(_c ->> 'last_name', 'last_name');
  IF _first IS NULL THEN RAISE EXCEPTION 'first_name: is required' USING ERRCODE = '22023'; END IF;
  IF _last IS NULL THEN RAISE EXCEPTION 'last_name: is required' USING ERRCODE = '22023'; END IF;
  _email := public.clean_text(_c ->> 'email', 'email');
  IF _email IS NOT NULL AND _email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'email: must be a valid email address' USING ERRCODE = '22023';
  END IF;
  _dob_t := public.clean_text(_c ->> 'date_of_birth', 'date_of_birth');
  IF _dob_t IS NOT NULL THEN
    IF _dob_t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'date_of_birth: must be a date (YYYY-MM-DD)' USING ERRCODE = '22023';
    END IF;
    BEGIN
      _dob := _dob_t::date;
    EXCEPTION WHEN others THEN
      _dob := NULL;
    END;
    IF _dob IS NULL OR _dob < DATE '1900-01-01' OR _dob > current_date THEN
      RAISE EXCEPTION 'date_of_birth: must be a valid past date' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- employment
  _income := public.parse_number(_e -> 'monthly_income', 'monthly_income');
  IF _income IS NOT NULL AND (_income < 0 OR _income > 1000000) THEN
    RAISE EXCEPTION 'monthly_income: must be between 0 and 1,000,000' USING ERRCODE = '22023';
  END IF;
  _years := public.parse_number(_e -> 'years_employed', 'years_employed');
  IF _years IS NOT NULL AND (_years < 0 OR _years > 80) THEN
    RAISE EXCEPTION 'years_employed: must be between 0 and 80' USING ERRCODE = '22023';
  END IF;
  _income_type := coalesce(public.clean_text(_e ->> 'income_type', 'income_type'), 'salaried');
  IF NOT _income_type = ANY (enum_range(NULL::public.income_source_type)::text[]) THEN
    RAISE EXCEPTION 'income_type: unknown income type' USING ERRCODE = '22023';
  END IF;

  -- vehicle
  _price := public.parse_number(_v -> 'invoice_price', 'invoice_price');
  IF _price IS NULL OR _price <= 0 THEN
    RAISE EXCEPTION 'invoice_price: must be greater than 0' USING ERRCODE = '22023';
  END IF;
  IF _price > 10000000 THEN
    RAISE EXCEPTION 'invoice_price: must be at most 10,000,000' USING ERRCODE = '22023';
  END IF;
  _msrp := public.parse_number(_v -> 'msrp', 'msrp');
  IF _msrp IS NOT NULL AND (_msrp < 0 OR _msrp > 10000000) THEN
    RAISE EXCEPTION 'msrp: must be between 0 and 10,000,000' USING ERRCODE = '22023';
  END IF;
  _year_n := coalesce(public.parse_number(_v -> 'year', 'year'), extract(year FROM now()));
  IF _year_n <> trunc(_year_n) OR _year_n < 1980 OR _year_n > _max_year THEN
    RAISE EXCEPTION 'year: must be a year between 1980 and %', _max_year USING ERRCODE = '22023';
  END IF;
  _mileage_n := coalesce(public.parse_number(_v -> 'mileage', 'mileage'), 0);
  IF _mileage_n <> trunc(_mileage_n) OR _mileage_n < 0 OR _mileage_n > 2000000 THEN
    RAISE EXCEPTION 'mileage: must be a whole number between 0 and 2,000,000' USING ERRCODE = '22023';
  END IF;
  _vin := upper(regexp_replace(coalesce(_v ->> 'vin', ''), '[[:space:]]', '', 'g'));
  IF _vin <> '' AND _vin !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN
    RAISE EXCEPTION 'vin: must be 17 letters and digits (no I, O or Q)' USING ERRCODE = '22023';
  END IF;
  _condition := coalesce(public.clean_text(_v ->> 'condition', 'condition'), 'used');
  IF NOT _condition = ANY (enum_range(NULL::public.vehicle_condition)::text[]) THEN
    RAISE EXCEPTION 'condition: must be new, used or certified' USING ERRCODE = '22023';
  END IF;

  -- financing
  _down := coalesce(public.parse_number(_f -> 'down_payment', 'down_payment'), 0);
  IF _down < 0 OR _down > 10000000 THEN
    RAISE EXCEPTION 'down_payment: must be between 0 and 10,000,000' USING ERRCODE = '22023';
  END IF;
  _loan := coalesce(public.parse_number(_f -> 'loan_amount', 'loan_amount'), greatest(_price - _down, 0));
  IF _loan <= 0 THEN
    RAISE EXCEPTION 'loan_amount: must be greater than 0' USING ERRCODE = '22023';
  END IF;
  IF _loan > 10000000 THEN
    RAISE EXCEPTION 'loan_amount: must be at most 10,000,000' USING ERRCODE = '22023';
  END IF;
  _apr := coalesce(public.parse_number(_f -> 'apr', 'apr'), 0);
  IF _apr < 0 OR _apr > 40 THEN
    RAISE EXCEPTION 'apr: must be between 0 and 40' USING ERRCODE = '22023';
  END IF;
  _term_n := coalesce(public.parse_number(_f -> 'term_months', 'term_months'), 60);
  IF _term_n <> trunc(_term_n) OR _term_n < 6 OR _term_n > 120 THEN
    RAISE EXCEPTION 'term_months: must be a whole number between 6 and 120' USING ERRCODE = '22023';
  END IF;
  _term := _term_n::integer;
  IF _loan / _price > 3 THEN
    RAISE EXCEPTION 'ltv: the loan is more than 300%% of the vehicle price' USING ERRCODE = '22023';
  END IF;
  _priority := coalesce(public.clean_text(_payload ->> 'priority', 'priority'), 'normal');
  IF NOT _priority = ANY (enum_range(NULL::public.deal_priority)::text[]) THEN
    RAISE EXCEPTION 'priority: must be low, normal, high or urgent' USING ERRCODE = '22023';
  END IF;
  _notes := public.clean_text(_payload ->> 'notes', 'notes', 2000, true);

  -- trade-in
  IF _t IS NOT NULL THEN
    _ti_year := public.parse_number(_t -> 'year', 'trade_in_year');
    IF _ti_year IS NOT NULL AND (_ti_year <> trunc(_ti_year) OR _ti_year < 1950 OR _ti_year > _max_year) THEN
      RAISE EXCEPTION 'trade_in_year: must be a year between 1950 and %', _max_year USING ERRCODE = '22023';
    END IF;
    _ti_mileage := public.parse_number(_t -> 'mileage', 'trade_in_mileage');
    IF _ti_mileage IS NOT NULL AND (_ti_mileage <> trunc(_ti_mileage) OR _ti_mileage < 0 OR _ti_mileage > 2000000) THEN
      RAISE EXCEPTION 'trade_in_mileage: must be a whole number between 0 and 2,000,000' USING ERRCODE = '22023';
    END IF;
    _ti_value := public.parse_number(_t -> 'value', 'trade_in_value');
    IF _ti_value IS NOT NULL AND (_ti_value < 0 OR _ti_value > 10000000) THEN
      RAISE EXCEPTION 'trade_in_value: must be between 0 and 10,000,000' USING ERRCODE = '22023';
    END IF;
    _ti_payoff := public.parse_number(_t -> 'payoff', 'trade_in_payoff');
    IF _ti_payoff IS NOT NULL AND (_ti_payoff < 0 OR _ti_payoff > 10000000) THEN
      RAISE EXCEPTION 'trade_in_payoff: must be between 0 and 10,000,000' USING ERRCODE = '22023';
    END IF;
    _ti_vin := upper(regexp_replace(coalesce(_t ->> 'vin', ''), '[[:space:]]', '', 'g'));
    IF _ti_vin <> '' AND _ti_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN
      RAISE EXCEPTION 'trade_in_vin: must be 17 letters and digits (no I, O or Q)' USING ERRCODE = '22023';
    END IF;
  END IF;

  _rate := _apr / 100 / 12;
  _payment := CASE WHEN _rate = 0 THEN _loan / _term ELSE _loan * _rate / (1 - power(1 + _rate, -_term)) END;
  _payment := round(_payment, 2);

  INSERT INTO public.customers (first_name, last_name, email, phone, street, city, state, zip, employer, job_title,
                                monthly_income, years_employed, date_of_birth)
  VALUES (_first, _last, coalesce(_email, ''), coalesce(public.clean_text(_c ->> 'phone', 'phone'), ''),
          public.clean_text(_c ->> 'street', 'street'), public.clean_text(_c ->> 'city', 'city'),
          public.clean_text(_c ->> 'state', 'state'), public.clean_text(_c ->> 'zip', 'zip'),
          public.clean_text(_e ->> 'employer', 'employer'), public.clean_text(_e ->> 'job_title', 'job_title'),
          _income, _years, _dob)
  RETURNING id INTO _customer;

  INSERT INTO public.vehicles (year, make, model, trim, vin, mileage, color, condition, msrp, invoice_price)
  VALUES (_year_n::integer, coalesce(public.clean_text(_v ->> 'make', 'make'), ''),
          coalesce(public.clean_text(_v ->> 'model', 'model'), ''), public.clean_text(_v ->> 'trim', 'trim'),
          _vin, _mileage_n::integer, public.clean_text(_v ->> 'color', 'color'),
          _condition::public.vehicle_condition, _msrp, _price)
  RETURNING id INTO _vehicle;

  INSERT INTO public.deals (customer_id, vehicle_id, dealer_id, priority, loan_amount, down_payment, apr, term_months,
                            monthly_payment, total_interest, total_cost, ltv, created_by, submitted_by_dealer,
                            trade_in_year, trade_in_make, trade_in_model, trade_in_vin, trade_in_mileage, trade_in_payoff, trade_in_value,
                            trade_in_credit)
  VALUES (_customer, _vehicle, _dealer, _priority::public.deal_priority,
          _loan, _down, _apr, _term, _payment, round(_payment * _term - _loan, 2), round(_payment * _term + _down, 2),
          round(_loan / _price * 100, 1), auth.uid(), _is_dealer,
          _ti_year::integer, public.clean_text(_t ->> 'make', 'trade_in_make'), public.clean_text(_t ->> 'model', 'trade_in_model'),
          nullif(_ti_vin, ''), _ti_mileage::integer, _ti_payoff, _ti_value,
          CASE WHEN _t IS NOT NULL AND _ti_value IS NOT NULL THEN _ti_value - coalesce(_ti_payoff, 0) END)
  RETURNING id INTO _deal;

  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal, 'status_change',
          CASE WHEN _is_dealer THEN 'Submitted by ' || _dealer_name ELSE 'Deal created for ' || _dealer_name END,
          auth.uid(), jsonb_build_object('submitted_by_dealer', _is_dealer));

  IF _notes IS NOT NULL AND auth.uid() IS NOT NULL THEN
    INSERT INTO public.deal_notes (deal_id, content, created_by, is_internal)
    VALUES (_deal, _notes, auth.uid(), NOT _is_dealer);
  END IF;

  -- every deal has a primary income source (the verifier refines it)
  INSERT INTO public.income_sources (deal_id, customer_id, source_type, employer_name, job_title,
                                     stated_monthly_income, is_primary, verification_status, calc_method)
  VALUES (_deal, _customer, _income_type::public.income_source_type,
          coalesce(public.clean_text(_e ->> 'employer', 'employer'), 'Not provided'),
          public.clean_text(_e ->> 'job_title', 'job_title'), coalesce(_income, 0), true, 'unverified', 'mi');

  IF public.pref_enabled('notify_new') THEN
    PERFORM public.notify_role('admin', 'New deal from ' || _dealer_name, _first || ' ' || _last, 'info', _deal);
  END IF;
  RETURN _deal;
END $$;

-- ---------------------------------------------------------------- back-fill: primary income source
-- Old deals without a primary income source get one from the customer's employment details
-- (routing is paused for this one-time fill so no old deal moves or notifies anyone).
ALTER TABLE public.income_sources DISABLE TRIGGER income_sources_route;

UPDATE public.income_sources s SET is_primary = true
WHERE s.id IN (
  SELECT DISTINCT ON (x.deal_id) x.id FROM public.income_sources x
  WHERE NOT EXISTS (SELECT 1 FROM public.income_sources p WHERE p.deal_id = x.deal_id AND p.is_primary)
  ORDER BY x.deal_id, x.created_at, x.id);

INSERT INTO public.income_sources (deal_id, customer_id, source_type, employer_name, job_title,
                                   stated_monthly_income, is_primary, verification_status, calc_method)
SELECT d.id, d.customer_id, 'salaried', coalesce(nullif(btrim(c.employer), ''), 'Not provided'), nullif(btrim(c.job_title), ''),
       coalesce(c.monthly_income, 0), true, 'unverified', 'mi'
FROM public.deals d JOIN public.customers c ON c.id = d.customer_id
WHERE NOT EXISTS (SELECT 1 FROM public.income_sources s WHERE s.deal_id = d.id);

ALTER TABLE public.income_sources ENABLE TRIGGER income_sources_route;
