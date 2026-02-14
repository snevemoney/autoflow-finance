

# Income Calculation Methods: Manual Calculator + AI-Assisted with Tips Support

## Overview

Add a dual-mode income calculation system per income source -- analysts can either manually calculate MI/YTD using formulas, or let AI extract and compute from documents. The system supports tip adjustments (MI+10 at 10%, MI+20 at 20%, capped there) and automatically flags deals for review when missed work days are detected, triggering a request for 3 months of bank statements (or 12 months for businesses).

## How It Works

### Calculation Modes (per income source)

| Mode | Description |
|---|---|
| **MI (Monthly Income)** | Standard: use gross pay from stubs to derive monthly income |
| **YTD (Year-to-Date)** | Divide YTD gross by the number of months elapsed in the year |
| **MI+10** | Monthly income + 10% tip adjustment |
| **MI+20** | Monthly income + 20% tip adjustment (maximum allowed) |
| **AI Auto** | Let the AI extraction engine determine the best calculation |
| **Manual Override** | Analyst enters a custom calculated amount with a reason |

### Tip Logic
- MI+10: `calculated_monthly * 1.10`
- MI+20: `calculated_monthly * 1.20`
- No higher percentages allowed -- UI enforces max of 20%

### YTD Calculation
- `ytd_gross / months_elapsed_in_year`
- If pay stubs show a recent start date, use actual months worked instead of calendar months
- Useful when MI varies month-to-month (seasonal bonuses, overtime fluctuations)

### Missed Work Day Detection
- Compare expected pay periods to actual stubs submitted
- If gaps are found (e.g., 2 stubs in 3 months), flag the source as "Possible missed work days"
- When flagged:
  - **Individuals**: Request last 3 months bank statements
  - **Businesses (self-employed)**: Request full 12 months bank statements
- The flag triggers a `needs_review` status with a document request note

## Database Changes

### Alter `income_sources` table -- add columns:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `calc_method` | text | `'mi'` | Which formula: `mi`, `ytd`, `mi_plus_10`, `mi_plus_20`, `manual` |
| `tip_percentage` | integer | `null` | 10 or 20 if tips apply, null otherwise |
| `ytd_gross` | numeric | `null` | Year-to-date gross from stubs/extractions |
| `ytd_months` | integer | `null` | Number of months the YTD covers |
| `manual_override_amount` | numeric | `null` | Analyst-entered override value |
| `manual_override_reason` | text | `null` | Why the override was used |
| `missed_days_flag` | boolean | `false` | Whether missed work days were detected |
| `additional_docs_requested` | text[] | `'{}'` | List of additional docs requested (e.g., "3 months bank statements") |

### Add `needs_review` to `income_verification_status` enum
New value alongside existing `unverified`, `verified`, `flagged`, `insufficient_docs`.

## New Component: `IncomeCalculator.tsx`

A calculator panel embedded inside each `IncomeSourceCard` that lets analysts:

1. **Select calculation method** via radio/toggle buttons: MI | YTD | MI+10 | MI+20 | Manual
2. **See live computed result** based on the selected method and available data
3. **YTD inputs**: YTD gross amount and number of months -- auto-filled from OCR if available
4. **Tip adjustment**: Automatically applies 10% or 20% to the base MI
5. **Manual override**: Free-form amount field with required reason textarea
6. **Apply button**: Saves the selected method and computed value to `income_sources`
7. **Missed days alert**: If gaps detected, shows a warning banner with a button to request additional documents

### Calculator Display

```text
+-----------------------------------------------+
| Income Calculator               [MI] [YTD]    |
|                          [MI+10] [MI+20] [Man] |
|-----------------------------------------------|
| Base MI (from stubs):          $4,200/mo       |
| YTD Gross:            $25,200 / 6 mo = $4,200 |
| Tip Adjustment:                     +10% = $420|
|-----------------------------------------------|
| >> Calculated Total:           $4,620/mo  <<   |
|                                                |
| [!] Possible missed work days detected         |
|     Request: 3 months bank statements          |
|                                  [Request Docs]|
|                                                |
|                           [Apply Calculation]  |
+-----------------------------------------------+
```

## Modified Components

### `IncomeSourceCard.tsx`
- Import and render `IncomeCalculator` as an expandable section (like Analyst Actions)
- Display the active calc method as a small badge (e.g., "MI+10" badge next to calculated income)
- Show missed days warning icon if `missed_days_flag` is true

### `IncomeSourceActions.tsx`
- Add `needs_review` to the status dropdown options
- When status is set to `needs_review`, auto-populate a note about required additional documents

### `IncomeVerificationCard.tsx`
- When computing totals, use the tip-adjusted or YTD-derived amounts (whatever `calc_method` dictates)
- Show a summary badge if any source has missed days flagged
- Add a "Review Required" banner at the top if any source is in `needs_review` status

### `AddIncomeSourceDialog.tsx`
- Add initial calc method selector (default MI)
- For tip-eligible types (salaried, part_time), show tip percentage toggle (0%, 10%, 20%)

### `extract-income-data` Edge Function
- Already extracts `ytd_gross` -- no changes needed to the AI prompt
- The extracted YTD value will auto-populate the calculator's YTD field

## Files Summary

| Action | File |
|---|---|
| Create | Database migration (new columns + enum value) |
| Create | `src/components/deals/IncomeCalculator.tsx` |
| Modify | `src/components/deals/IncomeSourceCard.tsx` |
| Modify | `src/components/deals/IncomeSourceActions.tsx` |
| Modify | `src/components/deals/IncomeVerificationCard.tsx` |
| Modify | `src/components/deals/AddIncomeSourceDialog.tsx` |
| Modify | `src/types/deal.ts` |

## Business Rules Enforced

1. Tip percentage maxes at 20% -- UI prevents higher values
2. YTD method requires at least 1 month elapsed to avoid division errors
3. Manual override always requires a written reason (audit trail)
4. Missed work day flag automatically triggers `needs_review` status
5. Document requests differ by source type: 3 months bank statements for individuals, 12 months for businesses
6. AI-extracted YTD values auto-populate but can be overridden manually

