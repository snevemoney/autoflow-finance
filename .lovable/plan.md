

# Income Document OCR: Extract Text from Screenshots and Phone Photos

## Problem

Applicants often upload screenshots or phone photos of their pay stubs, bank statements, or other income documents instead of PDFs. Currently, these images are stored but never read -- there's no way to extract the actual income figures from them, which means the system can't verify stated income against what the document actually shows.

## Solution

Add an AI-powered OCR step that automatically extracts income data from uploaded image documents using a Vision model (Gemini Flash, already available via Lovable AI). When an income-related document is uploaded as an image, the system sends it to a backend function that reads the text and pulls out key financial figures.

## How It Works

1. Applicant uploads a screenshot or phone photo of a pay stub or bank statement
2. The file is stored in cloud storage as usual
3. A new backend function (`extract-income-data`) receives the image and sends it to a Vision AI model
4. The AI reads the document and returns structured data: gross pay, net pay, pay period, employer name, pay date
5. The extracted data is saved to the database and displayed in the Income Verification card
6. Automated fraud flags fire if the extracted figures don't match stated income

## What Changes

### New Backend Function: `supabase/functions/extract-income-data/index.ts`

- Accepts an image URL (from storage) or base64 image data
- Sends the image to Gemini Flash with a structured prompt asking it to extract:
  - Gross pay amount
  - Net pay amount
  - Pay period (weekly, biweekly, semimonthly, monthly)
  - Pay date
  - Employer name (as printed on document)
  - Any YTD totals if visible
- Uses tool calling to return structured JSON (same pattern as `verify-employer`)
- Returns extracted data or an error if the image is unreadable

### New Database Table: `extracted_income_data`

Stores the OCR results per document:
- `id`, `deal_id`, `document_id` (links to the uploaded document)
- `gross_pay`, `net_pay` (numeric)
- `pay_frequency` (text: weekly, biweekly, semimonthly, monthly)
- `pay_date` (date)
- `employer_name_on_doc` (text -- what the document actually says)
- `ytd_gross` (numeric, nullable)
- `raw_extracted_text` (text -- full extracted text for audit)
- `confidence` (text: high, medium, low)
- `extracted_at` (timestamp)
- RLS policies for authenticated users

### Modified: `src/components/deals/DocumentUpload.tsx`

- After upload completes, if the document type is `pay_stub`, `bank_statement`, or `income_verification` AND the file is an image (JPG, PNG), automatically trigger the `extract-income-data` function
- Show a small "Extracting income data..." spinner on the file card while processing
- Once complete, show a green checkmark with "Income data extracted" or a warning if extraction failed

### Modified: `src/components/deals/IncomeVerificationCard.tsx`

- Query `extracted_income_data` for the deal's documents
- Use extracted gross pay and pay frequency to calculate monthly income instead of random simulation:
  - Weekly: gross pay x 4.33
  - Biweekly: gross pay x 2.17
  - Semimonthly: gross pay x 2
  - Monthly: gross pay as-is
- Show "Source: Extracted from [document name]" next to calculated income
- If employer name on document differs from stated employer, show a warning flag

### New Component: `src/components/deals/ExtractedDataBadge.tsx`

Small inline badge shown on document rows in the deal detail page:
- Green "Data Extracted" if OCR was successful
- Yellow "Low Confidence" if the AI wasn't sure about the numbers
- Gray "Not Processed" for non-income documents
- Clicking it shows a popover with the extracted figures

### Modified: `src/pages/DealDetail.tsx`

- Show the `ExtractedDataBadge` next to each document in the documents table
- Pass extracted data to the `IncomeVerificationCard`

## Fraud Detection from Extracted Data

These checks run automatically after extraction:

| Flag | Trigger |
|---|---|
| Income mismatch | Extracted gross pay calculates to a monthly figure that differs from stated income by more than 15% |
| Employer name mismatch | Employer on document doesn't match what applicant wrote on application |
| Stale document | Pay date is more than 60 days old |
| Low confidence extraction | AI confidence is "low" -- document may be blurry or tampered |
| YTD inconsistency | YTD gross divided by months elapsed doesn't align with per-period gross |

## Files Summary

| Action | File |
|---|---|
| Create | `supabase/functions/extract-income-data/index.ts` |
| Create | `src/components/deals/ExtractedDataBadge.tsx` |
| Create | Database migration for `extracted_income_data` table |
| Modify | `src/components/deals/DocumentUpload.tsx` |
| Modify | `src/components/deals/IncomeVerificationCard.tsx` |
| Modify | `src/pages/DealDetail.tsx` |

## Technical Notes

- Uses Gemini Flash's vision capabilities (multimodal input with image) -- no external OCR service needed
- Images are converted to base64 before sending to the AI gateway (read from storage bucket)
- The extraction runs asynchronously after upload so it doesn't block the upload flow
- Results are cached in the database so the same document is never processed twice
- Works for both screenshots and phone photos -- the Vision model handles rotation, glare, and partial crops well

