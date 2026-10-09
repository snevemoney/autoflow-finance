-- The deal history should read in the order things happened: "Credit approved", then
-- "Auto-routed to Income Verification". The routing trigger fires inside the UPDATE, so each
-- action now writes its own history line first, then updates the deal (which routes it).
-- Checks run before anything is written, so a refused action leaves no history line.

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
  IF NOT EXISTS (SELECT 1 FROM public.deals WHERE id = _deal_id) THEN
    RAISE EXCEPTION 'Deal not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'decision', 'Credit ' || _decision || coalesce(' — ' || _notes, ''), auth.uid(),
          jsonb_build_object('decision', _decision, 'step', 'credit'));
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
  RETURN (SELECT status FROM public.deals WHERE id = _deal_id);
END $$;

CREATE OR REPLACE FUNCTION public.approve_funding(_deal_id uuid, _notes text DEFAULT NULL)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _missing text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'funding_manager') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only funding managers can approve funding' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.deals WHERE id = _deal_id AND status IN ('funding_review', 'approved')) THEN
    RAISE EXCEPTION 'Deal is not in funding review' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(item ->> 'label', ', ') INTO _missing
  FROM public.app_settings s, jsonb_array_elements(s.funding_checklist_items) item, public.deals d
  WHERE s.id AND d.id = _deal_id AND coalesce((d.funding_checklist ->> (item ->> 'key'))::boolean, false) = false;
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'Funding checklist incomplete: %', _missing USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'decision', 'Approved for funding' || coalesce(' — ' || _notes, ''), auth.uid(),
          jsonb_build_object('step', 'funding_approval'));
  UPDATE public.deals SET funding_approved_at = now(), funding_approved_by = auth.uid(),
         decision_by = auth.uid(), decision_at = now(), decision_notes = coalesce(_notes, decision_notes)
  WHERE id = _deal_id;
  RETURN (SELECT status FROM public.deals WHERE id = _deal_id);
END $$;

CREATE OR REPLACE FUNCTION public.mark_funded(_deal_id uuid, _amount numeric DEFAULT NULL)
RETURNS public.deal_status LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'funding_manager') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Only funding managers can mark a deal funded' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.deals WHERE id = _deal_id AND status = 'approved') THEN
    RAISE EXCEPTION 'Deal must be approved before it is funded' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.deal_timeline (deal_id, type, description, created_by, metadata)
  VALUES (_deal_id, 'decision', 'Loan funded', auth.uid(), jsonb_build_object('step', 'funded'));
  UPDATE public.deals SET funded_at = now(), funded_by = auth.uid(), funded_amount = coalesce(_amount, loan_amount)
  WHERE id = _deal_id;
  RETURN (SELECT status FROM public.deals WHERE id = _deal_id);
END $$;
