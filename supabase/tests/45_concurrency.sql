-- Concurrency: two documents of one deal finishing at the same moment (two real database
-- sessions through dblink). The second must see the first as read and open the missing-document
-- requests. Skipped when dblink isn't installed.
\set QUIET on
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', _what; END IF;
  RAISE NOTICE 'ok - %', _what;
END $$;
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS dblink;
EXCEPTION WHEN others THEN RAISE NOTICE 'dblink not available, concurrency test skipped';
END $$;
SET client_min_messages = notice;

DO $$
DECLARE
  _deal uuid;
  _pay uuid;
  _inv uuid;
  _conn text := 'dbname=' || current_database();
  _r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'dblink') THEN RETURN; END IF;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  _deal := public.submit_deal('{"customer": {"first_name": "Race", "last_name": "Condition"},
    "vehicle": {"make": "X", "model": "Y", "invoice_price": "20000"}}');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('test.race_deal', _deal::text, false);
END $$;

-- files: application and ID already read; pay stub and invoice being read right now; no insurance
INSERT INTO storage.objects (bucket_id, name)
SELECT 'documents', current_setting('test.race_deal') || '/' || f FROM unnest(ARRAY['app.pdf', 'id.jpg', 'pay.pdf', 'inv.pdf']) f;
INSERT INTO public.documents (deal_id, name, type, file_url, storage_path, processing_status, type_source, processed_at, processing_started_at)
SELECT current_setting('test.race_deal')::uuid, f, t::public.document_type, current_setting('test.race_deal') || '/' || f,
       current_setting('test.race_deal') || '/' || f, s, 'auto', CASE WHEN s = 'done' THEN now() END,
       CASE WHEN s = 'processing' THEN now() END
FROM (VALUES ('app.pdf', 'credit_application', 'processing'), ('id.jpg', 'id_verification', 'done')) v(f, t, s);
INSERT INTO public.documents (deal_id, name, type, file_url, storage_path, processing_status, type_source, processing_started_at)
SELECT current_setting('test.race_deal')::uuid, f, t::public.document_type, current_setting('test.race_deal') || '/' || f,
       current_setting('test.race_deal') || '/' || f, 'processing', 'auto', now()
FROM (VALUES ('pay.pdf', 'pay_stub'), ('inv.pdf', 'vehicle_invoice')) v(f, t);
UPDATE public.documents SET processing_status = 'done', processed_at = now() WHERE deal_id = current_setting('test.race_deal')::uuid AND name = 'app.pdf';

SELECT pg_temp.check((SELECT count(*) = 0 FROM public.document_requests WHERE deal_id = current_setting('test.race_deal')::uuid),
                     'race setup: nothing requested while two documents are still being read');

DO $$
DECLARE
  _conn text := 'dbname=' || current_database();
  _deal text := current_setting('test.race_deal');
  _r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'dblink') THEN RETURN; END IF;
  PERFORM dblink_connect('race_a', _conn);
  PERFORM dblink_connect('race_b', _conn);
  -- A finishes the pay stub and keeps its transaction open (it holds the deal lock)
  PERFORM dblink_exec('race_a', 'BEGIN');
  PERFORM dblink_exec('race_a', format($q$UPDATE public.documents SET processing_status = 'done', processed_at = now()
    WHERE deal_id = %L AND name = 'pay.pdf'$q$, _deal));
  -- B finishes the invoice at the same moment; it has to wait for A
  PERFORM dblink_send_query('race_b', format($q$UPDATE public.documents SET processing_status = 'done', processed_at = now()
    WHERE deal_id = %L AND name = 'inv.pdf'$q$, _deal));
  PERFORM pg_sleep(0.5);
  PERFORM dblink_exec('race_a', 'COMMIT');
  SELECT x INTO _r FROM dblink_get_result('race_b') AS t(x text);
  PERFORM dblink_disconnect('race_a');
  PERFORM dblink_disconnect('race_b');
END $$;

SELECT pg_temp.check((SELECT count(*) = 1 FROM public.document_requests
                      WHERE deal_id = current_setting('test.race_deal')::uuid AND status = 'open' AND doc_type = 'insurance'),
                     'two documents finishing at the same moment: the missing insurance is still requested (exactly once)');
