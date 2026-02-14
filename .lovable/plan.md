


# Income Eligibility Rules: Benefits Review, Vehicle-for-Work Rejection, and Temporary Worker Handling

## Overview

Add three new business rules to the income verification system: (1) government assistance and unemployed applicants require analyst review to determine what percentage of their stated benefits count toward qualifying income (case-by-case), (2) applicants who use the financed vehicle for commercial/rideshare work (Uber, Lyft, etc.) are automatically flagged for decline, and (3) temporary citizens or workers get special eligibility handling with required documentation.

## New Business Rules

### 1. Government Assistance / Unemployed: Analyst-Determined Percentage

When an income source type is `government_assistance` or `unemployed`:
- The source is automatically set to `needs_review` status
- The Income Calculator shows a percentage input (default 50%) that the analyst sets
- The analyst reviews the case and decides what percentage of benefits to count
- The UI shows a "Benefits Review" badge
- MI+10 and MI+20 (tips) are disabled for these types
- Manual Override remains available for documented exceptions

### 2. Vehicle Used for Work (Rideshare) -- Auto-Decline

- Add a new field to the deal or income source level: `vehicle_used_for_work` (boolean)
- When an analyst or the system detects the vehicle is used for rideshare (Uber, Lyft, DoorDash, etc.):
  - The deal gets an automatic flag: "Vehicle used for commercial/rideshare work"
  - The income source gets flagged with verification status `flagged`
  - A prominent red banner appears on the Income Verification card: "INELIGIBLE -- Vehicle cannot be used for rideshare/commercial work"
  - The system recommends declining the deal
- The `AddIncomeSourceDialog` will include a checkbox: "Applicant uses vehicle for work (rideshare, delivery, etc.)"
- Known rideshare employers are auto-detected from employer name: Uber, Lyft, DoorDash, Instacart, Grubhub, Amazon Flex, etc.

### 3. Temporary Citizens / Workers

- Add a new field: `residency_status` on the customer or deal level with values: `citizen`, `permanent_resident`, `temporary_worker`, `visa_holder`, `other`
- For temporary workers/visa holders:
  - Flag the deal: "Temporary residency -- verify work authorization"
  - Request additional documents: valid work permit/visa, employment authorization document (EAD)
  - Income can only be counted for the duration of the work authorization (not assumed permanent)
  - If authorization expires within the loan term, flag: "Work authorization expires before loan maturity"
- The `AddIncomeSourceDialog` or a deal-level section will allow setting residency status

## Database Changes

### New columns on `income_sources`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `vehicle_for_work` | boolean | false | Whether applicant uses financed vehicle for rideshare/commercial work |
| `benefit_cap_applied` | boolean | false | Whether benefit percentage was applied by analyst |

### New columns on `deals`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `residency_status` | text | null | Applicant residency: citizen, permanent_resident, temporary_worker, visa_holder, other |
| `work_authorization_expiry` | date | null | When work permit/visa expires |

## Component Changes

### `IncomeCalculator.tsx`
- For `government_assistance` and `unemployed` source types:
  - Show percentage input (default 50%) for analyst to decide qualifying amount
  - Show "Benefits Review" badge
  - Disable MI+10 and MI+20 (tips don't apply to benefits)
  - Display info: "Benefits income requires analyst review"
- For sources where `vehicle_for_work` is true:
  - Show a red "INELIGIBLE" banner instead of the calculator
  - Disable the Apply button

### `IncomeSourceCard.tsx`
- Show a red "Rideshare/Commercial" badge if `vehicle_for_work` is true
- Show a "Benefits Review" badge for government assistance/unemployed sources
- Show residency warning icon if temporary worker

### `AddIncomeSourceDialog.tsx`
- Add "Vehicle used for work" checkbox (shown for all types, prominent for part-time/contractor)
- Auto-detect rideshare employers: if employer name matches known rideshare companies, auto-check the box and show a warning
- For `government_assistance` and `unemployed`: show info text about analyst review
- Benefit sources auto-set to `needs_review` status

### `IncomeVerificationCard.tsx`
- Add "INELIGIBLE" red banner at top if any source has `vehicle_for_work = true`
- Use analyst-set calculated income in totals
- Add residency status indicator if temporary worker
- Show work authorization expiry warning if applicable

### New: Deal-level residency section (in `DealDetail.tsx` or a new component)
- Dropdown for residency status
- Date picker for work authorization expiry
- Auto-flag if expiry falls within loan term

## Auto-Detection Rules

Known rideshare/delivery employer names (case-insensitive matching):
- Uber, Lyft, DoorDash, Grubhub, Instacart, Amazon Flex, Postmates, Spark Driver, Gopuff, Shipt, Roadie

When any of these are entered as an employer name:
1. Auto-check `vehicle_for_work`
2. Show warning: "This employer is a known rideshare/delivery service. Vehicle-for-work deals are not eligible."
3. Auto-flag the source

## Files Summary

| Action | File |
|---|---|
| Create | Database migration (new columns on income_sources and deals) |
| Modify | `src/components/deals/IncomeCalculator.tsx` -- benefit percentage input, rideshare block |
| Modify | `src/components/deals/IncomeSourceCard.tsx` -- new badges and warnings |
| Modify | `src/components/deals/AddIncomeSourceDialog.tsx` -- vehicle-for-work checkbox, rideshare detection, benefit info |
| Modify | `src/components/deals/IncomeVerificationCard.tsx` -- ineligible banner, analyst-set totals |
| Modify | `src/types/deal.ts` -- new fields |

## Business Rules Enforced

1. Government assistance and unemployed benefits require analyst review to set qualifying percentage (case-by-case)
2. Rideshare/delivery drivers using financed vehicle are flagged as ineligible -- deal should be declined
3. Known rideshare employers are auto-detected by name matching
4. Temporary workers require work authorization documentation
5. Deals are flagged if work authorization expires before loan maturity
6. Tip adjustments (MI+10, MI+20) are disabled for benefit-based income types
7. Manual override remains available for documented exceptions with required justification
