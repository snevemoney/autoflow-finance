# AutoFlow — automations, setup and operations

AutoFlow takes a deal from the dealer's submission to a funded loan. People make the
lending decisions; AutoFlow does the sorting, reading, chasing and routing in between.

## The flow

| Stage | Moves on when | Who acts |
|---|---|---|
| New Submission | Immediately | Dealer submits in the portal (or staff enter it under **New Deal**) |
| Document Review | Every required document is in and has been read | AutoFlow sorts uploads and requests what's missing from the dealer |
| Credit Review | An analyst records a credit decision | Credit analyst (approve / conditional / decline) |
| Income Verification | Every income source is verified | Income verifier. Pay documents are pre-filled into the calculator |
| Funding Review | Every funding checklist item is ticked and **Approve for funding** is pressed | Funding manager |
| Approved | **Mark funded** is pressed | Funding manager |
| Funded | — | — |

If income was already verified when credit is approved, the deal skips straight to Funding Review.
A declined credit decision moves the deal to Declined and tells the dealer.
Admins can still move a deal by hand (**Move to…** on the deal, or drag on the Pipeline);
each manual move is logged on the timeline.

### The four automations (Settings → Automations, on/off per switch)

1. **Auto-sort documents.** Each upload is sorted into its document type. The file name decides
   when it's obvious (English and French names, e.g. `talon de paie`, `relevé`, `permis`).
   Otherwise one AI read decides. Staff can change the type at any time; a manual type is never overwritten.
2. **Auto-fill income.** Pay stubs, bank statements and income letters are read once.
   The result fills the income calculator: monthly income from the pay frequency, YTD monthly,
   and "lower of". It also adds review flags (employer mismatch, document older than 60 days,
   MI vs YTD gap over 20%, low confidence). A verifier still confirms the figure.
3. **Flag gaps & request from dealer.** The deal checklist is the required documents
   (Settings), plus proof of income for the applicant's income type, plus trade-in documents
   when there is a trade-in. Anything missing becomes a request in the dealer's portal, and the
   dealer is notified. A request closes itself when a matching document arrives.
4. **Auto-route queues.** Deals move to the next department as soon as the rule in the table
   above is met. The department and the dealer are notified.

### Cost control

- **File names first.** Most documents are sorted from the file name with no AI call.
- **One read per document.** Income documents are sorted and read in the same call.
- **Escalation only when unsure.** A document is re-read once with the escalation chain only
  when the first pass was unsure: low confidence on the type, or an income document whose
  figures came back missing or low-confidence.
- **Free PDF text.** PDFs are converted to text by OpenRouter's free parser. The first page is
  also sent as an image, rendered in the browser at upload, so scanned PDFs can still be read.

## Setup (Supabase + Vercel)

**Where it runs:** Supabase project `bygxsgeiauvcdqyikhie` (region `ca-central-1`, Montréal), which holds the
database, file storage, sign-in and the three edge functions. The site is on Vercel and deploys
from `main`. Nothing runs on Lovable.

### 1. Database schema

Every schema change is a file in `supabase/migrations`, applied in file order:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

`20261009050100_autoflow_end_to_end.sql`:
- turns every existing account into an **admin**, so nobody is locked out;
- makes the very first sign-up on a fresh database an admin;
- leaves later sign-ups waiting on the **Almost there** screen until an admin gives them a role.

Change the schema with a new migration file, never by editing an applied one.

### 2. Deploy the edge functions

```bash
supabase functions deploy process-document extract-income-data verify-employer
```

`supabase/config.toml` turns off the gateway JWT check for these three, because each one
checks the caller itself (staff, or the dealer who owns the deal). Redeploy after changing
anything in `supabase/functions`.

### 3. AI settings

Each setting is read from the edge-function secrets first (Supabase → Edge Functions →
Secrets), then from **Supabase Vault**, which is encrypted at rest. Only the edge functions
can read the Vault copy, through `public.get_ai_settings()`. Use whichever is easier:

```sql
select vault.create_secret('<value>', 'OPENROUTER_API_KEY');   -- add
select vault.update_secret(id, '<value>') from vault.secrets where name = 'OPENROUTER_API_KEY';  -- change
```

| Setting | Value |
|---|---|
| `OPENROUTER_API_KEY` | **Required.** Your OpenRouter key. |
| `AI_MODELS` | Optional. A comma-separated chain, tried in order (free models first). OpenRouter takes 3 models per request, so a longer chain is sent 3 at a time. |
| `AI_ESCALATION_MODELS` | Optional. The chain for re-reading documents the first pass was unsure about. |
| `AI_DATA_COLLECTION` | `deny` keeps live borrower files away from providers that store or train on prompts. Free endpoints are usually excluded by this. |
| `AI_ZDR` | `true` limits calls to zero-data-retention endpoints. |
| `APP_URL` | Optional. Your site URL, sent to OpenRouter for attribution. |

A Vault change takes effect within five minutes. OpenRouter's free (`:free`) models allow
20 requests a minute and 50 a day. The daily limit rises to 1,000 once at least $10 of credits
has been bought. When the free models are rate-limited, the chain moves on to the paid models
after them.

### 4. Site (Vercel)

Import the GitHub repo in Vercel. `vercel.json` sets the build and single-page-app routing,
and the public Supabase URL and key come from `.env`. Every push to `main` then deploys.

In Supabase → Authentication → URL Configuration, set **Site URL** to the Vercel address and
add it under **Redirect URLs**, so sign-up and password emails link back to the site.

### 5. Users and dealers

- **Staff:** an admin opens **Users** and gives each person a role: Credit Analyst,
  Income Verifier, Funding Manager or Admin.
- **Dealers:** create the dealership under **Dealers**. The dealer signs up from the link in
  **Users → Add User**. The admin then sets their role to **Dealer** and picks their dealership.
  From then on they only see their own dealership's deals, documents, requests and the notes
  marked "Visible to dealer".

### 6. Storage

Documents live in the private `documents` bucket under `<deal_id>/…`. Access follows the deal:
staff see everything, and a dealer sees only their own dealership's files. The browser opens
files through short-lived signed links.

## Tests

```bash
npm test                # unit tests (dashboard metrics)
npm run test:db         # every migration plus the deal-flow, access, AI-settings and function-access tests on a local Postgres 16
npm run test:functions  # Deno tests for sorting, income maths and the AI request (needs deno)
```

`scripts/gen-types.py` regenerates `src/integrations/supabase/types.ts` from the test database
after a schema change.
