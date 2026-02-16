

## Add Debt Flags to Credit Queue

Surface debt-related risk indicators (high DTI, active garnishments) directly on the CreditQueue page so analysts can prioritize deals at a glance.

---

### Changes Overview

**1. Fetch applicant debts for all queued deals (CreditQueue.tsx)**

- Query the `applicant_debts` table for all deal IDs in the credit queue using a single batch query
- Aggregate per-deal: total monthly debt obligations, garnishment count, court-ordered count
- Compute DTI per deal: `(monthlyPayment + totalDebts) / monthlyIncome * 100`

**2. Pass debt summary to DealCard (DealCard.tsx)**

- Add an optional `debtSummary` prop: `{ totalMonthlyDebts: number; hasGarnishments: boolean; dti: number | null }`
- Render new badges between the credit score and flags sections:
  - **High DTI badge** (red) when DTI > 45%: shows "DTI: XX%"
  - **Garnishment badge** (orange) with gavel icon: shows "Garnishment"
- These appear as small pills similar to the existing flag badges

**3. Add queue-level stats (CreditQueue.tsx)**

- Replace the 4-column stat grid with a 5-column grid (or keep 4 and swap one)
- Add a new stat card: "High DTI Deals" showing count of deals with DTI > 45%
- Add sort option: "Highest DTI" to let analysts prioritize risky deals

---

### Technical Details

**Files to modify:**

- `src/pages/CreditQueue.tsx` -- fetch debts, compute DTI per deal, pass to DealCard, add stats and sort option
- `src/components/deals/DealCard.tsx` -- accept optional `debtSummary` prop, render DTI and garnishment badges

**Data flow:**

1. CreditQueue fetches deals (existing mock data) and debts from Supabase
2. Groups debts by `deal_id` into a `Map<string, DebtSummary>`
3. For each deal, computes DTI using `deal.customer.employmentInfo.monthlyIncome` and `deal.financingTerms.monthlyPayment`
4. Passes the summary object to each `DealCard`

**DealCard badge rendering (new section after credit score):**

```
{debtSummary?.dti != null && debtSummary.dti > 45 && (
  <badge variant="destructive">DTI: {dti}%</badge>
)}
{debtSummary?.hasGarnishments && (
  <badge variant="warning"><Gavel /> Garnishment</badge>
)}
```

