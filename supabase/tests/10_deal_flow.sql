-- End-to-end test of the deal flow, automations and access rules.
-- Run by scripts/test-db.sh after every migration (psql, ON_ERROR_STOP).
\set QUIET on
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', _what; END IF;
  RAISE NOTICE 'ok - %', _what;
END $$;
SET client_min_messages = notice;

-- act as a signed-in user (or as the database/service when _uid is null)
CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), false);
END $$;

-- ---------------------------------------------------------------- people
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'boss@autoflow.test', '{"name":"First Admin"}'),
  ('00000000-0000-0000-0000-00000000000c', 'credit@autoflow.test', '{"name":"Credit Analyst"}'),
  ('00000000-0000-0000-0000-00000000000e', 'income@autoflow.test', '{"name":"Income Verifier"}'),
  ('00000000-0000-0000-0000-00000000000f', 'funding@autoflow.test', '{"name":"Funding Manager"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'dealer-a@lot.test', '{"name":"Dealer A"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'dealer-b@lot.test', '{"name":"Dealer B"}'),
  ('00000000-0000-0000-0000-0000000000ff', 'stranger@x.test', '{"name":"Nobody"}');

SELECT pg_temp.check((SELECT count(*) = 7 FROM public.profiles), 'a profile is created for every sign-up');
SELECT pg_temp.check((SELECT array_agg(role::text) = ARRAY['admin'] FROM public.user_roles
                      WHERE user_id = '00000000-0000-0000-0000-00000000000a'), 'first account on a fresh project becomes admin');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.user_roles), 'later sign-ups get no access until an admin assigns it');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000000c', 'credit_analyst'),
  ('00000000-0000-0000-0000-00000000000e', 'income_verifier'),
  ('00000000-0000-0000-0000-00000000000f', 'funding_manager'),
  ('00000000-0000-0000-0000-0000000000d1', 'dealer'),
  ('00000000-0000-0000-0000-0000000000d2', 'dealer');
INSERT INTO public.dealers (id, name, code, contact_name, email, phone, city, state) VALUES
  ('10000000-0000-0000-0000-0000000000a1', 'Rive-Sud Autos', 'RSA', 'Marie', 'ventes@rsa.test', '450-555-0101', 'Longueuil', 'QC'),
  ('10000000-0000-0000-0000-0000000000b2', 'Laval Motors', 'LVM', 'Paul', 'info@lvm.test', '450-555-0202', 'Laval', 'QC');
INSERT INTO public.dealer_users (user_id, dealer_id) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000b2');
INSERT INTO storage.buckets (id, name) VALUES ('documents', 'documents') ON CONFLICT DO NOTHING;

GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid) TO authenticated;

-- ---------------------------------------------------------------- 1. dealer submits a deal
SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
SELECT public.submit_deal('{
  "customer": {"first_name": "Jean", "last_name": "Tremblay", "email": "jean@x.test", "phone": "514-555-0199", "city": "Longueuil", "state": "QC"},
  "vehicle": {"year": "2024", "make": "Toyota", "model": "RAV4", "vin": "2T3P1RFV0RC000001", "mileage": "12000", "condition": "used", "invoice_price": "32000"},
  "financing": {"down_payment": "2000", "apr": "7.99", "term_months": "72"},
  "employment": {"employer": "Hydro-Québec", "job_title": "Technicien", "monthly_income": "5200", "income_type": "salaried"},
  "dealer_id": "10000000-0000-0000-0000-0000000000b2"
}'::jsonb) AS deal_a \gset
RESET ROLE;

SELECT pg_temp.check((SELECT status = 'document_review' FROM public.deals WHERE id = :'deal_a'), 'submission is auto-routed to Document Review');
SELECT pg_temp.check((SELECT dealer_id = '10000000-0000-0000-0000-0000000000a1' FROM public.deals WHERE id = :'deal_a'),
                     'a dealer can only submit for their own dealership (payload dealer_id ignored)');
SELECT pg_temp.check((SELECT loan_amount = 30000 AND monthly_payment BETWEEN 520 AND 530 AND ltv = 93.8 FROM public.deals WHERE id = :'deal_a'),
                     'loan, payment and LTV are computed from the submission');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.income_sources WHERE deal_id = :'deal_a' AND stated_monthly_income = 5200),
                     'stated income becomes the primary income source');
SELECT pg_temp.check((SELECT array_agg(description ORDER BY created_at) = ARRAY['Submitted by Rive-Sud Autos', 'Auto-routed to Document Review — Submission received']
                      FROM public.deal_timeline WHERE deal_id = :'deal_a'), 'timeline records submission then routing, in order');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.document_requests WHERE deal_id = :'deal_a'),
                     'nothing is requested before the dealer has uploaded anything');

-- ---------------------------------------------------------------- 2. access rules
SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.deals), 'dealer sees their own deal');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.customers), 'dealer sees their own customer');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.income_sources), 'dealer cannot see underwriting (income sources)');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.deal_timeline), 'dealer cannot see the internal timeline');
UPDATE public.deals SET status = 'approved' WHERE id = :'deal_a';
SELECT pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.deals), 'another dealer cannot see the deal');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.customers), 'another dealer cannot see the customer');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.dealers), 'a dealer only sees their own dealership');
SELECT pg_temp.act_as('00000000-0000-0000-0000-0000000000ff');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.deals) AND (SELECT count(*) = 0 FROM public.dealers),
                     'an account with no role sees nothing');
RESET ROLE;
SELECT pg_temp.check((SELECT status = 'document_review' FROM public.deals WHERE id = :'deal_a'), 'a dealer cannot change deal status');

DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', true);
  BEGIN
    PERFORM public.submit_deal('{"customer": {"first_name": "X", "last_name": "Y"}, "financing": {"loan_amount": 1000}}');
    RAISE EXCEPTION 'FAILED: unlinked account submitted a deal';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - an account without a dealership cannot submit';
  END;
END $$;

-- storage: dealer may upload only under their own deal folder
SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', :'deal_a' || '/stub.pdf');
RESET ROLE;
SELECT set_config('test.deal_a', :'deal_a', false);
DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', current_setting('test.deal_a') || '/sneaky.pdf');
    RAISE EXCEPTION 'FAILED: dealer B uploaded into a folder it does not own';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - storage blocks uploads into another dealer''s deal';
  END;
END $$;

-- ---------------------------------------------------------------- 3. uploads → auto-sort → gap requests
SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
INSERT INTO public.documents (deal_id, name, type, file_url, storage_path, processing_status, type_source) VALUES
  (:'deal_a', 'scan1.pdf', 'other', :'deal_a' || '/scan1.pdf', :'deal_a' || '/scan1.pdf', 'pending', 'auto'),
  (:'deal_a', 'scan2.pdf', 'other', :'deal_a' || '/scan2.pdf', :'deal_a' || '/scan2.pdf', 'pending', 'auto'),
  (:'deal_a', 'scan3.pdf', 'other', :'deal_a' || '/scan3.pdf', :'deal_a' || '/scan3.pdf', 'pending', 'auto'),
  (:'deal_a', 'paie.jpg', 'other', :'deal_a' || '/paie.jpg', :'deal_a' || '/paie.jpg', 'pending', 'auto');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.document_requests WHERE deal_id = :'deal_a'),
                     'no requests while documents are still being read');

-- the AI worker (service role) sorts them one by one
UPDATE public.documents SET type = 'credit_application', processing_status = 'done' WHERE name = 'scan1.pdf';
UPDATE public.documents SET type = 'id_verification', processing_status = 'done' WHERE name = 'scan2.pdf';
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.document_requests WHERE deal_id = :'deal_a'),
                     'still no requests while one document is unread');
UPDATE public.documents SET type = 'vehicle_invoice', processing_status = 'done' WHERE name = 'scan3.pdf';
UPDATE public.documents SET type = 'pay_stub', processing_status = 'done' WHERE name = 'paie.jpg';

SELECT pg_temp.check((SELECT array_agg(label) = ARRAY['Insurance Proof'] FROM public.document_requests
                      WHERE deal_id = :'deal_a' AND status = 'open' AND source = 'automation'),
                     'once everything is read, exactly the missing document is requested');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.notifications
                      WHERE user_id = '00000000-0000-0000-0000-0000000000d1' AND title LIKE 'Document needed%'),
                     'the dealer is notified of the request');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.notifications
                      WHERE user_id = '00000000-0000-0000-0000-0000000000d2'), 'other dealers are not notified');
SELECT pg_temp.check((SELECT status = 'document_review' FROM public.deals WHERE id = :'deal_a'), 'deal waits in Document Review');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.deal_checklist(:'deal_a') WHERE NOT satisfied),
                     'checklist shows one gap');

-- re-running sync never duplicates a request
RESET ROLE;
SELECT public.sync_document_requests(:'deal_a');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.document_requests WHERE deal_id = :'deal_a'), 'requests are not duplicated');

-- dealer answers the request
SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.document_requests WHERE status = 'open'), 'dealer sees the open request in the portal');
INSERT INTO public.documents (deal_id, name, type, file_url, storage_path, processing_status, type_source)
VALUES (:'deal_a', 'assurance.pdf', 'insurance', :'deal_a' || '/assurance.pdf', :'deal_a' || '/assurance.pdf', 'pending', 'manual');
RESET ROLE;
UPDATE public.documents SET processing_status = 'done' WHERE name = 'assurance.pdf';

SELECT pg_temp.check((SELECT status = 'fulfilled' FROM public.document_requests WHERE deal_id = :'deal_a'), 'request is fulfilled by the upload');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.notifications WHERE user_id = '00000000-0000-0000-0000-00000000000a'
                      AND title = 'Dealer sent Insurance Proof — deal ' || (SELECT deal_number FROM public.deals WHERE id = :'deal_a')),
                     'staff are told when the dealer answers a request');
SELECT pg_temp.check((SELECT status = 'credit_review' AND assigned_department = 'credit' FROM public.deals WHERE id = :'deal_a'),
                     'complete file is auto-routed to Credit Review');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.notifications WHERE user_id = '00000000-0000-0000-0000-00000000000c'
                      AND title LIKE '%is in your queue'), 'the credit team is notified');

-- ---------------------------------------------------------------- 4. credit → income → funding → funded
DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
  BEGIN
    PERFORM public.record_credit_decision((SELECT id FROM public.deals LIMIT 1), 'approved');
    RAISE EXCEPTION 'FAILED: dealer approved credit';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - dealers cannot make credit decisions';
  END;
END $$;

SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
SELECT public.record_credit_decision(:'deal_a', 'approved', 'Stable employment', 712, 'prime', 'equifax');
RESET ROLE;
SELECT pg_temp.check((SELECT status = 'income_verification' AND credit_score = 712 FROM public.deals WHERE id = :'deal_a'),
                     'credit approval routes to Income Verification');

SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
UPDATE public.income_sources SET verification_status = 'verified', verified_at = now() WHERE deal_id = :'deal_a';
RESET ROLE;
SELECT pg_temp.check((SELECT status = 'funding_review' AND income_verified_at IS NOT NULL FROM public.deals WHERE id = :'deal_a'),
                     'verified income routes to Funding Review');

DO $$ BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', true);
  BEGIN
    PERFORM public.approve_funding((SELECT id FROM public.deals WHERE status = 'funding_review' LIMIT 1));
    RAISE EXCEPTION 'FAILED: funding approved with an empty checklist';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok - funding cannot be approved until the checklist is complete';
  END;
END $$;

SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
SELECT public.update_funding_checklist(:'deal_a', '{"contract_signed": true, "id_confirmed": true, "insurance_confirmed": true,
  "invoice_matches": true, "lien_registered": true, "down_payment_received": true}');
SELECT public.approve_funding(:'deal_a', 'All stips cleared');
RESET ROLE;
SELECT pg_temp.check((SELECT status = 'approved' FROM public.deals WHERE id = :'deal_a'), 'approved for funding');
SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
SELECT public.mark_funded(:'deal_a');
RESET ROLE;
SELECT pg_temp.check((SELECT status = 'funded' AND funded_amount = 30000 AND funded_at IS NOT NULL FROM public.deals WHERE id = :'deal_a'),
                     'marked funded, funded amount defaults to the loan amount');
SELECT pg_temp.check((SELECT count(*) >= 1 FROM public.notifications WHERE user_id = '00000000-0000-0000-0000-0000000000d1'
                      AND title LIKE '%Funded' AND type = 'success'), 'the dealer is told the deal funded');

-- ---------------------------------------------------------------- 5. staff deal, decline, manual moves, switches
SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
SELECT public.submit_deal('{
  "dealer_id": "10000000-0000-0000-0000-0000000000b2",
  "customer": {"first_name": "Lise", "last_name": "Gagnon"},
  "vehicle": {"make": "Honda", "model": "Civic", "invoice_price": "24000"},
  "financing": {"loan_amount": "20000", "apr": "0", "term_months": "48"}
}'::jsonb) AS deal_b \gset
RESET ROLE;
SELECT pg_temp.check((SELECT dealer_id = '10000000-0000-0000-0000-0000000000b2' AND monthly_payment = 416.67 AND NOT submitted_by_dealer
                      FROM public.deals WHERE id = :'deal_b'), 'staff can enter a deal for any dealer (0% APR payment handled)');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.deal_checklist(:'deal_b') WHERE item_key = 'income_employment'),
                     'a deal with no income source still needs proof of income');

SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
SELECT public.request_document(:'deal_b', 'bank_statement', 'Last 3 months please');
SELECT public.request_document(:'deal_b', 'bank_statement', 'again');
UPDATE public.deals SET status = 'credit_review' WHERE id = :'deal_b';
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.document_requests WHERE deal_id = :'deal_b'), 'a staff request is not duplicated');
SELECT pg_temp.check((SELECT description = 'Moved from Document Review to Credit Review' AND created_by = '00000000-0000-0000-0000-00000000000a'
                      FROM public.deal_timeline WHERE deal_id = :'deal_b' ORDER BY created_at DESC LIMIT 1),
                     'a manual move is logged with who did it');

SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
SELECT public.record_credit_decision(:'deal_b', 'declined', 'Insufficient income');
RESET ROLE;
SELECT pg_temp.check((SELECT status = 'declined' FROM public.deals WHERE id = :'deal_b'), 'credit decline declines the deal');
SELECT pg_temp.check((SELECT status = 'cancelled' FROM public.document_requests WHERE deal_id = :'deal_b'), 'open requests are cancelled on decline');

UPDATE public.app_settings SET automations = automations || '{"auto_route": false}', preferences = '{"notify_new": false}';
SET ROLE authenticated;
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
SELECT public.submit_deal('{"dealer_id": "10000000-0000-0000-0000-0000000000a1", "customer": {"first_name": "A", "last_name": "B"},
  "financing": {"loan_amount": "1000", "term_months": "12"}}'::jsonb) AS deal_c \gset
RESET ROLE;
SELECT pg_temp.check((SELECT status = 'new_submission' FROM public.deals WHERE id = :'deal_c'), 'auto-routing can be switched off');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.notifications WHERE deal_id = :'deal_c'), 'new-deal notifications can be switched off');
UPDATE public.app_settings SET automations = automations || '{"auto_route": true}';

SELECT pg_temp.check((SELECT total_deals = 2 AND funded_deals = 1 FROM public.dealer_stats WHERE dealer_id = '10000000-0000-0000-0000-0000000000a1'),
                     'dealer stats count deals per dealership');

\echo 'deal flow: all checks passed'
