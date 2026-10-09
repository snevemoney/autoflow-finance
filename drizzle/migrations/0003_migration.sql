-- timeline event types used by automation
alter type public.timeline_event_type add value if not exists 'automation';
alter type public.timeline_event_type add value if not exists 'document_request';

-- extra columns
alter table public.document_requests
  add column if not exists source text not null default 'staff',
  add column if not exists label text;
alter table public.app_settings add column if not exists preferences jsonb not null default '{}';
alter table public.deals add column if not exists funding_checklist jsonb not null default '{}';

-- dealer stats view
create or replace view public.dealer_stats as
select d.id as dealer_id,
  count(dl.id) as total_deals,
  count(dl.id) filter (where dl.status = 'funded') as funded_deals,
  count(dl.id) filter (where dl.status not in ('funded','declined')) as active_deals
from public.dealers d left join public.deals dl on dl.dealer_id = d.id
group by d.id;

-- document checklist for a deal
create or replace function public.deal_checklist(_deal_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  items jsonb := '[]'::jsonb;
  req record;
  doc_count int;
  open_req uuid;
  defs jsonb := '[
    {"item_key":"credit_application","label":"Credit Application","doc_types":["credit_application"]},
    {"item_key":"income_verification","label":"Income Verification","doc_types":["pay_stub","bank_statement","income_verification"]},
    {"item_key":"id_verification","label":"ID Verification","doc_types":["id_verification"]},
    {"item_key":"insurance","label":"Insurance Proof","doc_types":["insurance"]},
    {"item_key":"vehicle_invoice","label":"Vehicle Invoice","doc_types":["vehicle_invoice"]}
  ]'::jsonb;
begin
  for req in select * from jsonb_array_elements(defs) loop
    select count(*) into doc_count from documents
      where deal_id = _deal_id and type in (select jsonb_array_elements_text(req.value->'doc_types'));
    select id into open_req from document_requests
      where deal_id = _deal_id and status = 'open'
        and doc_type in (select jsonb_array_elements_text(req.value->'doc_types'))
      limit 1;
    items := items || jsonb_build_object(
      'item_key', req.value->>'item_key',
      'label', req.value->>'label',
      'doc_types', req.value->'doc_types',
      'satisfied', doc_count > 0,
      'document_count', doc_count,
      'open_request_id', open_req
    );
  end loop;
  return items;
end $$;

-- request a document from the dealer
create or replace function public.request_document(_deal_id uuid, _doc_type text, _message text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid;
begin
  insert into document_requests (deal_id, doc_type, message, label, source, created_by)
  values (_deal_id, _doc_type, coalesce(_message, 'Missing from submission'), initcap(replace(_doc_type, '_', ' ')), 'staff', auth.uid())
  returning id into _id;
  insert into deal_timeline (deal_id, type, description, created_by, metadata)
  values (_deal_id, 'document_request', 'Requested ' || replace(_doc_type, '_', ' ') || ' from dealer', auth.uid(),
    jsonb_build_object('doc_type', _doc_type, 'source', 'staff'));
  return _id;
end $$;

-- request every missing checklist item
create or replace function public.request_missing_documents(_deal_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare item jsonb; n int := 0;
begin
  for item in select * from jsonb_array_elements(deal_checklist(_deal_id)) loop
    if not (item->>'satisfied')::boolean and item->>'open_request_id' is null then
      insert into document_requests (deal_id, doc_type, message, label, source, created_by)
      values (_deal_id, (item->'doc_types'->>0), 'Missing from submission', item->>'label', 'staff', auth.uid());
      n := n + 1;
    end if;
  end loop;
  if n > 0 then
    insert into deal_timeline (deal_id, type, description, created_by, metadata)
    values (_deal_id, 'document_request', n || ' document(s) requested from dealer', auth.uid(), jsonb_build_object('count', n, 'source', 'staff'));
  end if;
  return n;
end $$;

-- credit decision
create or replace function public.record_credit_decision(_deal_id uuid, _decision text, _notes text default null, _score int default null, _tier credit_tier default null, _bureau credit_bureau default null)
returns deal_status language plpgsql security definer set search_path = public as $$
declare _next deal_status;
begin
  _next := case _decision
    when 'approved' then 'income_verification'::deal_status
    when 'conditional' then 'income_verification'::deal_status
    else 'declined'::deal_status end;
  update deals set
    status = _next,
    credit_score = coalesce(_score, credit_score),
    credit_tier = coalesce(_tier, credit_tier),
    credit_bureau = coalesce(_bureau, credit_bureau),
    credit_pulled_at = case when _score is not null then now() else credit_pulled_at end,
    decision_notes = coalesce(_notes, decision_notes),
    decision_by = auth.uid(),
    decision_at = now()
  where id = _deal_id;
  insert into deal_timeline (deal_id, type, description, created_by, metadata)
  values (_deal_id, 'status_change', 'Credit ' || _decision, auth.uid(),
    jsonb_build_object('decision', _decision, 'score', _score, 'tier', _tier, 'bureau', _bureau));
  return _next;
end $$;

-- funding checklist
create or replace function public.update_funding_checklist(_deal_id uuid, _items jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update deals set funding_checklist = coalesce(funding_checklist, '{}'::jsonb) || _items where id = _deal_id;
end $$;

-- approve funding
create or replace function public.approve_funding(_deal_id uuid, _notes text default null)
returns deal_status language plpgsql security definer set search_path = public as $$
begin
  update deals set status = 'approved', decision_notes = coalesce(_notes, decision_notes), decision_by = auth.uid(), decision_at = now()
  where id = _deal_id;
  insert into deal_timeline (deal_id, type, description, created_by, metadata)
  values (_deal_id, 'status_change', 'Funding approved', auth.uid(), jsonb_build_object('notes', _notes));
  return 'approved'::deal_status;
end $$;

-- mark funded
create or replace function public.mark_funded(_deal_id uuid, _amount numeric default null)
returns deal_status language plpgsql security definer set search_path = public as $$
begin
  update deals set status = 'funded', funded_at = now(), funded_amount = coalesce(_amount, loan_amount)
  where id = _deal_id;
  insert into deal_timeline (deal_id, type, description, created_by, metadata)
  values (_deal_id, 'status_change', 'Deal funded', auth.uid(), jsonb_build_object('amount', coalesce(_amount, (select loan_amount from deals where id = _deal_id))));
  return 'funded'::deal_status;
end $$;

-- submit a full deal (staff or dealer portal)
create or replace function public.submit_deal(_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  _customer uuid; _vehicle uuid; _deal uuid; _dealer uuid;
  c jsonb := _payload->'customer'; e jsonb := _payload->'employment';
  v jsonb := _payload->'vehicle'; f jsonb := _payload->'financing'; t jsonb := _payload->'trade_in';
  _loan numeric; _down numeric; _apr numeric; _term int;
begin
  _dealer := nullif(_payload->>'dealer_id', '')::uuid;
  if _dealer is null then
    select dealer_id into _dealer from dealer_users where user_id = auth.uid() limit 1;
  end if;
  if _dealer is null then
    select id into _dealer from dealers order by created_at limit 1;
  end if;

  insert into customers (first_name, last_name, email, phone, date_of_birth, street, city, state, zip, employer, job_title, monthly_income, years_employed)
  values (c->>'first_name', c->>'last_name', nullif(c->>'email',''), nullif(c->>'phone',''),
    nullif(c->>'date_of_birth','')::date, c->>'street', c->>'city', c->>'state', c->>'zip',
    nullif(e->>'employer',''), nullif(e->>'job_title',''),
    nullif(e->>'monthly_income','')::numeric, nullif(e->>'years_employed','')::numeric)
  returning id into _customer;

  insert into vehicles (year, make, model, trim, vin, mileage, condition, color, invoice_price, msrp)
  values (nullif(v->>'year','')::int, v->>'make', v->>'model', nullif(v->>'trim',''), nullif(v->>'vin',''),
    nullif(v->>'mileage','')::int, nullif(v->>'condition',''), nullif(v->>'color',''),
    nullif(v->>'invoice_price','')::numeric, nullif(v->>'msrp','')::numeric)
  returning id into _vehicle;

  _loan := nullif(f->>'loan_amount','')::numeric;
  _down := coalesce(nullif(f->>'down_payment','')::numeric, 0);
  _apr := coalesce(nullif(f->>'apr','')::numeric, 0);
  _term := nullif(f->>'term_months','')::int;

  insert into deals (dealer_id, customer_id, vehicle_id, status, loan_amount, down_payment, apr, term_months,
    trade_in_year, trade_in_make, trade_in_model, trade_in_vin, trade_in_mileage, trade_in_value, trade_in_payoff,
    trade_in_credit, created_by)
  values (_dealer, _customer, _vehicle, 'new_submission', _loan, _down, _apr, _term,
    nullif(t->>'year','')::int, t->>'make', t->>'model', nullif(t->>'vin',''),
    nullif(t->>'mileage','')::int, nullif(t->>'value','')::numeric, nullif(t->>'payoff','')::numeric,
    greatest(coalesce(nullif(t->>'value','')::numeric,0) - coalesce(nullif(t->>'payoff','')::numeric,0), 0),
    auth.uid())
  returning id into _deal;

  insert into deal_timeline (deal_id, type, description, created_by, metadata)
  values (_deal, 'status_change', 'Deal submitted', auth.uid(), jsonb_build_object('source', 'submission_form'));
  return _deal;
end $$;

grant execute on function public.deal_checklist(uuid) to authenticated;
grant execute on function public.request_document(uuid, text, text) to authenticated;
grant execute on function public.request_missing_documents(uuid) to authenticated;
grant execute on function public.record_credit_decision(uuid, text, text, int, credit_tier, credit_bureau) to authenticated;
grant execute on function public.update_funding_checklist(uuid, jsonb) to authenticated;
grant execute on function public.approve_funding(uuid, text) to authenticated;
grant execute on function public.mark_funded(uuid, numeric) to authenticated;
grant execute on function public.submit_deal(jsonb) to authenticated;