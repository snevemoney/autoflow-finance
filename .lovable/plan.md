

## Add Housing & Financial Details to Credit Queue Cards

Enrich the Credit Queue deal cards with more financial context so analysts can quickly assess an applicant's full picture -- rent/housing costs, employment tenure, monthly payment vs income ratio (PTI), and a debt breakdown by type.

---

### Changes Overview

**1. Add `rent` as a new debt type (database migration)**

- Add `'rent'` to the existing `debt_type` enum so analysts can record housing costs alongside other obligations
- This lets rent appear naturally in the applicant debts system and on the card

**2. Expand `DebtSummary` with richer data (DealCard.tsx)**

- Add fields: `rentPayment`, `debtBreakdown` (map of type to total), `debtCount`
- Show a compact financial snapshot section on each card:
  - Monthly payment + PTI ratio (payment-to-income %)
  - Rent/housing cost (if recorded)
  - Employment tenure (years employed)
  - Number of debt obligations with icons for key types (auto, credit card, etc.)

**3. Enrich CreditQueue aggregation (CreditQueue.tsx)**

- When fetching `applicant_debts`, also extract rent amounts and build a per-type breakdown
- Pass the enriched summary to each DealCard

**4. Update ApplicantDebtsCard (ApplicantDebtsCard.tsx)**

- Add `'rent'` to the `DEBT_TYPE_LABELS` and `DEBT_TYPE_COLORS` maps so it can be selected in the add-debt form

---

### What the card will show (new section between credit score and flags)

```text
+------------------------------------------+
| AF-2026-00001          Credit Review      |
| John Doe                                  |
| 2024 Toyota Camry                         |
| $28,500 @ 6.9% / 72mo                    |
| 720 (prime)                               |
|                                           |
| Monthly Payment  $485    PTI: 12%         |
| Rent/Housing     $1,200                   |
| Employment       3.5 yrs at Acme Corp    |
| Debts            4 obligations  $780/mo   |
|   [Auto] [Credit Card] [Garnishment]      |
| DTI: 52%                                  |
|                                           |
| [!] High LTV                              |
| 3 docs  Premier   2 hours ago             |
+------------------------------------------+
```

---

### Technical Details

**Files to modify:**

- `supabase/migrations/` -- new migration to add `'rent'` to `debt_type` enum
- `src/components/deals/DealCard.tsx` -- expand `DebtSummary` interface, add financial snapshot section with PTI, rent, employment, and debt breakdown
- `src/pages/CreditQueue.tsx` -- enrich debt aggregation to include rent amount, debt count, and per-type breakdown; also fetch employment data from the deal's customer object
- `src/components/deals/ApplicantDebtsCard.tsx` -- add `rent` to `DEBT_TYPE_LABELS` and `DEBT_TYPE_COLORS`

**Updated DebtSummary interface:**

```typescript
export interface DebtSummary {
  totalMonthlyDebts: number;
  hasGarnishments: boolean;
  dti: number | null;
  rentPayment: number;
  debtCount: number;
  debtTypes: string[]; // unique types present
}
```

**New card section rendering:**

- PTI = `(monthlyPayment / monthlyIncome) * 100` -- shown in green/yellow/red based on thresholds
- Rent line only shown if rent debt exists (> 0)
- Employment tenure and employer name pulled from `deal.customer.employmentInfo`
- Debt type pills rendered as small colored badges (reusing existing color scheme from ApplicantDebtsCard)

