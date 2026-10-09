// Screenshot QA for AutoFlow with a mocked Supabase backend (no real data, no network).
//   npm run build && npx vite preview --host 127.0.0.1 --port 4173 &
//   node scripts/screens/shoot.mjs <outdir> [staff|dealer|pending] [path ...]   (H=<px> sets viewport height, W=<px> width)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import * as F from './fixtures.mjs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');

const [outDir, persona = 'staff', ...paths] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const APP = 'http://127.0.0.1:4173';
// the project ref the built app talks to (from .env), so the mock intercepts the right host
const REF = (fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/VITE_SUPABASE_PROJECT_ID="?([a-z0-9]+)/) || [])[1];
const who = persona === 'dealer' ? F.DEALER_USER : persona === 'pending' ? { id: 'u-new', email: 'f&i@lavalmotors.test', name: 'Sophie Bergeron' } : F.STAFF;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: who.id, role: 'authenticated', exp: 4102444800 })}.sig`;
const session = {
  access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r',
  user: { id: who.id, aud: 'authenticated', role: 'authenticated', email: who.email, app_metadata: {}, user_metadata: { name: who.name }, created_at: '2026-01-01T00:00:00Z' },
};

const dealerId = persona === 'dealer' ? 'dl1' : null;
const visibleDeals = () => (dealerId ? F.deals.filter((d) => d.dealer_id === dealerId) : F.deals);

function filterRows(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const m = v.match(/^(eq|in|gte|neq)\.(.*)$/);
    if (!m) continue;
    const [, op, val] = m;
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    if (op === 'neq') out = out.filter((r) => String(r[k]) !== val);
    if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
    if (op === 'gte') out = out.filter((r) => String(r[k]) >= val);
  }
  return out;
}

function table(name, params) {
  switch (name) {
    case 'deals': {
      const sel = params.get('select') ?? '';
      const rows = visibleDeals().map((d) => {
        const r = { ...d };
        if (sel.includes('documents')) r.documents = F.documents.filter((x) => x.deal_id === d.id);
        if (sel.includes('deal_notes')) r.deal_notes = F.notesD1.filter((x) => x.deal_id === d.id);
        if (sel.includes('deal_timeline')) r.deal_timeline = F.timelineD1.filter((x) => x.deal_id === d.id);
        return r;
      });
      return filterRows(rows, params);
    }
    case 'dealers': return filterRows(dealerId ? F.dealers.filter((d) => d.id === dealerId) : F.dealers, params);
    case 'dealer_stats': return F.dealerStats;
    case 'user_roles': return filterRows(F.roles, params);
    case 'dealer_users': {
      const rows = F.dealerLinks.map((l) => ({ ...l, dealers: { name: F.dealers.find((d) => d.id === l.dealer_id)?.name } }));
      return filterRows(rows, params);
    }
    case 'profiles': return filterRows(F.profiles, params);
    case 'notifications': return filterRows(F.notifications(who.id), params);
    case 'document_requests': return filterRows(dealerId ? F.requests.filter((r) => r.dealer_id === dealerId) : F.requests, params);
    case 'app_settings': return [F.settings];
    case 'income_sources': return filterRows(F.incomeSourcesD1, params);
    case 'extracted_income_data': return filterRows(F.extractionsD1, params);
    case 'applicant_debts': return [];
    case 'deal_timeline': return F.activity;
    default: return [];
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) }, deviceScaleFactor: 1 });
await ctx.addInitScript(([key, s]) => { localStorage.setItem(key, s); }, [`sb-${REF}-auth-token`, JSON.stringify(session)]);
await ctx.route(new RegExp(`${REF}\\.supabase\\.co`), async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const accept = req.headers()['accept'] ?? '';
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname.startsWith('/auth/v1/user')) return json(session.user);
  if (url.pathname.startsWith('/rest/v1/rpc/deal_checklist')) {
    const body = JSON.parse(req.postData() ?? '{}');
    return json(body._deal_id === F.D1.id ? F.checklistD1 : F.checklistD1.map((c) => ({ ...c, satisfied: true, open_request_id: null })));
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(null);
  if (url.pathname.startsWith('/storage/')) return json({ signedURL: '/x' });
  if (url.pathname.startsWith('/functions/')) return json({ accepted: [] }, 202);
  const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)/);
  if (!m) return json({});
  if (req.method() !== 'GET' && req.method() !== 'HEAD') return json([], 201);
  const rows = table(m[1], url.searchParams);
  if (accept.includes('vnd.pgrst.object')) {
    return rows.length ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' }, 406);
  }
  return json(rows);
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|Failed to load resource/i.test(m.text())) errors.push(m.text()); });

for (const p of paths) {
  const [path, action] = p.split('#');
  await page.goto(APP + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (action) {
    for (const step of action.split('|')) {
      if (step.startsWith('click:')) await page.getByText(step.slice(6), { exact: false }).first().click();
      if (step.startsWith('tab:')) await page.getByRole('tab', { name: step.slice(4) }).click();
      if (step.startsWith('scroll:')) await page.mouse.wheel(0, Number(step.slice(7)));
      if (step.startsWith('wait:')) await page.waitForTimeout(Number(step.slice(5)));
    }
    await page.waitForTimeout(500);
  }
  const name = (path.replace(/\//g, '_').replace(/[?=&]/g, '-') || '_root') + (action ? `__${action.replace(/[^a-z0-9]+/gi, '-')}` : '');
  await page.screenshot({ path: `${outDir}/${persona}${name}.png`, fullPage: true });
  console.log('shot', persona, p, '→', page.url().replace(APP, ''));
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
await browser.close();
