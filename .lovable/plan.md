

## Add Applicant Debts (Garnishments and Other Obligations)

This feature adds tracking of garnishments, child support, and other debt obligations to the deal, displayed on both the income verification and credit review sections. This gives analysts a complete picture of the applicant's financial obligations.

---

### What Gets Built

1. **New `applicant_debts` database table** to store debts per deal/customer
2. **New `ApplicantDebtsCard` component** showing all debts with add/edit/delete
3. **Integration into the Deal Detail sidebar** (visible on both income and credit views)
4. **Updated PTI (Payment-to-Income) and risk calculations** to factor in existing debts (DTI - Debt-to-Income ratio)

---

### Database

A new `applicant_debts` table:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | auto-generated |
| deal_id | uuid (FK) | references deals |
| customer_id | uuid (FK) | references customers |
| debt_type | enum | `garnishment`, `child_support`, `auto_loan`, `student_loan`, `credit_card`, `mortgage`, `medical`, `other` |
| creditor_name | text | e.g. "IRS", "State of TX" |
| monthly_payment | numeric | required |
| total_balance | numeric | nullable |
| months_remaining | integer | nullable |
| is_court_ordered | boolean | default false (true for garnishments/child support) |
| notes | text | nullable |
| created_at | timestamptz | default now() |
| created_by | uuid | nullable, references auth.users |

RLS policies: authenticated users can view, insert, and update; admins can delete.

---

### New Component: `ApplicantDebtsCard`

A card component placed in the Deal Detail sidebar (between Income Verification and Credit Info cards) that:

- Queries `applicant_debts` for the deal
- Shows a summary: total monthly obligations, number of debts, any court-ordered items
- Lists each debt with type badge, creditor, monthly payment
- "Add Debt" button opens an inline form with fields for type, creditor, monthly payment, balance, court-ordered toggle
- Inline delete for individual debts

---

### Updated Calculations

**IncomeVerificationCard**: The PTI section will show an enhanced "DTI" (Debt-to-Income) ratio that includes:
- Proposed car payment + total existing monthly debts / total income

**DealSummaryCard**: The risk computation will factor in total debt obligations:
- DTI > 45% adds risk score + concern
- Any garnishments add risk score + concern
- Court-ordered debts flagged as concern

**CreditQueue stats**: Add a new stat showing average DTI across queued deals.

---

### Technical Details

**Files to create:**
- `src/components/deals/ApplicantDebtsCard.tsx` -- main card with list, add form, and summary

**Files to modify:**
- `src/pages/DealDetail.tsx` -- add `ApplicantDebtsCard` to the sidebar
- `src/components/deals/IncomeVerificationCard.tsx` -- show combined DTI (car payment + debts / income)
- `src/components/deals/DealSummaryCard.tsx` -- factor debts into risk score
- `src/pages/CreditQueue.tsx` -- optionally surface debt flags on deal cards
- `src/types/deal.ts` -- add debt type definitions

**Database migration:**
- Create `applicant_debts` table with RLS policies
- Create `debt_type` enum

