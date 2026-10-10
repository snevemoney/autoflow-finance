-- =====================================================================================
-- AutoFlow production hardening, part 6: deal search and the front-end aggregates.
--
-- deals.search_text = lower-case, accent-free "deal number, customer first + last name,
-- vehicle year make model", kept current by triggers, indexed for ilike when pg_trgm exists.
-- queue_counts(), dashboard_metrics() and report_metrics() run as the caller (SECURITY
-- INVOKER), so row-level security limits a dealer to their own deals.
-- Month boundaries use Montréal time (America/Toronto).
-- =====================================================================================

-- ---------------------------------------------------------------- accent folding
DO $do$
DECLARE _s text;
BEGIN
  SELECT n.nspname INTO _s FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'unaccent';
  IF _s IS NOT NULL THEN
    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION public.search_fold(_t text)
      RETURNS text LANGUAGE sql STABLE SET search_path = public AS $b$
        SELECT lower(%1$I.unaccent(%2$L::regdictionary, coalesce(_t, '')))
      $b$$f$, _s, _s || '.unaccent');
  ELSE
    CREATE OR REPLACE FUNCTION public.search_fold(_t text)
    RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $b$
      SELECT translate(lower(coalesce(_t, '')),
        'àáâãäåāăąçćčďèéêëēėęěìíîïīįıñńňòóôõöøōőœřśšşťùúûüūůűÿýžźż',
        'aaaaaaaaacccdeeeeeeeeiiiiiiinnnooooooooorssstuuuuuuuyyzzz')
    $b$;
  END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.deal_search_text(_deal_number text, _customer_id uuid, _vehicle_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.search_fold(concat_ws(' ',
    _deal_number,
    (SELECT concat_ws(' ', c.first_name, c.last_name) FROM public.customers c WHERE c.id = _customer_id),
    (SELECT concat_ws(' ', v.year, v.make, v.model) FROM public.vehicles v WHERE v.id = _vehicle_id)))
$$;

-- named to sort after set_deal_number, so the new deal number is included
CREATE OR REPLACE FUNCTION public.trg_deals_search_text()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.search_text := public.deal_search_text(NEW.deal_number, NEW.customer_id, NEW.vehicle_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_search_text ON public.deals;
CREATE TRIGGER trg_search_text BEFORE INSERT OR UPDATE OF deal_number, customer_id, vehicle_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_deals_search_text();

CREATE OR REPLACE FUNCTION public.trg_refresh_deal_search_text()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'customers' THEN
    UPDATE public.deals d SET search_text = public.deal_search_text(d.deal_number, d.customer_id, d.vehicle_id)
    WHERE d.customer_id = NEW.id;
  ELSE
    UPDATE public.deals d SET search_text = public.deal_search_text(d.deal_number, d.customer_id, d.vehicle_id)
    WHERE d.vehicle_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS customers_search_text ON public.customers;
CREATE TRIGGER customers_search_text AFTER UPDATE OF first_name, last_name ON public.customers
  FOR EACH ROW WHEN (OLD.first_name IS DISTINCT FROM NEW.first_name OR OLD.last_name IS DISTINCT FROM NEW.last_name)
  EXECUTE FUNCTION public.trg_refresh_deal_search_text();
DROP TRIGGER IF EXISTS vehicles_search_text ON public.vehicles;
CREATE TRIGGER vehicles_search_text AFTER UPDATE OF year, make, model ON public.vehicles
  FOR EACH ROW WHEN (OLD.year IS DISTINCT FROM NEW.year OR OLD.make IS DISTINCT FROM NEW.make OR OLD.model IS DISTINCT FROM NEW.model)
  EXECUTE FUNCTION public.trg_refresh_deal_search_text();

-- fill existing deals without touching their updated_at
ALTER TABLE public.deals DISABLE TRIGGER update_deals_updated_at;
UPDATE public.deals SET search_text = public.deal_search_text(deal_number, customer_id, vehicle_id);
ALTER TABLE public.deals ENABLE TRIGGER update_deals_updated_at;

DO $$
DECLARE _s text;
BEGIN
  SELECT n.nspname INTO _s FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm';
  IF _s IS NOT NULL THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_deals_search_text ON public.deals USING gin (search_text %I.gin_trgm_ops)', _s);
  END IF;
END $$;

-- ---------------------------------------------------------------- row-level rules, evaluated once per query
-- Same rules as before, with the caller's standing computed once per statement (InitPlan)
-- instead of once per row, so the aggregates below stay fast.
DROP POLICY IF EXISTS "Staff and owning dealer can view deals" ON public.deals;
CREATE POLICY "Staff and owning dealer can view deals" ON public.deals FOR SELECT TO authenticated
  USING ((SELECT public.is_staff(auth.uid())) OR dealer_id = (SELECT public.current_dealer_id()));

DROP POLICY IF EXISTS "Staff and owning dealer can view documents" ON public.documents;
CREATE POLICY "Staff and owning dealer can view documents" ON public.documents FOR SELECT TO authenticated
  USING ((SELECT public.is_staff(auth.uid()))
         OR EXISTS (SELECT 1 FROM public.deals d WHERE d.id = documents.deal_id AND d.dealer_id = (SELECT public.current_dealer_id())));

DROP POLICY IF EXISTS "Staff and owning dealer can view requests" ON public.document_requests;
CREATE POLICY "Staff and owning dealer can view requests" ON public.document_requests FOR SELECT TO authenticated
  USING ((SELECT public.is_staff(auth.uid())) OR dealer_id = (SELECT public.current_dealer_id()));
DROP POLICY IF EXISTS "Staff manage requests" ON public.document_requests;
CREATE POLICY "Staff manage requests" ON public.document_requests FOR ALL TO authenticated
  USING ((SELECT public.is_staff(auth.uid()))) WITH CHECK ((SELECT public.is_staff(auth.uid())));

DROP POLICY IF EXISTS "Staff and own dealer can view dealers" ON public.dealers;
CREATE POLICY "Staff and own dealer can view dealers" ON public.dealers FOR SELECT TO authenticated
  USING ((SELECT public.is_staff(auth.uid())) OR id = (SELECT public.current_dealer_id()));

DROP POLICY IF EXISTS "Staff and owning dealer can view customers" ON public.customers;
CREATE POLICY "Staff and owning dealer can view customers" ON public.customers FOR SELECT TO authenticated
  USING ((SELECT public.is_staff(auth.uid())) OR EXISTS (
    SELECT 1 FROM public.deals d WHERE d.customer_id = customers.id AND d.dealer_id = (SELECT public.current_dealer_id())));

DROP POLICY IF EXISTS "Staff and owning dealer can view vehicles" ON public.vehicles;
CREATE POLICY "Staff and owning dealer can view vehicles" ON public.vehicles FOR SELECT TO authenticated
  USING ((SELECT public.is_staff(auth.uid())) OR EXISTS (
    SELECT 1 FROM public.deals d WHERE d.vehicle_id = vehicles.id AND d.dealer_id = (SELECT public.current_dealer_id())));

-- staff-only usage logs
DROP POLICY IF EXISTS "Staff can read AI usage" ON public.ai_usage;
CREATE POLICY "Staff can read AI usage" ON public.ai_usage FOR SELECT TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin'))
         OR ((SELECT public.is_staff(auth.uid())) AND deal_id IS NOT NULL AND public.can_access_deal(deal_id)));
DROP POLICY IF EXISTS "Admins can read document access" ON public.document_access_log;
CREATE POLICY "Admins can read document access" ON public.document_access_log FOR SELECT TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- ---------------------------------------------------------------- aggregates
-- {"new_submission":n,"document_review":n,"credit_review":n,"income_verification":n,
--  "funding_review":n,"approved":n,"open_requests":n}
CREATE OR REPLACE FUNCTION public.queue_counts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'new_submission', count(*) FILTER (WHERE d.status = 'new_submission'),
    'document_review', count(*) FILTER (WHERE d.status = 'document_review'),
    'credit_review', count(*) FILTER (WHERE d.status = 'credit_review'),
    'income_verification', count(*) FILTER (WHERE d.status = 'income_verification'),
    'funding_review', count(*) FILTER (WHERE d.status = 'funding_review'),
    'approved', count(*) FILTER (WHERE d.status = 'approved'),
    'open_requests', (SELECT count(*) FROM public.document_requests r WHERE r.status = 'open'))
  FROM public.deals d
$$;

-- Dashboard figures (same definitions as the app's metrics): active = not funded / declined /
-- incomplete; in_review = credit, income or funding review; approval_rate = (approved + funded)
-- / (approved + funded + declined), 0..1 or null; stuck = in a working stage (not approved)
-- for more than 3 days; funded this month by funded_at; automation_7d from the history (staff
-- only); top_dealers = the 5 dealerships with the most funded deals (all time).
CREATE OR REPLACE FUNCTION public.dashboard_metrics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH bounds AS (
    SELECT (date_trunc('month', now() AT TIME ZONE 'America/Toronto')) AT TIME ZONE 'America/Toronto' AS month_start
  ), d AS (
    SELECT x.id, x.dealer_id, x.status, x.loan_amount, x.funded_amount, x.funded_at, x.status_changed_at
    FROM public.deals x
  ), agg AS (
    SELECT
      count(*) FILTER (WHERE d.status NOT IN ('funded', 'declined', 'incomplete')) AS active,
      coalesce(sum(coalesce(d.funded_amount, d.loan_amount)) FILTER (WHERE d.status = 'funded' AND d.funded_at >= b.month_start), 0) AS funded_amount,
      count(*) FILTER (WHERE d.status = 'funded' AND d.funded_at >= b.month_start) AS funded_count,
      count(*) FILTER (WHERE d.status IN ('approved', 'funded')) AS ok,
      count(*) FILTER (WHERE d.status IN ('approved', 'funded', 'declined')) AS decided,
      count(*) FILTER (WHERE d.status IN ('credit_review', 'income_verification', 'funding_review')) AS in_review,
      count(*) FILTER (WHERE d.status NOT IN ('funded', 'declined', 'incomplete', 'approved')
                         AND d.status_changed_at < now() - interval '3 days') AS stuck
    FROM d CROSS JOIN bounds b
  ), by_status AS (
    SELECT jsonb_object_agg(s.status, coalesce(c.n, 0)) AS j
    FROM unnest(enum_range(NULL::public.deal_status)) AS s(status)
    LEFT JOIN (SELECT status, count(*) AS n FROM d GROUP BY status) c ON c.status = s.status
  ), waiting AS (
    SELECT count(DISTINCT r.deal_id) AS n
    FROM public.document_requests r JOIN d ON d.id = r.deal_id
    WHERE r.status = 'open' AND d.status NOT IN ('funded', 'declined', 'incomplete')
  ), autom AS (
    SELECT
      count(*) FILTER (WHERE t.metadata ->> 'automation' = 'auto_sort') AS auto_sorted,
      count(*) FILTER (WHERE t.metadata ->> 'automation' = 'auto_fill_income') AS auto_filled,
      count(*) FILTER (WHERE t.type = 'document_request' AND t.metadata ->> 'source' = 'automation') AS requested,
      count(*) FILTER (WHERE t.metadata ->> 'automation' = 'auto_route') AS auto_routed
    FROM public.deal_timeline t
    WHERE t.created_at > now() - interval '7 days'
  ), top_d AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'dealer_id', x.dealer_id, 'name', x.name, 'funded', x.funded, 'submitted', x.submitted,
             'approval_rate', x.approval_rate) ORDER BY x.funded DESC, x.submitted DESC, x.name), '[]'::jsonb) AS j
    FROM (
      SELECT d.dealer_id, dl.name,
             count(*) FILTER (WHERE d.status = 'funded') AS funded,
             count(*) AS submitted,
             CASE WHEN count(*) FILTER (WHERE d.status IN ('approved', 'funded', 'declined')) = 0 THEN NULL
                  ELSE round(count(*) FILTER (WHERE d.status IN ('approved', 'funded'))::numeric
                             / count(*) FILTER (WHERE d.status IN ('approved', 'funded', 'declined')), 4) END AS approval_rate
      FROM d JOIN public.dealers dl ON dl.id = d.dealer_id
      GROUP BY d.dealer_id, dl.name
      ORDER BY 3 DESC, 4 DESC, 2
      LIMIT 5
    ) x
  )
  SELECT jsonb_build_object(
    'active', agg.active,
    'funded_this_month_amount', agg.funded_amount,
    'funded_this_month_count', agg.funded_count,
    'approval_rate', CASE WHEN agg.decided = 0 THEN NULL ELSE round(agg.ok::numeric / agg.decided, 4) END,
    'in_review', agg.in_review,
    'stuck_over_3_days', agg.stuck,
    'waiting_on_dealer', waiting.n,
    'by_status', by_status.j,
    'automation_7d', jsonb_build_object('auto_sorted', autom.auto_sorted, 'auto_filled', autom.auto_filled,
                                        'requested', autom.requested, 'auto_routed', autom.auto_routed),
    'top_dealers', top_d.j)
  FROM agg, by_status, waiting, autom, top_d
$$;

-- Report for [_from, _to] (whole days, Montréal time): submitted by created_at, funded by
-- funded_at, declined by decision date; approval_rate over the deals submitted in the period;
-- avg_days_to_fund over the deals funded in the period.
CREATE OR REPLACE FUNCTION public.report_metrics(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'from: must be a date on or before to' USING ERRCODE = '22023';
  END IF;
  IF _to - _from > 3660 THEN
    RAISE EXCEPTION 'to: a report covers at most 10 years' USING ERRCODE = '22023';
  END IF;

  WITH r AS (
    SELECT (_from::timestamp AT TIME ZONE 'America/Toronto') AS t0,
           ((_to + 1)::timestamp AT TIME ZONE 'America/Toronto') AS t1
  ), d AS (
    SELECT x.id, x.dealer_id, x.status, x.created_at, x.funded_at, x.loan_amount, x.funded_amount,
           coalesce(x.decision_at, x.status_changed_at) AS declined_at,
           (x.created_at >= r.t0 AND x.created_at < r.t1) AS in_submitted,
           (x.status = 'funded' AND x.funded_at >= r.t0 AND x.funded_at < r.t1) AS in_funded,
           (x.status = 'declined' AND coalesce(x.decision_at, x.status_changed_at) >= r.t0
              AND coalesce(x.decision_at, x.status_changed_at) < r.t1) AS in_declined
    FROM public.deals x, r
    WHERE (x.created_at >= r.t0 AND x.created_at < r.t1)
       OR (x.funded_at >= r.t0 AND x.funded_at < r.t1)
       OR (x.status = 'declined' AND coalesce(x.decision_at, x.status_changed_at) >= r.t0)
  ), totals AS (
    SELECT
      count(*) FILTER (WHERE in_submitted) AS submitted,
      count(*) FILTER (WHERE in_funded) AS funded_count,
      coalesce(sum(coalesce(funded_amount, loan_amount)) FILTER (WHERE in_funded), 0) AS funded_amount,
      count(*) FILTER (WHERE in_declined) AS declined,
      count(*) FILTER (WHERE in_submitted AND status IN ('approved', 'funded')) AS ok,
      count(*) FILTER (WHERE in_submitted AND status IN ('approved', 'funded', 'declined')) AS decided,
      round(avg(extract(epoch FROM funded_at - created_at) / 86400) FILTER (WHERE in_funded)::numeric, 1) AS avg_days
    FROM d
  ), per_dealer AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'dealer_id', x.dealer_id, 'name', x.name, 'submitted', x.submitted, 'funded_count', x.funded_count,
             'funded_amount', x.funded_amount, 'declined', x.declined,
             'approval_rate', CASE WHEN x.decided = 0 THEN NULL ELSE round(x.ok::numeric / x.decided, 4) END)
           ORDER BY x.funded_amount DESC, x.submitted DESC, x.name), '[]'::jsonb) AS j
    FROM (
      SELECT d.dealer_id, dl.name,
             count(*) FILTER (WHERE in_submitted) AS submitted,
             count(*) FILTER (WHERE in_funded) AS funded_count,
             coalesce(sum(coalesce(funded_amount, loan_amount)) FILTER (WHERE in_funded), 0) AS funded_amount,
             count(*) FILTER (WHERE in_declined) AS declined,
             count(*) FILTER (WHERE in_submitted AND status IN ('approved', 'funded')) AS ok,
             count(*) FILTER (WHERE in_submitted AND status IN ('approved', 'funded', 'declined')) AS decided
      FROM d JOIN public.dealers dl ON dl.id = d.dealer_id
      GROUP BY d.dealer_id, dl.name
      HAVING count(*) FILTER (WHERE in_submitted OR in_funded OR in_declined) > 0
    ) x
  ), months AS (
    SELECT to_char(m, 'YYYY-MM') AS month, m AS m0, m + interval '1 month' AS m1
    FROM generate_series(date_trunc('month', _from::timestamp), date_trunc('month', _to::timestamp), interval '1 month') AS g(m)
  ), per_month AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'month', mo.month,
             'submitted', (SELECT count(*) FROM d WHERE d.in_submitted
                             AND (d.created_at AT TIME ZONE 'America/Toronto') >= mo.m0 AND (d.created_at AT TIME ZONE 'America/Toronto') < mo.m1),
             'funded_count', (SELECT count(*) FROM d WHERE d.in_funded
                             AND (d.funded_at AT TIME ZONE 'America/Toronto') >= mo.m0 AND (d.funded_at AT TIME ZONE 'America/Toronto') < mo.m1),
             'funded_amount', (SELECT coalesce(sum(coalesce(d.funded_amount, d.loan_amount)), 0) FROM d WHERE d.in_funded
                             AND (d.funded_at AT TIME ZONE 'America/Toronto') >= mo.m0 AND (d.funded_at AT TIME ZONE 'America/Toronto') < mo.m1))
           ORDER BY mo.month), '[]'::jsonb) AS j
    FROM months mo
  )
  SELECT jsonb_build_object(
    'submitted', t.submitted,
    'funded_count', t.funded_count,
    'funded_amount', t.funded_amount,
    'declined', t.declined,
    'approval_rate', CASE WHEN t.decided = 0 THEN NULL ELSE round(t.ok::numeric / t.decided, 4) END,
    'avg_days_to_fund', t.avg_days,
    'by_dealer', pd.j,
    'by_month', pm.j)
  INTO _out
  FROM totals t, per_dealer pd, per_month pm;
  RETURN _out;
END $$;
