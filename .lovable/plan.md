

## Enhance Income Calculator with Manual Input Fields

### What Changes

Modify `src/components/deals/IncomeCalculator.tsx` to let the analyst manually input numbers for MI calculation instead of just showing a pre-calculated base value. Three input modes for MI:

**1. Salary/Gross Per Period mode:**
- Gross Pay Per Period (dollar amount from pay stub)
- Pay Frequency selector (weekly, biweekly, semimonthly, monthly)
- Auto-calculates: gross x frequency multiplier = monthly income
- Shows breakdown: "$2,100 biweekly x 2.17 = $4,557/mo"

**2. Hourly Rate mode:**
- Hourly Rate input
- Hours Per Week input
- Auto-calculates: rate x hours x 4.33 = monthly income
- Shows breakdown: "$18.50/hr x 32 hrs/wk x 4.33 = $2,561/mo"

**3. YTD mode (already exists, no changes needed)**

### Frequency Multipliers

| Frequency | Multiplier |
|-----------|-----------|
| Weekly | 4.33 |
| Biweekly | 2.17 |
| Semimonthly | 2.00 |
| Monthly | 1.00 |

### Hourly Formula

```text
Monthly = hourlyRate x hoursPerWeek x 4.33
```

### UI Flow

When MI mode is selected, the analyst sees a sub-toggle to pick "Salary" or "Hourly":
- **Salary**: Shows Gross Per Period + Pay Frequency dropdown
- **Hourly**: Shows Hourly Rate + Hours Per Week inputs

Both show a live calculation breakdown and the computed monthly result.

### After Apply -- Auto Variance Check

When the analyst clicks "Apply Calculation", the system:
1. Saves the calculated monthly income
2. Compares calculated vs stated income
3. If variance exceeds 15%, auto-adds a flag reason to `flag_reasons`
4. Shows a toast with the result

### Database Columns (all already exist)

- `income_sources.hourly_rate` -- stores hourly rate
- `income_sources.hours_per_week` -- stores hours/week
- `income_sources.pay_frequency` -- stores frequency
- `income_sources.calculated_monthly_income` -- stores result
- `income_sources.flag_reasons` -- stores auto-detected flags

No database migration needed.

### Technical Details

**New state variables in IncomeCalculator:**
- `grossPerPeriod` (string) -- gross pay from stub
- `payFrequency` (string: weekly/biweekly/semimonthly/monthly)
- `hourlyRate` (string)
- `hoursPerWeek` (string)
- `miInputMode` ('salary' | 'hourly') -- sub-toggle within MI mode

**New props on IncomeCalculator:**
- `currentHourlyRate: number | null`
- `currentHoursPerWeek: number | null`
- `currentPayFrequency: string | null`

These are already available on the `IncomeSource` interface and just need to be passed through from `IncomeSourceCard.tsx`.

**Updated `computedResult` for MI mode:**
- If `miInputMode === 'salary'`: `grossPerPeriod x frequencyMultiplier`
- If `miInputMode === 'hourly'`: `hourlyRate x hoursPerWeek x 4.33`

**Updated `handleApply`:**
- Saves `pay_frequency`, `hourly_rate`, `hours_per_week` to the income source
- After saving, checks variance: `|calculated - stated| / stated > 0.15` and appends "Income variance > 15%" to `flag_reasons` if not already present

### Files Changed

| Action | File |
|--------|------|
| Modify | `src/components/deals/IncomeCalculator.tsx` -- add MI input fields (salary + hourly), variance check |
| Modify | `src/components/deals/IncomeSourceCard.tsx` -- pass new props (hourlyRate, hoursPerWeek, payFrequency) |

