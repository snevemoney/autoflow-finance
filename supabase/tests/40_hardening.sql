-- Production hardening: separation of duties, deal actions, documents, history, notifications,
-- profiles and accounts. Runs after 10_deal_flow (same database; reuses its people and dealers).
\set QUIET on
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', _what; END IF;
  RAISE NOTICE 'ok - %', _what;
END $$;

-- run SQL as a signed-in user (NULL = the database / service) and return the first column as text
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

-- the SQL must fail as that user with the given SQLSTATE (NULL = any error)
CREATE OR REPLACE FUNCTION pg_temp.expect_error(_uid uuid, _sql text, _state text, _what text) RETURNS void LANGUAGE plpgsql AS $$
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
  RAISE NOTICE 'ok - %', _what;
END $$;
SET client_min_messages = notice;

-- people (from 10_deal_flow): a admin, c credit analyst, e income verifier, f funding manager,
-- d1 dealer of Rive-Sud (a1), d2 dealer of Laval (b2), ff no role. New here: d3 (dealership c3).
\set admin '00000000-0000-0000-0000-00000000000a'
\set credit '00000000-0000-0000-0000-00000000000c'
\set income '00000000-0000-0000-0000-00000000000e'
\set funding '00000000-0000-0000-0000-00000000000f'
\set d1 '00000000-0000-0000-0000-0000000000d1'
\set d2 '00000000-0000-0000-0000-0000000000d2'
\set d3 '00000000-0000-0000-0000-0000000000d3'
\set nobody '00000000-0000-0000-0000-0000000000ff'

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (:'d3', 'dealer-c@lot.test', '{"name":"Dealer C"}');
INSERT INTO public.dealers (id, name, code, contact_name, email, phone, city, state) VALUES
  ('10000000-0000-0000-0000-0000000000c3', 'Brossard Auto', 'BRA', 'Luc', 'luc@bra.test', '450-555-0303', 'Brossard', 'QC');
SELECT pg_temp.run_as(:'admin', format('SELECT public.set_user_access(%L, %L, %L)', :'d3', 'dealer', '10000000-0000-0000-0000-0000000000c3'));
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.dealer_users WHERE user_id = :'d3')
                     AND (SELECT count(*) = 1 FROM public.user_roles WHERE user_id = :'d3' AND role = 'dealer'),
                     'set_user_access links a dealer account to its dealership');

-- a fresh deal from dealer 1, with every required document uploaded and read
SELECT pg_temp.run_as(:'d1', $q$SELECT public.submit_deal('{
  "customer": {"first_name": "Éloïse", "last_name": "Bérubé", "email": "eloise@x.test"},
  "vehicle": {"year": "2023", "make": "Mazda", "model": "CX-5", "invoice_price": "30000"},
  "financing": {"down_payment": "3000", "apr": "6.99", "term_months": "60"},
  "employment": {"employer": "Desjardins", "monthly_income": "6000", "income_type": "salaried"}
}'::jsonb)::text$q$) AS h1 \gset
SELECT set_config('test.h1', :'h1', false);

-- the dealer uploads 5 files (they must exist in storage first)
SELECT pg_temp.run_as(:'d1', format($q$INSERT INTO storage.objects (bucket_id, name) VALUES
  ('documents', '%1$s/app.pdf'), ('documents', '%1$s/id.jpg'), ('documents', '%1$s/invoice.pdf'),
  ('documents', '%1$s/insurance.pdf'), ('documents', '%1$s/paystub.pdf') RETURNING 'ok'$q$, :'h1'));

-- the dealer tries to mark the documents as already read, manual and uploaded by someone else
SELECT pg_temp.run_as(:'d1', format($q$INSERT INTO public.documents
  (deal_id, name, type, file_url, storage_path, processing_status, type_source, status, uploaded_by, processed_at) VALUES
  (%1$L, 'app.pdf', 'credit_application', 'x', '%1$s/app.pdf', 'done', 'rule', 'verified', %2$L, now()),
  (%1$L, 'id.jpg', 'id_verification', 'x', '%1$s/id.jpg', 'done', 'rule', 'verified', %2$L, now()),
  (%1$L, 'invoice.pdf', 'vehicle_invoice', 'x', '%1$s/invoice.pdf', 'skipped', 'auto', 'pending', %2$L, now()),
  (%1$L, 'insurance.pdf', 'insurance', 'x', '%1$s/insurance.pdf', 'done', 'auto', 'pending', %2$L, now()),
  (%1$L, 'paystub.pdf', 'other', 'x', '%1$s/paystub.pdf', 'done', 'auto', 'pending', %2$L, now())
  RETURNING 'ok'$q$, :'h1', :'credit'));

SELECT pg_temp.check((SELECT bool_and(processing_status = 'pending' AND status = 'pending' AND uploaded_by = :'d1'
                                      AND processed_at IS NULL AND file_url = storage_path)
                      FROM public.documents WHERE deal_id = :'h1'),
                     'dealer uploads always start unread and pending, signed by the dealer (fields they sent are ignored)');
SELECT pg_temp.check((SELECT type_source = 'auto' FROM public.documents WHERE deal_id = :'h1' AND name = 'paystub.pdf')
                     AND (SELECT type_source = 'manual' FROM public.documents WHERE deal_id = :'h1' AND name = 'invoice.pdf'),
                     'a typed upload counts as manual, an untyped one is left for AutoFlow to sort');
SELECT pg_temp.check((SELECT status = 'document_review' FROM public.deals WHERE id = :'h1'),
                     'unread uploads do not move the deal (no fake "done" documents)');

SELECT pg_temp.expect_error(:'d1', format($q$INSERT INTO public.documents (deal_id, name, type, file_url, storage_path)
  VALUES (%L, 'ghost.pdf', 'insurance', 'x', %L)$q$, :'h1', :'h1' || '/ghost.pdf'), '22023',
  'a document row must point at a file that was really uploaded');
SELECT pg_temp.run_as(:'admin', format($q$SELECT public.submit_deal('{"dealer_id": "10000000-0000-0000-0000-0000000000b2",
  "customer": {"first_name": "Other", "last_name": "Deal"}, "vehicle": {"make": "Kia", "model": "Rio", "invoice_price": "18000"},
  "financing": {"loan_amount": "15000", "apr": "5", "term_months": "60"}}'::jsonb)::text$q$)) AS other_deal \gset
SELECT pg_temp.run_as(:'d2', format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', '%s/b.pdf') RETURNING 'ok'$q$, :'other_deal'));
SELECT pg_temp.expect_error(:'d1', format($q$INSERT INTO public.documents (deal_id, name, type, file_url, storage_path)
  VALUES (%L, 'b.pdf', 'insurance', 'x', %L)$q$, :'h1', :'other_deal' || '/b.pdf'), '22023',
  'a dealer cannot attach another deal''s file to their deal');

-- the service (edge function) reads them: pay stub sorted, everything done
UPDATE public.documents SET type = 'pay_stub', type_source = 'auto' WHERE deal_id = :'h1' AND name = 'paystub.pdf';
UPDATE public.documents SET processing_status = 'done', processed_at = now() WHERE deal_id = :'h1';
SELECT pg_temp.check((SELECT status = 'credit_review' FROM public.deals WHERE id = :'h1'),
                     'once really read, a complete file moves to Credit Review');

-- ---------------------------------------------------------------- A1. deals change only through actions
SELECT pg_temp.expect_error(:'income', format('UPDATE public.deals SET funding_approved_at = now(), status = %L WHERE id = %L', 'funded', :'h1'),
  '42501', 'an income verifier cannot approve or fund a deal by editing it');
SELECT pg_temp.expect_error(:'credit', format('UPDATE public.deals SET loan_amount = 1, dealer_id = %L WHERE id = %L',
  '10000000-0000-0000-0000-0000000000b2', :'h1'), '42501', 'a credit analyst cannot change loan terms or the dealer directly');
SELECT pg_temp.expect_error(:'admin', format('DELETE FROM public.deals WHERE id = %L', :'h1'), '42501',
  'not even an admin deletes a deal directly');
SELECT pg_temp.expect_error(:'credit', format('SELECT public.admin_move_deal(%L, %L)', :'h1', 'funding_review'), '42501',
  'only admins move deals by hand');
SELECT pg_temp.expect_error(:'admin', format('SELECT public.admin_move_deal(%L, %L)', :'h1', 'funded'), '22023',
  'a deal cannot be moved to Funded unless it is approved');

-- credit outside its stage
SELECT pg_temp.run_as(:'admin', format('SELECT public.admin_move_deal(%L, %L, %L)', :'h1', 'income_verification', 'testing'));
SELECT pg_temp.expect_error(:'credit', format('SELECT public.record_credit_decision(%L, %L)', :'h1', 'approved'), '22023',
  'a credit analyst records decisions only in Credit Review');
SELECT pg_temp.run_as(:'admin', format('SELECT public.admin_move_deal(%L, %L)', :'h1', 'credit_review'));
SELECT pg_temp.check((SELECT status = 'credit_review' AND credit_decision = 'pending' FROM public.deals WHERE id = :'h1'),
                     'an admin can move a deal back to Credit Review');

-- conditional approval
SELECT pg_temp.expect_error(:'credit', format('SELECT public.record_credit_decision(%L, %L)', :'h1', 'conditional'), '22023',
  'a conditional approval needs conditions');
SELECT pg_temp.expect_error(:'credit', format($q$SELECT public.record_credit_decision(%L, 'approved', _conditions => '[{"label":"x"}]')$q$, :'h1'), '22023',
  'only a conditional approval carries conditions');
SELECT pg_temp.run_as(:'credit', format($q$SELECT public.record_credit_decision(%L, 'conditional', 'Thin file', 640, 'near_prime', 'equifax',
  '[{"label":"Proof of residence"},{"label":"Two recent pay stubs"}]', 'Approved with two conditions.')$q$, :'h1'));
SELECT pg_temp.check((SELECT status = 'income_verification' AND jsonb_array_length(credit_conditions) = 2
                             AND dealer_message = 'Approved with two conditions.'
                             AND credit_decision_notes IS NULL AND decision_notes IS NULL
                      FROM public.deals WHERE id = :'h1'),
                     'conditional approval stores 2 conditions and a dealer message, internal notes stay out of the deal row');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.deal_timeline WHERE deal_id = :'h1' AND metadata ->> 'notes' = 'Thin file'),
                     'the internal note is on the staff-only history');

-- income: only verifiers verify
SELECT pg_temp.expect_error(:'credit', format($q$UPDATE public.income_sources SET verification_status = 'verified' WHERE deal_id = %L$q$, :'h1'), '42501',
  'a credit analyst cannot mark income verified');
SELECT pg_temp.check(pg_temp.run_as(:'credit', format('WITH x AS (DELETE FROM public.income_sources WHERE deal_id = %L RETURNING 1) SELECT count(*)::text FROM x', :'h1')) = '0'
                     AND (SELECT count(*) = 1 FROM public.income_sources WHERE deal_id = :'h1'),
                     'a credit analyst cannot delete an income source');
SELECT pg_temp.run_as(:'income', format($q$UPDATE public.income_sources SET verification_status = 'verified' WHERE deal_id = %L RETURNING 'ok'$q$, :'h1'));
SELECT pg_temp.check((SELECT bool_and(verified_by = :'income' AND verified_at IS NOT NULL) FROM public.income_sources WHERE deal_id = :'h1')
                     AND (SELECT status = 'funding_review' FROM public.deals WHERE id = :'h1'),
                     'an income verifier verifies (signed and dated) and the deal moves to Funding Review');
SELECT pg_temp.expect_error(:'credit', format($q$UPDATE public.income_sources SET calculated_monthly_income = 99999 WHERE deal_id = %L$q$, :'h1'), '42501',
  'a verified income source can only be changed by a verifier');

-- funding: checklist + conditions + documents
SELECT pg_temp.run_as(:'funding', format($q$SELECT public.update_funding_checklist(%L, '{"contract_signed": true, "id_confirmed": true,
  "insurance_confirmed": true, "invoice_matches": true, "lien_registered": true, "down_payment_received": true}')::text$q$, :'h1'));
SELECT pg_temp.expect_error(:'funding', format('SELECT public.approve_funding(%L)', :'h1'), '23514',
  'funding cannot be approved while credit conditions are open');
SELECT pg_temp.expect_error(:'d1', format('SELECT public.set_credit_condition(%L, %L, true)', :'h1',
  (SELECT credit_conditions -> 0 ->> 'id' FROM public.deals WHERE id = :'h1')), '42501', 'a dealer cannot clear a condition');
SELECT pg_temp.run_as(:'funding', format('SELECT public.set_credit_condition(%L, %L, true)::text', :'h1', id))
FROM (SELECT e ->> 'id' AS id FROM public.deals, jsonb_array_elements(credit_conditions) e WHERE deals.id = :'h1') c;
SELECT pg_temp.check((SELECT bool_and(e ->> 'cleared_at' IS NOT NULL AND e ->> 'cleared_by' = :'funding')
                      FROM public.deals, jsonb_array_elements(credit_conditions) e WHERE deals.id = :'h1'),
                     'conditions are cleared one by one, signed by who cleared them');

-- a document rejected late: requests reopen and funding approval is blocked
SELECT pg_temp.run_as(:'funding', format($q$UPDATE public.documents SET status = 'rejected' WHERE deal_id = %L AND type = 'insurance' RETURNING 'ok'$q$, :'h1'));
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.document_requests WHERE deal_id = :'h1' AND status = 'open' AND doc_type = 'insurance'
                      AND message = 'Needed to complete the file'),
                     'rejecting a document after Document Review asks the dealer again');
SELECT pg_temp.check((SELECT status = 'funding_review' FROM public.deals WHERE id = :'h1'),
                     'the deal is not moved backwards automatically');
SELECT pg_temp.expect_error(:'funding', format('SELECT public.approve_funding(%L)', :'h1'), '23514',
  'funding cannot be approved while a required document is missing');

-- the dealer sends a new insurance proof; the request closes and funding goes through
SELECT pg_temp.run_as(:'d1', format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', '%s/insurance2.pdf') RETURNING 'ok'$q$, :'h1'));
SELECT pg_temp.run_as(:'d1', format($q$INSERT INTO public.documents (deal_id, name, type, file_url, storage_path)
  VALUES (%1$L, 'insurance2.pdf', 'insurance', 'x', '%1$s/insurance2.pdf') RETURNING 'ok'$q$, :'h1'));
UPDATE public.documents SET processing_status = 'done', processed_at = now() WHERE deal_id = :'h1' AND name = 'insurance2.pdf';
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.document_requests WHERE deal_id = :'h1' AND status = 'open'),
                     'the new document closes the request');
SELECT pg_temp.run_as(:'funding', format('SELECT public.approve_funding(%L)::text', :'h1'));
SELECT pg_temp.check((SELECT status = 'approved' FROM public.deals WHERE id = :'h1'), 'conditions cleared + complete file → approved');

-- backwards moves clear what was decided later, so the deal stays where it is put
SELECT pg_temp.run_as(:'admin', format('SELECT public.admin_move_deal(%L, %L, %L)', :'h1', 'income_verification', 're-check income'));
SELECT pg_temp.check((SELECT status = 'income_verification' AND funding_approved_at IS NULL AND income_verified_at IS NULL
                      FROM public.deals WHERE id = :'h1')
                     AND (SELECT bool_and(verification_status = 'needs_review') FROM public.income_sources WHERE deal_id = :'h1'),
                     'moving back to Income Verification reopens income and clears the funding approval');
SELECT pg_temp.check((SELECT metadata -> 'cleared' @> '["funding_approval", "income_verification"]'::jsonb AND created_by = :'admin'
                      FROM public.deal_timeline WHERE deal_id = :'h1' AND metadata ->> 'to' = 'income_verification' AND (metadata ->> 'manual')::boolean
                      ORDER BY created_at DESC LIMIT 1),
                     'the manual move is logged with who did it and what it cleared');

-- decline from a later stage
SELECT pg_temp.expect_error(:'income', format('SELECT public.decline_deal(%L, %L)', :'h1', 'no'), '42501',
  'an income verifier cannot decline');
SELECT pg_temp.expect_error(:'credit', format('SELECT public.decline_deal(%L, NULL)', :'h1'), '22023', 'a decline needs an internal reason');
SELECT pg_temp.run_as(:'credit', format('SELECT public.decline_deal(%L, %L, %L)', :'h1', 'Fraud suspected on pay stub', 'We cannot approve this application.'));
SELECT pg_temp.check((SELECT status = 'declined' AND dealer_message = 'We cannot approve this application.' AND decision_notes IS NULL
                      FROM public.deals WHERE id = :'h1'),
                     'a credit analyst declines from Income Verification; the dealer gets only the dealer message');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.notifications WHERE user_id = :'d1' AND deal_id = :'h1'
                      AND message = 'We cannot approve this application.'),
                     'the dealer is told with the dealer message, not the internal reason');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.notifications WHERE user_id = :'d1' AND message LIKE '%Fraud%'),
                     'the internal reason never reaches the dealer');

-- a decline after approval (admin override)
SELECT pg_temp.run_as(:'admin', $q$SELECT public.submit_deal('{"dealer_id": "10000000-0000-0000-0000-0000000000a1",
  "customer": {"first_name": "Paul", "last_name": "Roy"}, "vehicle": {"make": "Ford", "model": "Escape", "invoice_price": "28000"},
  "financing": {"loan_amount": "25000", "apr": "8", "term_months": "72"}}'::jsonb)::text$q$) AS h2 \gset
SELECT pg_temp.run_as(:'admin', format('SELECT public.admin_move_deal(%L, %L)', :'h2', 'credit_review'));
SELECT pg_temp.run_as(:'credit', format('SELECT public.record_credit_decision(%L, %L)', :'h2', 'approved'));
SELECT pg_temp.run_as(:'admin', format('SELECT public.record_credit_decision(%L, %L, %L)', :'h2', 'declined', 'New info'));
SELECT pg_temp.check((SELECT status = 'declined' AND credit_decision = 'declined' FROM public.deals WHERE id = :'h2'),
                     'a decline recorded after approval (admin override) declines the deal');

-- ---------------------------------------------------------------- A3. documents
SELECT pg_temp.expect_error(:'credit', format($q$UPDATE public.documents SET storage_path = 'x/y.pdf' WHERE deal_id = %L$q$, :'h1'), '42501',
  'staff can change only a document''s type, status and notes');
SELECT pg_temp.run_as(:'credit', format($q$UPDATE public.documents SET type = 'bank_statement' WHERE deal_id = %L AND name = 'paystub.pdf' RETURNING 'ok'$q$, :'h1'));
SELECT pg_temp.check((SELECT type_source = 'manual' FROM public.documents WHERE deal_id = :'h1' AND name = 'paystub.pdf'),
                     'a person who changes a type owns it (AutoFlow never overwrites it)');
SELECT pg_temp.check(pg_temp.run_as(:'d1', format('WITH x AS (DELETE FROM public.documents WHERE deal_id = %L RETURNING 1) SELECT count(*)::text FROM x', :'h1')) = '0'
                     AND pg_temp.run_as(:'credit', format('WITH x AS (DELETE FROM public.documents WHERE deal_id = %L RETURNING 1) SELECT count(*)::text FROM x', :'h1')) = '0',
                     'dealers and non-admin staff cannot delete documents');
SELECT pg_temp.check(pg_temp.run_as(:'credit', format($q$WITH x AS (DELETE FROM storage.objects WHERE name LIKE '%s/%%' RETURNING 1) SELECT count(*)::text FROM x$q$, :'h1')) = '0',
                     'non-admin staff cannot delete stored files');

UPDATE public.documents SET processing_status = 'failed', attempt_count = 2, processing_error = 'x' WHERE deal_id = :'h1' AND name = 'id.jpg';
SELECT pg_temp.expect_error(:'d2', format($q$SELECT public.retry_document((SELECT id FROM public.documents WHERE deal_id = %L AND name = 'id.jpg'))$q$, :'h1'),
  NULL, 'another dealer cannot retry the document');
SELECT pg_temp.run_as(:'d1', format($q$SELECT public.retry_document(id)::text FROM public.documents WHERE deal_id = %L AND name = 'id.jpg'$q$, :'h1')) AS retried \gset
SELECT pg_temp.check(:'retried' = 'true' AND (SELECT processing_status = 'pending' FROM public.documents WHERE deal_id = :'h1' AND name = 'id.jpg'),
                     'the owning dealer can retry a failed read');
UPDATE public.documents SET processing_status = 'failed', attempt_count = 5 WHERE deal_id = :'h1' AND name = 'id.jpg';
SELECT pg_temp.check(pg_temp.run_as(:'d1', format($q$SELECT public.retry_document(id)::text FROM public.documents WHERE deal_id = %L AND name = 'id.jpg'$q$, :'h1')) = 'false',
                     'after 5 attempts a retry is refused');
UPDATE public.documents SET processing_status = 'done', processing_error = NULL WHERE deal_id = :'h1' AND name = 'id.jpg';

-- ---------------------------------------------------------------- A4/A5. history and notifications
SELECT pg_temp.run_as(:'credit', format($q$INSERT INTO public.deal_timeline (deal_id, type, description, created_by)
  VALUES (%L, 'note_added', 'Called the dealer', %L) RETURNING 'ok'$q$, :'h1', :'funding'));
SELECT pg_temp.check((SELECT created_by = :'credit' FROM public.deal_timeline WHERE deal_id = :'h1' AND description = 'Called the dealer'),
                     'history entries are signed by whoever writes them (no impersonation)');
SELECT pg_temp.expect_error(:'admin', format($q$UPDATE public.deal_timeline SET description = 'x' WHERE deal_id = %L$q$, :'h1'), '42501',
  'nobody edits the history');
SELECT pg_temp.expect_error(:'credit', format($q$INSERT INTO public.notifications (user_id, title, message) VALUES (%L, 'x', 'y')$q$, :'d1'), '42501',
  'staff cannot send arbitrary notifications');
SELECT pg_temp.expect_error(:'d1', format($q$UPDATE public.notifications SET title = 'changed' WHERE user_id = %L$q$, :'d1'), '42501',
  'a user can only mark a notification read, not edit it');
SELECT pg_temp.check(pg_temp.run_as(:'d1', format($q$WITH x AS (UPDATE public.notifications SET read = true WHERE user_id = %L RETURNING 1) SELECT (count(*) > 0)::text FROM x$q$, :'d1')) = 'true',
                     'a user marks their notifications read');

-- ---------------------------------------------------------------- A6/A7/A8. profiles and accounts
SELECT pg_temp.expect_error(:'nobody', format($q$UPDATE public.profiles SET email = 'credit@autoflow.test' WHERE user_id = %L$q$, :'nobody'), '42501',
  'a user cannot change the email shown to admins');
SELECT pg_temp.expect_error(:'nobody', format($q$UPDATE public.profiles SET department = 'credit' WHERE user_id = %L$q$, :'nobody'), '42501',
  'a user cannot give themselves a department');
SELECT pg_temp.run_as(:'nobody', format($q$UPDATE public.profiles SET name = 'Nobody Smith', language = 'en' WHERE user_id = %L RETURNING 'ok'$q$, :'nobody'));
SELECT pg_temp.check((SELECT name = 'Nobody Smith' AND language = 'en' FROM public.profiles WHERE user_id = :'nobody'),
                     'a user edits their own name and language');
UPDATE auth.users SET email = 'nobody2@x.test' WHERE id = :'nobody';
SELECT pg_temp.check((SELECT email = 'nobody2@x.test' FROM public.profiles WHERE user_id = :'nobody'), 'the profile email follows the sign-in email');

SELECT pg_temp.expect_error(:'credit', format('SELECT public.set_user_access(%L, %L)', :'nobody', 'admin'), '42501', 'only admins give access');
SELECT pg_temp.expect_error(:'nobody', format($q$INSERT INTO public.user_roles (user_id, role) VALUES (%L, 'admin')$q$, :'nobody'), '42501',
  'nobody grants themselves a role');
SELECT pg_temp.expect_error(:'d3', format($q$INSERT INTO public.dealer_users (user_id, dealer_id) VALUES (%L, '10000000-0000-0000-0000-0000000000a1')$q$, :'d3'), '42501',
  'a dealer cannot link themselves to another dealership');
SELECT pg_temp.expect_error(:'d1', $q$INSERT INTO public.dealers (name, code, contact_name, email, phone) VALUES ('x', 'X', 'x', 'x@x', '1')$q$, '42501',
  'a dealer cannot create dealerships');
SELECT pg_temp.expect_error(:'admin', format('SELECT public.set_user_access(%L, %L)', :'d3', 'dealer'), '22023', 'a dealer account needs a dealership');
SELECT pg_temp.expect_error(:'admin', format('SELECT public.set_user_access(%L, %L)', :'admin', 'credit_analyst'), '22023',
  'the last admin cannot remove their own admin access');
SELECT pg_temp.expect_error(:'admin', format('SELECT public.set_user_active(%L, false)', :'admin'), '22023', 'nobody deactivates themselves');

SELECT pg_temp.check(pg_temp.run_as(:'d1', format('SELECT public.has_role(%L, %L)::text', :'admin', 'admin')) = 'false'
                     AND pg_temp.run_as(:'d1', format('SELECT public.is_staff(%L)::text', :'credit')) = 'false'
                     AND pg_temp.run_as(:'credit', format('SELECT public.has_role(%L, %L)::text', :'admin', 'admin')) = 'true',
                     'a dealer cannot look up other people''s roles (staff can)');

-- deactivating a dealer cuts access at once, even with an old session
INSERT INTO auth.sessions (user_id) VALUES (:'d3');
SELECT pg_temp.run_as(:'d3', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "VW", "model": "Golf", "invoice_price": "20000"}, "financing": {"loan_amount": "18000", "apr": "5", "term_months": "60"}}'::jsonb)::text$q$);
SELECT pg_temp.check(pg_temp.run_as(:'d3', 'SELECT count(*)::text FROM public.deals') = '1', 'the new dealer sees their deal');
SELECT pg_temp.run_as(:'admin', format('SELECT public.set_user_active(%L, false)', :'d3'));
SELECT pg_temp.check(pg_temp.run_as(:'d3', 'SELECT count(*)::text FROM public.deals') = '0'
                     AND pg_temp.run_as(:'d3', 'SELECT count(*)::text FROM public.documents') = '0'
                     AND (SELECT banned_until > now() + interval '100 years' FROM auth.users WHERE id = :'d3')
                     AND (SELECT count(*) = 0 FROM auth.sessions WHERE user_id = :'d3')
                     AND (SELECT NOT is_active FROM public.profiles WHERE user_id = :'d3'),
                     'a deactivated dealer loses access immediately: signed out, banned, sees nothing');
SELECT pg_temp.expect_error(:'d3', $q$SELECT public.submit_deal('{"customer": {"first_name": "A", "last_name": "B"},
  "vehicle": {"make": "VW", "model": "Golf", "invoice_price": "20000"}}'::jsonb)$q$, '42501', 'a deactivated dealer cannot submit');
SELECT pg_temp.expect_error(:'admin', format('SELECT public.set_user_access(%L, %L, %L)', :'d3', 'dealer', '10000000-0000-0000-0000-0000000000c3'), '22023',
  'a deactivated account must be reactivated before getting access again');
SELECT pg_temp.run_as(:'admin', format('SELECT public.set_user_active(%L, true)', :'d3'));
SELECT pg_temp.check((SELECT banned_until IS NULL FROM auth.users WHERE id = :'d3') AND (SELECT is_active FROM public.profiles WHERE user_id = :'d3'),
                     'reactivation lifts the ban');
