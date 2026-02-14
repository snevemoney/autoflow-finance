

# Multi-Source Income Verification System

## Overview

Replace the single-income model with a system that tracks multiple income sources per applicant -- each with its own type, calculation formula, document requirements, and fraud flags. This ensures a salaried job's income isn't mixed with a seasonal gig or a contractor's 1099 work, and gives analysts clear visibility into how each source was verified.

## Income Types and Calculation Logic

| Type | How Monthly Income Is Calculated | Required Documents |
|---|---|---|
| **Salaried (W-2)** | Gross pay from stub, or annual salary / 12 | 2 recent pay stubs, W-2 |
| **Part-Time / Hourly** | Average hours x rate across submitted stubs | 2-3 pay stubs |
| **Self-Employed / Business Owner** | Net business income from tax returns / 12 | 2 years tax returns, P&L statement |
| **Contractor (1099)** | Average of 1099 amounts / 12, or bank deposit average | 1099s, 6 months bank statements |
| **Seasonal** | Annual earnings from tax return / 12 (annualized) | Tax returns, employment letter |
| **Education / School Employee** | Contract amount / contract months (e.g., 10-month pay spread over 12) | Employment contract, pay stubs |

## Database Changes

### New enum: `income_source_type`
Values: `salaried`, `part_time`, `self_employed`, `contractor`, `seasonal`, `education`

### New enum: `income_verification_status`
Values: `unverified`, `verified`, `flagged`, `insufficient_docs`

### New table: `income_sources`

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| deal_id | uuid | Links to deals table |
| customer_id | uuid | Links to customers table |
| source_type | income_source_type | Which calculation formula to use |
| employer_name | text | Employer or business name |
| job_title | text | Nullable |
| stated_monthly_income | numeric | What applicant claims |
| calculated_monthly_income | numeric | What documents support (nullable until verified) |
| pay_frequency | text | weekly, biweekly, semimonthly, monthly, annual, contract |
| contract_months | integer | For education workers (e.g., 10) |
| hours_per_week | numeric | For part-time/hourly |
| hourly_rate | numeric | For part-time/hourly |
| is_primary | boolean | Default true for first source |
| verification_status | income_verification_status | Default unverified |
| flag_reasons | text[] | Array of fraud flag strings |
| verified_at | timestamptz | Nullable |
| verified_by | uuid | Nullable |
| created_at, updated_at | timestamptz | Standard timestamps |

RLS: Authenticated users can SELECT, INSERT, UPDATE. Admins can DELETE.

## Fraud Detection Flags (Per Source)

These checks run automatically based on the data entered and any OCR extractions:

- **Income variance > 15%**: Stated monthly income differs from calculated by more than 15%
- **Round number suspicion**: Stated income is a suspiciously round number (e.g., exactly $5,000)
- **Employer name mismatch**: Employer on uploaded document doesn't match what was entered
- **Employment duration vs. docs**: Claims years of employment but documents show recent hire
- **Multiple full-time overlap**: Two sources both marked as full-time salaried
- **Missing documents**: Required documents for the income type haven't been uploaded
- **Seasonal income inflated**: Seasonal worker's stated monthly exceeds annualized amount
- **Deposit inconsistency**: Bank deposits don't align with pay stub amounts

## New Components

### `src/components/deals/IncomeSourceCard.tsx`
A sub-card for each income source showing:
- Source type badge (color-coded by type)
- Employer name and job title
- Stated vs. calculated income with delta percentage
- Type-specific fields (hours/rate for hourly, contract months for education)
- Verification status indicator
- Warning flags if any

### `src/components/deals/AddIncomeSourceDialog.tsx`
A dialog form to add a new income source:
- Income type selector (dropdown with 6 types)
- Dynamic fields that change based on selected type (e.g., hours/rate for hourly, contract months for education)
- Employer name, job title, stated monthly income
- Saves to the `income_sources` table

## Modified Components

### `src/components/deals/IncomeVerificationCard.tsx`
Redesigned as a parent container:
- Queries `income_sources` table for the deal
- Lists all sources via `IncomeSourceCard` components
- Shows **total combined monthly income** (sum of all calculated incomes) at the top
- Shows overall payment-to-income ratio using total income
- "Add Income Source" button opens the dialog
- Fraud detection summary section showing all flags across sources
- Falls back to the existing single-source view if no `income_sources` rows exist (backward compatible)

### `src/components/deals/DealSummaryCard.tsx`
Update the `computeRisk` function:
- Use total income from `income_sources` when available instead of single `employmentInfo.monthlyIncome`
- Add risk score points for unverified income sources and total flag count

### `src/types/deal.ts`
Add `IncomeSource` interface and `IncomeSourceType` type for frontend use.

## Files Summary

| Action | File |
|---|---|
| Create | Database migration (enums + `income_sources` table) |
| Create | `src/components/deals/IncomeSourceCard.tsx` |
| Create | `src/components/deals/AddIncomeSourceDialog.tsx` |
| Modify | `src/components/deals/IncomeVerificationCard.tsx` |
| Modify | `src/components/deals/DealSummaryCard.tsx` |
| Modify | `src/types/deal.ts` |

## Technical Notes

- Income calculation is deterministic and rule-based (not AI) -- keeps it fast and auditable
- Each income source is independently verifiable so analysts can approve sources one at a time
- The OCR extraction system (already built) feeds into this: when a document is extracted, it can be linked to a specific income source for cross-checking
- Backward compatible: deals without `income_sources` rows still work using the existing `employmentInfo` data
- The `is_primary` flag determines which source displays first and is used as the main reference

