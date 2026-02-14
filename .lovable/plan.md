

# Manual Linking of Unmatched OCR Extractions

## Problem

When the OCR system extracts income data from uploaded documents, it tries to auto-match to an income source by comparing employer names. If the names don't match (e.g., "ACME CORPORATION" on the pay stub vs. "Acme Corp" in the income source), the extraction remains unlinked and shows as an "unmatched" badge with no way for the analyst to fix it.

## Solution

Add an "Unmatched Extractions" section in the Income Verification Card that lists each unlinked extraction with a dropdown to manually assign it to an income source. On selection, the extraction is linked and the income source's calculated income and fraud flags are updated automatically (reusing the existing logic).

## What Gets Built

### 1. New Component: `UnmatchedExtractionRow`

A row component showing:
- Employer name from document, gross pay, frequency, confidence badge
- A `Select` dropdown listing all income sources by employer name
- A "Link" button that triggers the assignment

When linked:
- Updates `extracted_income_data.income_source_id` to the chosen source
- Recalculates the income source's `calculated_monthly_income` using `calcMonthlyFromExtraction`
- Runs the same fraud flag checks (variance > 15%, employer mismatch, document age > 60 days)
- Refetches data so the UI updates

### 2. Modify: `IncomeVerificationCard.tsx`

In the multi-source view, below the "X unmatched" badge area (~line 240-254), add a collapsible section that renders `UnmatchedExtractionRow` for each extraction where `income_source_id` is null and `gross_pay` is not null.

## Files Summary

| Action | File |
|--------|------|
| Create | `src/components/deals/UnmatchedExtractionRow.tsx` |
| Modify | `src/components/deals/IncomeVerificationCard.tsx` -- add unmatched section with manual link UI |

## Technical Details

- The `UnmatchedExtractionRow` component receives the extraction object and the list of income sources as props, plus `onLinked` callback
- The linking logic mirrors lines 94-136 of `IncomeVerificationCard.tsx` (the existing auto-match effect) but is triggered on button click
- After linking, the row disappears from the unmatched list because the extraction now has an `income_source_id`
- The `refetchSources` call ensures the IncomeSourceCard updates its linked extractions display
- No database schema changes needed -- `extracted_income_data.income_source_id` already exists as a nullable UUID column

