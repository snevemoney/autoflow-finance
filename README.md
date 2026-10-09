<!-- HYGIENE: paste at top of README.md -->
# AutoFlow Finance

> **Status:** Side WIP  
> **Lane:** Side WIP  
> **Role:** Auto-loan deal desk with income OCR.  
> **This is NOT:** Client Engine or LightningFlow  
> **Canonical home:** GitHub (side project)

---

AutoFlow takes an auto-loan deal from the dealer's submission to a funded loan. Dealers
submit deals and documents in their own portal; AutoFlow sorts the documents, reads pay
stubs into the income calculator, asks the dealer for anything missing and moves each deal
to the next department as soon as its step is done. Credit, income and funding decisions
stay with people.

**Live:** https://autoflow-kappa-two.vercel.app

**How the automations work, setup and tests:** [AUTOMATIONS.md](AUTOMATIONS.md)

## Stack

- React + Vite + TypeScript, Tailwind and shadcn/ui
- Supabase: Postgres (routing rules, row-level security), Auth, Storage, Edge Functions
- AI through OpenRouter (free models first, paid ones only as a fallback)
- Hosted on Vercel; the database, files and functions live in your own Supabase project

## Run it locally

```bash
npm install
npm run dev          # http://localhost:8080, uses the Supabase project in .env
```

`.env` holds the project URL and publishable key. Both are public by design: what each user
can see is enforced by row-level security in the database, not by hiding these values.

## Deploy

- **Site:** every push to `main` deploys on Vercel (`vercel.json` sets up the single-page app).
- **Database:** new files in `supabase/migrations` are applied with `supabase db push`.
- **Edge functions:** `supabase functions deploy process-document extract-income-data verify-employer`.

## Checks

```bash
npm test               # unit tests
npm run test:db        # every migration plus the deal-flow and access tests on a local Postgres
npm run test:functions # edge-function tests (needs deno)
npm run build
```
