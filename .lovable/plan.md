

# Enhanced Deal Detail: Document Viewer, Income Calculation, Employer Verification, and Deal Summary

## What This Adds

1. **Clickable Document Viewer** -- Clicking any uploaded document opens it in a preview dialog (PDF viewer for PDFs, image display for images, download link for other types). Documents are served from the private storage bucket.

2. **Income Verification Panel** -- A new sidebar card showing:
   - Calculated monthly income from all uploaded pay stubs / bank statements
   - Employer name and job title from customer data
   - Income history: when a new pay stub is uploaded, income is recalculated and the previous vs. updated figure is shown
   - Income-to-payment ratio (monthly income vs. monthly payment)

3. **Employer Verification Check** -- An employer verification card that uses AI (via Lovable AI / Gemini Flash) through a backend function to:
   - Verify if the employer/business exists
   - Show verification status (verified, unverified, flagged)
   - Display brief business info summary

4. **Deal Summary Card** -- A new "Quick Summary" card at the top of the sidebar providing an at-a-glance decision brief:
   - Customer name, credit tier, score
   - Loan amount, LTV, monthly payment vs. income ratio
   - Key flags or concerns
   - Recommendation signal (green/yellow/red) based on business rules

---

## Technical Details

### New Components
- `src/components/deals/DocumentViewer.tsx` -- Dialog component that renders PDF (via iframe/embed) or images inline when a document is clicked
- `src/components/deals/IncomeVerificationCard.tsx` -- Sidebar card calculating income from income-type documents, showing employer info, and recalculating when new docs are added
- `src/components/deals/EmployerVerificationCard.tsx` -- Card that calls a backend function to verify employer existence
- `src/components/deals/DealSummaryCard.tsx` -- Quick summary card with decision metrics and risk signal

### Backend Function
- `supabase/functions/verify-employer/index.ts` -- Edge function that uses Lovable AI (Gemini Flash) to verify if an employer/business is real. Takes employer name, city, state as input and returns verification result with confidence level and brief business summary.

### Database Changes
- Add `calculated_monthly_income` column to `deals` table to store the computed income
- Add `employer_verified` (boolean) and `employer_verification_data` (jsonb) columns to `customers` table

### Modified Files
- `src/pages/DealDetail.tsx` -- Add the new sidebar cards (Deal Summary, Income Verification, Employer Verification) and make document rows clickable to open the DocumentViewer dialog
- `src/components/deals/DocumentUpload.tsx` -- After successful upload, trigger income recalculation if the document type is pay_stub or bank_statement

### Income Calculation Logic
- Filter all deal documents of type `pay_stub` or `bank_statement`
- For pay stubs: use the customer's stated monthly income as baseline, then adjust if multiple stubs show different amounts
- When a new income document is uploaded, recalculate by averaging across all available pay stubs
- Show "Last updated" timestamp and delta from previous calculation

### Employer Verification Flow
1. On deal detail load, check if `employer_verified` is already set on the customer
2. If not, show a "Verify Employer" button
3. On click, call the `verify-employer` edge function
4. Display result: verified checkmark, business type, years in operation (from AI response)
5. Cache the result in the customer record so it doesn't re-run

### Deal Summary Logic
- Compute a risk score based on: credit score, LTV ratio, income-to-payment ratio, number of flags, document completion percentage
- Display as a color-coded summary (green = low risk, yellow = moderate, red = high risk)
- Show key metrics in a compact layout for fast decision-making

