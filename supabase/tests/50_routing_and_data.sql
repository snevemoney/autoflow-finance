-- Production hardening: checklist and routing edge cases, submission checks, notifications,
-- audit log, search, aggregates, two-step sign-in rule, sweep. Runs after 40_hardening.
\set QUIET on
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', _what; END IF;
  RAISE NOTICE 'ok - %', _what;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.run_as(_uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), true);
  IF _uid IS NOT NULL THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
  EXECUTE _sql INTO _out;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN _out;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(_uid uuid, _sql text, _state text, _what text, _msg_like text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE _got text; _msg text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), true);
    IF _uid IS NOT NULL THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
    EXECUTE _sql;
    _got := 'no error';
  EXCEPTION WHEN others THEN
    _got := SQLSTATE; _msg := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF _got = 'no error' THEN RAISE EXCEPTION 'FAILED (no error): %', _what; END IF;
  IF _state IS NOT NULL AND _got <> _state THEN
    RAISE EXCEPTION 'FAILED (expected %, got % "%"): %', _state, _got, _msg, _what;
  END IF;
  IF _msg_like IS NOT NULL AND _msg NOT LIKE _msg_like THEN
    RAISE EXCEPTION 'FAILED (message "%" is not like "%"): %', _msg, _msg_like, _what;
  END IF;
  RAISE NOTICE 'ok - %', _what;
END $$;

-- a dealer-1 deal with every file uploaded by the dealer and nothing read yet; returns the deal id
CREATE OR REPLACE FUNCTION pg_temp.new_deal(_payload jsonb, _files text[] DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _id uuid; _f text;
BEGIN
  _id := pg_temp.run_as('00000000-0000-0000-0000-0000000000d1', format('SELECT public.submit_deal(%L::jsonb)::text', _payload))::uuid;
  FOREACH _f IN ARRAY _files LOOP
    PERFORM pg_temp.run_as('00000000-0000-0000-0000-0000000000d1',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', '%s/%s') RETURNING 'ok'$q$, _id, _f));
  END LOOP;
  RETURN _id;
END $$;

-- the service records a read document of a given type
CREATE OR REPLACE FUNCTION pg_temp.add_doc(_deal uuid, _name text, _type public.document_type, _read boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', _deal || '/' || _name) ON CONFLICT DO NOTHING;
  INSERT INTO public.documents (deal_id, name, type, file_url, storage_path, processing_status, type_source, processed_at)
  VALUES (_deal, _name, _type, _deal || '/' || _name, _deal || '/' || _name,
          CASE WHEN _read THEN 'done' ELSE 'pending' END, 'auto', CASE WHEN _read THEN now() END)
  RETURNING id INTO _id;
  RETURN _id;
END $$;
SET client_min_messages = notice;

\set admin '00000000-0000-0000-0000-00000000000a'
\set credit '00000000-0000-0000-0000-00000000000c'
\set income '00000000-0000-0000-0000-00000000000e'
\set funding '00000000-0000-0000-0000-00000000000f'
\set d1 '00000000-0000-0000-0000-0000000000d1'
\set d2 '00000000-0000-0000-0000-0000000000d2'

-- ---------------------------------------------------------------- B9. submission checks
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}, "financing": {"loan_amount": "NaN"}}')$q$, '22023',
  'NaN is refused', 'loan_amount:%');
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}, "financing": {"loan_amount": "Infinity"}}')$q$, '22023',
  'Infinity is refused', 'loan_amount:%');
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}, "financing": {"loan_amount": "12abc"}}')$q$, '22023',
  'non-numeric text is refused', 'loan_amount:%');
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}, "financing": {"down_payment": "-5000"}}')$q$, '22023',
  'a negative down payment is refused', 'down_payment:%');
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}, "financing": {"loan_amount": "18000", "apr": "499"}}')$q$, '22023',
  'an APR over 40% is refused', 'apr:%');
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}, "financing": {"loan_amount": "18000", "term_months": "1000"}}')$q$, '22023',
  'a 1000-month term is refused', 'term_months:%');
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "1000"}, "financing": {"loan_amount": "500000"}}')$q$, '22023',
  'a loan over 300% of the price is refused', 'ltv:%');
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000", "vin": "123"}}')$q$, '22023',
  'a malformed VIN is refused', 'vin:%');
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B", "email": "not an email"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}')$q$, '22023',
  'a malformed email is refused', 'email:%');
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000", "year": "1850"}}')$q$, '22023',
  'a vehicle year before 1980 is refused', 'year:%');
SELECT pg_temp.expect_error(:'d1', format($q$SELECT public.submit_deal('{"customer": {"first_name": "%s", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}')$q$, repeat('x', 201)), '22023',
  'text over 200 characters is refused', 'first_name:%');
SELECT pg_temp.expect_error(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}, "employment": {"monthly_income": "-1"}}')$q$, '22023',
  'negative income is refused', 'monthly_income:%');
SELECT pg_temp.run_as(:'d1', $q$SELECT public.submit_deal('{"customer": {"first_name": "  <script>Zoé</script>\u0007 ", "last_name": "Côté"},
  "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000", "vin": " 2t3p1rfv0rc000002 "}, "financing": {"apr": 0}}')::text$q$) AS sane \gset
SELECT pg_temp.check((SELECT c.first_name = '<script>Zoé</script>' FROM public.deals d JOIN public.customers c ON c.id = d.customer_id WHERE d.id = :'sane')
                     AND (SELECT v.vin = '2T3P1RFV0RC000002' FROM public.deals d JOIN public.vehicles v ON v.id = d.vehicle_id WHERE d.id = :'sane'),
                     'text is trimmed and control characters removed (markup is stored as plain text); VINs are normalised');

-- ---------------------------------------------------------------- B8. deal numbers never truncate
SELECT setval('public.deal_number_seq', 99998);
SELECT pg_temp.new_deal('{"customer": {"first_name": "N", "last_name": "One"}, "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}') AS n1 \gset
SELECT pg_temp.new_deal('{"customer": {"first_name": "N", "last_name": "Two"}, "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}') AS n2 \gset
SELECT pg_temp.check((SELECT deal_number ~ '^AF-[0-9]{4}-99999$' FROM public.deals WHERE id = :'n1')
                     AND (SELECT deal_number ~ '^AF-[0-9]{4}-100000$' FROM public.deals WHERE id = :'n2'),
                     'deal numbers grow past 99999 instead of colliding');

-- ---------------------------------------------------------------- B2. settled rule
SELECT pg_temp.new_deal('{"customer": {"first_name": "Set", "last_name": "Tled"}, "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}') AS s1 \gset
SELECT pg_temp.add_doc(:'s1', 'app.pdf', 'credit_application') IS NOT NULL;
SELECT pg_temp.add_doc(:'s1', 'old-upload.pdf', 'other', false) AS stale_doc \gset
UPDATE public.documents SET created_at = now() - interval '31 minutes' WHERE id = :'stale_doc';
SELECT public.autoroute_deal(:'s1');
SELECT pg_temp.check((SELECT count(*) > 0 FROM public.document_requests WHERE deal_id = :'s1' AND status = 'open'),
                     'an upload never read within 30 minutes no longer holds the deal back');
SELECT pg_temp.new_deal('{"customer": {"first_name": "Stuck", "last_name": "Read"}, "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}') AS s2 \gset
SELECT pg_temp.add_doc(:'s2', 'reading.pdf', 'other', false) AS reading_doc \gset
UPDATE public.documents SET processing_status = 'processing', processing_started_at = now() WHERE id = :'reading_doc';
SELECT pg_temp.add_doc(:'s2', 'app.pdf', 'credit_application') IS NOT NULL;
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.document_requests WHERE deal_id = :'s2'),
                     'a document being read right now holds the requests back');
UPDATE public.documents SET processing_started_at = now() - interval '16 minutes' WHERE id = :'reading_doc';
SELECT public.autoroute_deal(:'s2');
SELECT pg_temp.check((SELECT count(*) > 0 FROM public.document_requests WHERE deal_id = :'s2'),
                     'a read that started over 15 minutes ago no longer holds the deal back');

-- re-reading an already-read document never opens a request or notifies anyone
SELECT pg_temp.new_deal('{"customer": {"first_name": "Re", "last_name": "Read"}, "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}') AS rr \gset
SELECT pg_temp.add_doc(:'rr', 'app.pdf', 'credit_application') IS NOT NULL;
SELECT pg_temp.add_doc(:'rr', 'id.jpg', 'id_verification') IS NOT NULL;
SELECT pg_temp.add_doc(:'rr', 'inv.pdf', 'vehicle_invoice') IS NOT NULL;
SELECT pg_temp.add_doc(:'rr', 'ins.pdf', 'insurance') IS NOT NULL;
SELECT pg_temp.add_doc(:'rr', 'pay.pdf', 'pay_stub') AS pay_doc \gset
SELECT pg_temp.check((SELECT status = 'credit_review' FROM public.deals WHERE id = :'rr'), 'complete file reaches Credit Review');
SELECT count(*) AS notes_before FROM public.notifications WHERE deal_id = :'rr' \gset
SELECT count(*) AS reqs_before FROM public.document_requests WHERE deal_id = :'rr' \gset
UPDATE public.documents SET processing_status = 'processing', processing_started_at = now() WHERE id = :'pay_doc';
SELECT pg_temp.check((SELECT count(*) = :reqs_before FROM public.document_requests WHERE deal_id = :'rr')
                     AND (SELECT count(*) = 0 FROM public.document_requests WHERE deal_id = :'rr' AND status = 'open')
                     AND (SELECT count(*) = :notes_before FROM public.notifications WHERE deal_id = :'rr'),
                     'a re-read of a pay stub opens no request and notifies nobody');
UPDATE public.documents SET processing_status = 'done' WHERE id = :'pay_doc';

-- ---------------------------------------------------------------- B3. requests close per checklist item
SELECT pg_temp.new_deal('{"customer": {"first_name": "Close", "last_name": "Item"}, "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}') AS ci \gset
SELECT pg_temp.add_doc(:'ci', 'app.pdf', 'credit_application') IS NOT NULL;
SELECT pg_temp.add_doc(:'ci', 'id.jpg', 'id_verification') IS NOT NULL;
SELECT pg_temp.add_doc(:'ci', 'inv.pdf', 'vehicle_invoice') IS NOT NULL;
SELECT pg_temp.add_doc(:'ci', 'ins.pdf', 'insurance') IS NOT NULL;
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.document_requests WHERE deal_id = :'ci' AND status = 'open' AND doc_type = 'pay_stub'),
                     'the missing pay stub is requested');
SELECT pg_temp.add_doc(:'ci', 'lettre-emploi.pdf', 'income_verification') IS NOT NULL;
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.document_requests WHERE deal_id = :'ci' AND status = 'open')
                     AND (SELECT status = 'credit_review' FROM public.deals WHERE id = :'ci'),
                     'an employment letter satisfies the income item and closes the Pay Stub request');

-- ---------------------------------------------------------------- B5. one item per income category, with counts; trade-ins
SELECT pg_temp.new_deal('{"customer": {"first_name": "Two", "last_name": "Jobs"}, "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"},
  "trade_in": {"make": "Honda"}}') AS tj \gset
SELECT pg_temp.run_as(:'income', format($q$INSERT INTO public.income_sources (deal_id, customer_id, source_type, employer_name, stated_monthly_income)
  SELECT id, customer_id, 'part_time', 'Tim Hortons', 1200 FROM public.deals WHERE id = %L RETURNING 'ok'$q$, :'tj'));
SELECT pg_temp.check((SELECT label = 'Pay Stub (2)' AND required_count = 2 FROM public.deal_checklist_items(:'tj') WHERE item_key = 'income_employment')
                     AND (SELECT count(*) = 1 FROM public.deal_checklist_items(:'tj') WHERE item_key = 'trade_in'),
                     'two jobs need two pay stubs; a trade-in recorded by make alone needs trade-in documents');
SELECT pg_temp.add_doc(:'tj', 'pay1.pdf', 'pay_stub') IS NOT NULL;
SELECT pg_temp.check((SELECT NOT satisfied FROM public.deal_checklist_items(:'tj') WHERE item_key = 'income_employment'),
                     'one pay stub is not enough for two jobs');
SELECT pg_temp.add_doc(:'tj', 'pay2.pdf', 'pay_stub') IS NOT NULL;
SELECT pg_temp.check((SELECT satisfied FROM public.deal_checklist_items(:'tj') WHERE item_key = 'income_employment'),
                     'two pay stubs satisfy two jobs');

-- ---------------------------------------------------------------- B6. vehicle used for work
SELECT pg_temp.new_deal('{"customer": {"first_name": "Uber", "last_name": "Driver"}, "vehicle": {"make": "Toyota", "model": "Prius", "invoice_price": "26000"}}') AS vw \gset
SELECT pg_temp.run_as(:'credit', format($q$UPDATE public.income_sources SET vehicle_for_work = true WHERE deal_id = %L RETURNING 'ok'$q$, :'vw'));
SELECT pg_temp.check((SELECT status = 'declined' AND dealer_message = 'This vehicle use isn''t eligible for financing.' FROM public.deals WHERE id = :'vw')
                     AND (SELECT count(*) = 1 FROM public.deal_timeline WHERE deal_id = :'vw' AND metadata ->> 'reason_code' = 'vehicle_for_work'),
                     'a vehicle used for work is declined by the server, with a reason code');

-- ---------------------------------------------------------------- B7. switching an automation back on re-checks open deals
UPDATE public.app_settings SET automations = automations || '{"auto_route": false}' WHERE id;
SELECT pg_temp.new_deal('{"customer": {"first_name": "Paused", "last_name": "Route"}, "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}') AS pr \gset
SELECT pg_temp.check((SELECT status = 'new_submission' FROM public.deals WHERE id = :'pr'), 'with routing off a submission waits');
UPDATE public.app_settings SET automations = automations || '{"auto_route": true}' WHERE id;
SELECT pg_temp.check((SELECT status = 'document_review' FROM public.deals WHERE id = :'pr'),
                     'switching routing back on moves waiting deals along');

-- ---------------------------------------------------------------- B10. every deal has a primary income source
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.deals d
                      WHERE NOT EXISTS (SELECT 1 FROM public.income_sources s WHERE s.deal_id = d.id AND s.is_primary)),
                     'every deal has a primary income source');

-- ---------------------------------------------------------------- B11. notifications
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.notifications n JOIN public.deals d ON d.id = n.deal_id
                      WHERE n.user_id = :'admin' AND n.title LIKE '%is in your queue' AND d.id = :'ci'),
                     'queue notifications go to the role, not to every admin');
SELECT public.notify_role('credit_analyst', 'Same title', 'x', 'info', :'ci');
SELECT public.notify_role('credit_analyst', 'Same title', 'x', 'info', :'ci');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.notifications WHERE user_id = :'credit' AND title = 'Same title' AND deal_id = :'ci'),
                     'the same notification is not sent twice within a minute');

-- ---------------------------------------------------------------- C1. audit log
SELECT pg_temp.check((SELECT count(*) >= 1 FROM public.audit_log WHERE table_name = 'deals' AND row_id = :'ci' AND action = 'UPDATE'
                      AND changed ? 'status'),
                     'status changes are in the audit log');
SELECT pg_temp.run_as(:'credit', format($q$UPDATE public.customers SET phone = '514-555-0000' WHERE id = (SELECT customer_id FROM public.deals WHERE id = %L) RETURNING 'ok'$q$, :'ci'));
SELECT pg_temp.check((SELECT changed = '{"phone": "changed"}'::jsonb AND actor = :'credit' FROM public.audit_log
                      WHERE table_name = 'customers' AND action = 'UPDATE' ORDER BY id DESC LIMIT 1),
                     'customer changes are audited by field name only (no personal values) and signed');
SELECT pg_temp.expect_error(NULL, 'UPDATE public.audit_log SET actor = NULL', '42501', 'the audit log cannot be edited (even by the service)');
SELECT pg_temp.check(pg_temp.run_as(:'d1', 'SELECT count(*)::text FROM public.audit_log') = '0'
                     AND pg_temp.run_as(:'credit', 'SELECT count(*)::text FROM public.audit_log') = '0'
                     AND pg_temp.run_as(:'admin', 'SELECT (count(*) > 0)::text FROM public.audit_log') = 'true',
                     'only admins read the audit log');

-- ---------------------------------------------------------------- C2. internal helpers and usage logs
INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES ('INTERNAL_CRON_SECRET', 's3cret'), ('OTHER_SECRET', 'nope')
ON CONFLICT (name) DO UPDATE SET decrypted_secret = EXCLUDED.decrypted_secret;
SELECT pg_temp.check(public.get_internal_secret('INTERNAL_CRON_SECRET') = 's3cret' AND public.get_internal_secret('OTHER_SECRET') IS NULL,
                     'only INTERNAL_ secrets can be read as internal secrets');
SELECT pg_temp.expect_error(:'admin', $q$SELECT public.get_internal_secret('INTERNAL_CRON_SECRET')$q$, '42501', 'signed-in users cannot read internal secrets');
INSERT INTO public.ai_usage (deal_id, purpose, ok) VALUES (:'ci', 'classify', true), (:'ci', 'extract', false), (NULL, 'verify_employer', true);
SELECT pg_temp.check(public.ai_calls_today(:'ci') = 2, 'AI calls are counted per deal for the daily cap');
SELECT pg_temp.check(pg_temp.run_as(:'d1', 'SELECT count(*)::text FROM public.ai_usage') = '0'
                     AND pg_temp.run_as(:'credit', 'SELECT count(*)::text FROM public.ai_usage') = '2'
                     AND pg_temp.run_as(:'admin', 'SELECT count(*)::text FROM public.ai_usage') = '3',
                     'AI usage is staff-only (admins see all, other staff their deals)');
SELECT pg_temp.expect_error(:'admin', $q$INSERT INTO public.ai_usage (purpose) VALUES ('classify')$q$, '42501', 'only the service writes AI usage');

-- ---------------------------------------------------------------- C3/C4
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'ssn'),
                     'no plaintext SIN/SSN column');
SELECT pg_temp.check((SELECT file_size_limit = 15728640 AND 'application/pdf' = ANY (allowed_mime_types) AND NOT ('text/html' = ANY (allowed_mime_types))
                      FROM storage.buckets WHERE id = 'documents'),
                     'the documents bucket only takes PDFs and photos up to 15 MB');

-- ---------------------------------------------------------------- D. search and aggregates
SELECT pg_temp.check((SELECT search_text LIKE '%eloise berube%' FROM public.deals d JOIN public.customers c ON c.id = d.customer_id
                      WHERE c.first_name = 'Éloïse'),
                     'search text is lower-case and accent-free');
SELECT pg_temp.check(pg_temp.run_as(:'d1', $q$SELECT count(*)::text FROM public.deals WHERE search_text ILIKE '%berube%'$q$) = '1'
                     AND pg_temp.run_as(:'d2', $q$SELECT count(*)::text FROM public.deals WHERE search_text ILIKE '%berube%'$q$) = '0',
                     'search respects who can see which deal');
SELECT pg_temp.check(
  (pg_temp.run_as(:'d1', 'SELECT public.queue_counts()::text')::jsonb ->> 'document_review')::int
    = (SELECT count(*) FROM public.deals WHERE status = 'document_review' AND dealer_id = '10000000-0000-0000-0000-0000000000a1')
  AND (pg_temp.run_as(:'admin', 'SELECT public.queue_counts()::text')::jsonb ->> 'document_review')::int
    = (SELECT count(*) FROM public.deals WHERE status = 'document_review'),
  'queue counts: a dealer counts only their own deals, staff count all');
SELECT pg_temp.run_as(:'admin', 'SELECT public.dashboard_metrics()::text') AS dash \gset
SELECT pg_temp.check((:'dash'::jsonb ?& ARRAY['active', 'funded_this_month_amount', 'approval_rate', 'in_review', 'stuck_over_3_days',
                       'waiting_on_dealer', 'by_status', 'automation_7d', 'top_dealers'])
                     AND (:'dash'::jsonb ->> 'active')::int = (SELECT count(*) FROM public.deals WHERE status NOT IN ('funded', 'declined', 'incomplete')),
                     'dashboard metrics have every figure, computed in the database');
SELECT pg_temp.run_as(:'admin', format('SELECT public.report_metrics(%L, %L)::text', current_date - 30, current_date)) AS rep \gset
SELECT pg_temp.check((:'rep'::jsonb ->> 'funded_count')::int = (SELECT count(*) FROM public.deals WHERE status = 'funded' AND funded_at > now() - interval '31 days')
                     AND (:'rep'::jsonb ->> 'submitted')::int >= 10,
                     'reports count funded deals by their funding date');
SELECT pg_temp.expect_error(:'admin', format('SELECT public.report_metrics(%L, %L)', current_date, current_date - 1), '22023', 'a report needs from ≤ to');

-- ---------------------------------------------------------------- MFA rule for staff
UPDATE public.app_settings SET preferences = preferences || '{"require_staff_mfa": true}' WHERE id;
SELECT pg_temp.check(pg_temp.run_as(:'credit', 'SELECT count(*)::text FROM public.deals') = '0',
                     'with two-step sign-in required, a staff session without it sees nothing');
SELECT set_config('request.jwt.claims', '{"aal": "aal2"}', false);
SELECT pg_temp.check(pg_temp.run_as(:'credit', 'SELECT (count(*) > 0)::text FROM public.deals') = 'true',
                     'a staff session that completed two-step sign-in sees the deals');
SELECT set_config('request.jwt.claims', '', false);
SELECT pg_temp.check(pg_temp.run_as(:'d1', 'SELECT (count(*) > 0)::text FROM public.deals') = 'true',
                     'dealers are not affected by the staff two-step rule');
UPDATE public.app_settings SET preferences = preferences || '{"require_staff_mfa": false}' WHERE id;

-- ---------------------------------------------------------------- preferences keep admin values
UPDATE public.app_settings SET preferences = '{"max_apr": 19.99}' WHERE id;
SELECT pg_temp.check((SELECT preferences ->> 'max_apr' = '19.99' AND preferences ->> 'default_term_months' = '72' FROM public.app_settings WHERE id),
                     'missing settings fall back to defaults without overwriting what an admin set');

-- ---------------------------------------------------------------- E. sweep
SELECT pg_temp.new_deal('{"customer": {"first_name": "Dead", "last_name": "Run"}, "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}') AS dr \gset
SELECT pg_temp.add_doc(:'dr', 'scan.pdf', 'other', false) AS dead_doc \gset
UPDATE public.documents SET processing_status = 'processing', processing_started_at = now() - interval '20 minutes', attempt_count = 1 WHERE id = :'dead_doc';
SELECT (public.sweep_documents() ->> 'failed')::int >= 1 AS swept \gset
SELECT pg_temp.check(:'swept' AND (SELECT processing_status = 'failed' AND next_attempt_at <= now() AND processing_error LIKE '%retry%'
                                   FROM public.documents WHERE id = :'dead_doc'),
                     'the sweep turns a read that died into a retry');
SELECT pg_temp.check((SELECT count(*) > 0 FROM public.document_requests WHERE deal_id = :'dr' AND status = 'open'),
                     'the sweep re-checks deals so missing documents get requested');
