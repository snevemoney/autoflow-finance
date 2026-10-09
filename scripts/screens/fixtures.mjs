// Fictional demo data for screenshot QA of the AutoFlow UI (mocked Supabase backend).
const iso = (daysAgo, h = 10) => new Date(Date.UTC(2026, 9, 9 - daysAgo, h, 15)).toISOString();

export const STAFF = { id: 'u-admin', email: 'marie.lavoie@autoflow.test', name: 'Marie Lavoie' };
export const DEALER_USER = { id: 'u-dealer', email: 'ventes@rivesudautos.test', name: 'Julien Côté' };

export const dealers = [
  { id: 'dl1', name: 'Rive-Sud Autos', code: 'RSA', contact_name: 'Julien Côté', email: 'ventes@rivesudautos.test', phone: '450-555-0101', street: '1200 boul. Taschereau', city: 'Longueuil', state: 'QC', zip: 'J4K 2T4', status: 'active', created_at: iso(200), updated_at: iso(10) },
  { id: 'dl2', name: 'Laval Motors', code: 'LVM', contact_name: 'Sophie Bergeron', email: 'f&i@lavalmotors.test', phone: '450-555-0202', street: '3000 boul. Chomedey', city: 'Laval', state: 'QC', zip: 'H7P 5H4', status: 'active', created_at: iso(180), updated_at: iso(10) },
  { id: 'dl3', name: 'Auto Boucherville', code: 'ABV', contact_name: 'Marc Gagnon', email: 'marc@autoboucherville.test', phone: '450-555-0303', street: '45 ch. du Tremblay', city: 'Boucherville', state: 'QC', zip: 'J4B 6Z5', status: 'active', created_at: iso(120), updated_at: iso(10) },
];

let seq = 0;
function deal({ status, dealer = 'dl1', first, last, make, model, year = 2023, price, loan, apr = 8.99, term = 72, score = null, tier = null,
  employer = null, income = null, daysAgo = 2, inStage = 1, extra = {} }) {
  seq += 1;
  const id = `deal-${seq}`;
  const r = apr / 1200;
  const pay = Math.round((loan * r / (1 - Math.pow(1 + r, -term))) * 100) / 100;
  return {
    id, deal_number: `AF-2026-${String(140 + seq).padStart(5, '0')}`, status, priority: 'normal',
    customer_id: `c-${seq}`, vehicle_id: `v-${seq}`, dealer_id: dealer,
    loan_amount: loan, down_payment: price - loan, apr, term_months: term, monthly_payment: pay,
    total_interest: Math.round(pay * term - loan), total_cost: Math.round(pay * term + price - loan),
    credit_score: score, credit_bureau: score ? 'equifax' : null, credit_pulled_at: score ? iso(1) : null, credit_tier: tier,
    ltv: Math.round(loan / price * 1000) / 10, flags: [], assigned_to: null, assigned_department: null,
    decision_notes: null, decision_by: null, decision_at: null, funded_at: null, funded_amount: null,
    credit_decision: ['income_verification', 'funding_review', 'approved', 'funded'].includes(status) ? 'approved' : 'pending',
    credit_decision_at: null, credit_decision_notes: null, income_verified_at: null, funding_checklist: {}, funding_approved_at: null,
    submitted_by_dealer: true, status_changed_at: iso(inStage), created_at: iso(daysAgo), updated_at: iso(inStage),
    trade_in_vin: null,
    customers: { id: `c-${seq}`, first_name: first, last_name: last, email: `${first.toLowerCase()}.${last.toLowerCase()}@courriel.test`, phone: '514-555-0' + (100 + seq),
      street: null, city: 'Longueuil', state: 'QC', zip: null, employer, job_title: employer ? 'Technicien' : null, monthly_income: income, years_employed: employer ? 4 : null },
    vehicles: { id: `v-${seq}`, year, make, model, trim: null, vin: `2T3P1RFV${String(100000000 + seq * 7919).slice(0, 9)}`, mileage: 24000 + seq * 3100, color: 'Gris', condition: 'used', invoice_price: price, msrp: null },
    dealers: dealers.find((d) => d.id === dealer),
    ...extra,
  };
}

export const deals = [
  deal({ status: 'document_review', first: 'Émilie', last: 'Tremblay', make: 'Toyota', model: 'RAV4 LE', price: 32995, loan: 30500, employer: 'Hydro-Québec', income: 5200, daysAgo: 0, inStage: 0 }),
  deal({ status: 'document_review', dealer: 'dl2', first: 'Karim', last: 'Benali', make: 'Honda', model: 'Civic EX', price: 26450, loan: 24000, employer: 'CGI', income: 4800, daysAgo: 1, inStage: 1 }),
  deal({ status: 'credit_review', first: 'Nathalie', last: 'Roy', make: 'Mazda', model: 'CX-5 GS', price: 31990, loan: 28900, employer: 'Desjardins', income: 6100, daysAgo: 3, inStage: 0 }),
  deal({ status: 'credit_review', dealer: 'dl3', first: 'Olivier', last: 'Pelletier', make: 'Hyundai', model: 'Tucson', price: 29900, loan: 29000, employer: 'Bombardier', income: 5600, daysAgo: 6, inStage: 4 }),
  deal({ status: 'income_verification', dealer: 'dl2', first: 'Amélie', last: 'Fortin', make: 'Kia', model: 'Seltos', price: 27500, loan: 23500, score: 702, tier: 'near_prime', employer: 'Metro Inc.', income: 4300, daysAgo: 5, inStage: 1 }),
  deal({ status: 'funding_review', first: 'Jean-François', last: 'Lévesque', make: 'Ford', model: 'Escape SE', price: 30995, loan: 27995, score: 731, tier: 'prime', employer: 'Ville de Longueuil', income: 6400, daysAgo: 7, inStage: 1,
    extra: { funding_checklist: { contract_signed: true, id_confirmed: true, insurance_confirmed: true } } }),
  deal({ status: 'approved', dealer: 'dl3', first: 'Sarah', last: 'Nguyen', make: 'Subaru', model: 'Crosstrek', price: 31500, loan: 26000, score: 748, tier: 'prime', employer: 'Pratt & Whitney', income: 7000, daysAgo: 9, inStage: 0 }),
  deal({ status: 'funded', first: 'Mathieu', last: 'Gauthier', make: 'Toyota', model: 'Corolla', price: 24990, loan: 21990, score: 715, tier: 'prime', employer: 'STM', income: 5100, daysAgo: 12, inStage: 2,
    extra: { funded_at: iso(2), funded_amount: 21990 } }),
  deal({ status: 'funded', dealer: 'dl2', first: 'Isabelle', last: 'Morin', make: 'Honda', model: 'CR-V', price: 36900, loan: 33000, score: 760, tier: 'prime', employer: 'CHUM', income: 7400, daysAgo: 20, inStage: 6,
    extra: { funded_at: iso(6), funded_amount: 33000 } }),
  deal({ status: 'declined', dealer: 'dl3', first: 'Kevin', last: 'Simard', make: 'Dodge', model: 'Charger', price: 38900, loan: 38900, score: 541, tier: 'deep_subprime', employer: 'Self', income: 3900, daysAgo: 8, inStage: 3,
    extra: { decision_notes: 'Insufficient verifiable income' } }),
];

export const D1 = deals[0];
export const DFUND = deals[5];

export const documents = [
  { id: 'doc1', deal_id: D1.id, name: 'Demande de crédit signée.pdf', type: 'credit_application', type_source: 'rule', processing_status: 'done', classification_confidence: 'high', file_url: `${D1.id}/a.pdf`, storage_path: `${D1.id}/a.pdf`, preview_path: null, mime_type: 'application/pdf', file_size: 182000, uploaded_by: DEALER_USER.id, status: 'pending', notes: null, created_at: iso(0, 9), ai_model: null, processing_error: null },
  { id: 'doc2', deal_id: D1.id, name: 'IMG_4402.jpg', type: 'id_verification', type_source: 'auto', processing_status: 'done', classification_confidence: 'high', file_url: `${D1.id}/b.jpg`, storage_path: `${D1.id}/b.jpg`, preview_path: null, mime_type: 'image/jpeg', file_size: 812000, uploaded_by: DEALER_USER.id, status: 'pending', notes: null, created_at: iso(0, 9), ai_model: 'google/gemma-4-31b-it:free', processing_error: null },
  { id: 'doc3', deal_id: D1.id, name: 'scan0003.pdf', type: 'pay_stub', type_source: 'auto', processing_status: 'done', classification_confidence: 'high', file_url: `${D1.id}/c.pdf`, storage_path: `${D1.id}/c.pdf`, preview_path: null, mime_type: 'application/pdf', file_size: 240000, uploaded_by: DEALER_USER.id, status: 'pending', notes: null, created_at: iso(0, 9), ai_model: 'google/gemma-4-31b-it:free', processing_error: null },
  { id: 'doc4', deal_id: D1.id, name: 'Facture RAV4.pdf', type: 'vehicle_invoice', type_source: 'rule', processing_status: 'done', classification_confidence: 'high', file_url: `${D1.id}/d.pdf`, storage_path: `${D1.id}/d.pdf`, preview_path: null, mime_type: 'application/pdf', file_size: 150000, uploaded_by: DEALER_USER.id, status: 'pending', notes: null, created_at: iso(0, 9), ai_model: null, processing_error: null },
  { id: 'doc5', deal_id: D1.id, name: 'releve-aout.pdf', type: 'other', type_source: 'auto', processing_status: 'processing', classification_confidence: null, file_url: `${D1.id}/e.pdf`, storage_path: `${D1.id}/e.pdf`, preview_path: null, mime_type: 'application/pdf', file_size: 301000, uploaded_by: DEALER_USER.id, status: 'pending', notes: null, created_at: iso(0, 10), ai_model: null, processing_error: null },
];

export const requests = [
  { id: 'req1', deal_id: D1.id, dealer_id: 'dl1', doc_type: 'insurance', label: 'Insurance Proof', message: 'Missing from submission', status: 'open', source: 'automation', requested_by: null, created_at: iso(0, 9), fulfilled_at: null, fulfilled_document_id: null },
  { id: 'req2', deal_id: deals[1].id, dealer_id: 'dl2', doc_type: 'pay_stub', label: 'Pay Stub', message: 'Missing from submission', status: 'open', source: 'automation', requested_by: null, created_at: iso(1, 14), fulfilled_at: null, fulfilled_document_id: null },
];

export const checklistD1 = [
  { item_key: 'credit_application', label: 'Credit Application', doc_types: ['credit_application'], satisfied: true, document_count: 1, open_request_id: null },
  { item_key: 'id_verification', label: 'ID Verification', doc_types: ['id_verification'], satisfied: true, document_count: 1, open_request_id: null },
  { item_key: 'income_employment', label: 'Pay Stub', doc_types: ['pay_stub', 'income_verification'], satisfied: true, document_count: 1, open_request_id: null },
  { item_key: 'vehicle_invoice', label: 'Vehicle Invoice', doc_types: ['vehicle_invoice'], satisfied: true, document_count: 1, open_request_id: null },
  { item_key: 'insurance', label: 'Insurance Proof', doc_types: ['insurance'], satisfied: false, document_count: 0, open_request_id: 'req1' },
];

export const incomeSourcesD1 = [{
  id: 'is1', deal_id: D1.id, customer_id: D1.customer_id, source_type: 'salaried', employer_name: 'Hydro-Québec', job_title: 'Technicien',
  stated_monthly_income: 5200, calculated_monthly_income: 4987, pay_frequency: 'biweekly', contract_months: null, hours_per_week: null, hourly_rate: null,
  is_primary: true, verification_status: 'unverified', flag_reasons: [], verified_at: null, verified_by: null, created_at: iso(0, 9), updated_at: iso(0, 10),
  calc_method: 'lower_of', tip_percentage: null, ytd_gross: 44880, ytd_months: 9, manual_override_amount: null, manual_override_reason: null,
  missed_days_flag: false, additional_docs_requested: [], vehicle_for_work: false, benefit_cap_applied: false,
  gross_per_period: 2298.5, auto_filled_at: iso(0, 10), auto_fill_document_id: 'doc3',
}];

export const extractionsD1 = [{
  id: 'ex1', deal_id: D1.id, document_id: 'doc3', income_source_id: 'is1', gross_pay: 2298.5, net_pay: 1702.33, pay_frequency: 'biweekly',
  pay_date: '2026-09-25', employer_name_on_doc: 'HYDRO-QUÉBEC', ytd_gross: 44880, raw_extracted_text: 'Hydro-Québec biweekly pay stub', confidence: 'high',
  extracted_at: iso(0, 10), created_at: iso(0, 10),
}];

export const timelineD1 = [
  { id: 't1', deal_id: D1.id, type: 'status_change', description: 'Submitted by Rive-Sud Autos', created_by: DEALER_USER.id, metadata: {}, created_at: iso(0, 9) },
  { id: 't2', deal_id: D1.id, type: 'status_change', description: 'Auto-routed to Document Review — Submission received', created_by: null, metadata: { automation: 'auto_route' }, created_at: iso(0, 9) },
  { id: 't3', deal_id: D1.id, type: 'automation', description: 'Auto-sorted "IMG_4402.jpg" as ID Verification', created_by: null, metadata: { automation: 'auto_sort' }, created_at: iso(0, 9) },
  { id: 't4', deal_id: D1.id, type: 'automation', description: 'Auto-sorted "scan0003.pdf" as Pay Stub', created_by: null, metadata: { automation: 'auto_sort' }, created_at: iso(0, 9) },
  { id: 't5', deal_id: D1.id, type: 'automation', description: 'Income auto-filled from "scan0003.pdf": Lower of MI/YTD → $4,987/mo', created_by: null, metadata: { automation: 'auto_fill_income' }, created_at: iso(0, 10) },
  { id: 't6', deal_id: D1.id, type: 'document_request', description: 'Requested from dealer automatically: Insurance Proof', created_by: null, metadata: { source: 'automation' }, created_at: iso(0, 10) },
];

export const notesD1 = [
  { id: 'n1', deal_id: D1.id, content: 'Customer is switching insurers this week — we\'ll send the new pink slip as soon as we have it.', created_by: DEALER_USER.id, is_internal: false, created_at: iso(0, 11) },
];

export const notifications = (uid) => uid === STAFF.id ? [
  { id: 'no1', user_id: uid, title: `Deal ${deals[2].deal_number} is in your queue`, message: 'All required documents received. Routed to Credit Review.', type: 'info', read: false, deal_id: deals[2].id, created_at: iso(0, 11) },
  { id: 'no2', user_id: uid, title: 'New deal from Rive-Sud Autos', message: 'Émilie Tremblay', type: 'info', read: false, deal_id: D1.id, created_at: iso(0, 9) },
  { id: 'no3', user_id: uid, title: 'Dealer sent Pay Stub — deal AF-2026-00148', message: 'The requested document was received.', type: 'success', read: true, deal_id: deals[7].id, created_at: iso(2, 15) },
] : [
  { id: 'no4', user_id: uid, title: `Document needed — deal ${D1.deal_number}`, message: 'Insurance Proof: Missing from submission', type: 'warning', read: false, deal_id: D1.id, created_at: iso(0, 10) },
  { id: 'no5', user_id: uid, title: `Deal ${deals[7].deal_number}: Funded`, message: 'Loan funded.', type: 'success', read: true, deal_id: deals[7].id, created_at: iso(2, 16) },
];

export const settings = {
  id: true,
  automations: { auto_sort: true, auto_fill_income: true, auto_request_docs: true, auto_route: true },
  required_documents: ['credit_application', 'id_verification', 'vehicle_invoice', 'insurance'],
  funding_checklist_items: [
    { key: 'contract_signed', label: 'Retail contract signed by customer' },
    { key: 'id_confirmed', label: 'Customer identity confirmed' },
    { key: 'insurance_confirmed', label: 'Insurance in force, lender named as loss payee' },
    { key: 'invoice_matches', label: 'Dealer invoice matches deal structure' },
    { key: 'lien_registered', label: 'Lien registered' },
    { key: 'down_payment_received', label: 'Down payment received' },
  ],
  preferences: { stale_days: '3' }, updated_at: iso(3), updated_by: null,
};

export const dealerStats = dealers.map((d) => {
  const mine = deals.filter((x) => x.dealer_id === d.id);
  const decided = mine.filter((x) => ['funded', 'approved', 'declined'].includes(x.status));
  return {
    dealer_id: d.id, total_deals: mine.length, active_deals: mine.filter((x) => !['funded', 'declined', 'incomplete'].includes(x.status)).length,
    funded_deals: mine.filter((x) => x.status === 'funded').length, declined_deals: mine.filter((x) => x.status === 'declined').length,
    approval_rate: decided.length ? Math.round(100 * decided.filter((x) => x.status !== 'declined').length / decided.length) : null,
  };
});

export const profiles = [
  { id: 'p1', user_id: STAFF.id, name: STAFF.name, email: STAFF.email, department: 'admin', avatar_url: null, is_active: true, last_login: iso(0), created_at: iso(200), updated_at: iso(0) },
  { id: 'p2', user_id: 'u-credit', name: 'Alexandre Dubois', email: 'a.dubois@autoflow.test', department: 'credit', avatar_url: null, is_active: true, last_login: iso(0), created_at: iso(150), updated_at: iso(0) },
  { id: 'p3', user_id: 'u-income', name: 'Chloé Martin', email: 'c.martin@autoflow.test', department: 'income', avatar_url: null, is_active: true, last_login: iso(1), created_at: iso(140), updated_at: iso(1) },
  { id: 'p4', user_id: 'u-funding', name: 'Patrick Ouellet', email: 'p.ouellet@autoflow.test', department: 'funding', avatar_url: null, is_active: true, last_login: iso(1), created_at: iso(130), updated_at: iso(1) },
  { id: 'p5', user_id: DEALER_USER.id, name: DEALER_USER.name, email: DEALER_USER.email, department: null, avatar_url: null, is_active: true, last_login: iso(0), created_at: iso(60), updated_at: iso(0) },
  { id: 'p6', user_id: 'u-new', name: 'Sophie Bergeron', email: 'f&i@lavalmotors.test', department: null, avatar_url: null, is_active: true, last_login: null, created_at: iso(0), updated_at: iso(0) },
];
export const roles = [
  { user_id: STAFF.id, role: 'admin' }, { user_id: 'u-credit', role: 'credit_analyst' }, { user_id: 'u-income', role: 'income_verifier' },
  { user_id: 'u-funding', role: 'funding_manager' }, { user_id: DEALER_USER.id, role: 'dealer' }, { user_id: 'u-new', role: 'dealer' },
];
export const dealerLinks = [{ user_id: DEALER_USER.id, dealer_id: 'dl1', created_at: iso(60) }];

export const activity = [
  ...Array.from({ length: 23 }, () => ({ type: 'automation', metadata: { automation: 'auto_sort' } })),
  ...Array.from({ length: 7 }, () => ({ type: 'automation', metadata: { automation: 'auto_fill_income' } })),
  ...Array.from({ length: 4 }, () => ({ type: 'document_request', metadata: { source: 'automation' } })),
  ...Array.from({ length: 15 }, () => ({ type: 'status_change', metadata: { automation: 'auto_route' } })),
];
