

## Add Brief Highlight Animation on Click-to-Fill

When an extracted value is clicked and auto-fills a calculator input, the target field will briefly flash with a highlight animation so the analyst gets clear visual confirmation of which field was populated.

---

### Approach

Use a `highlightedField` state variable in `IncomeCalculator` that tracks which field was just filled. When `fillField` is called, set the field name into this state, then clear it after 700ms via `setTimeout`. Pass a conditional CSS class to each `DroppableInput` (and the manual override input) that applies a quick glow/pulse animation.

### Changes

**1. `src/components/deals/IncomeCalculator.tsx`**

- Add state: `const [highlightedField, setHighlightedField] = useState<string | null>(null)`
- In the `fillField` callback, after setting the value, call `setHighlightedField(field)` and schedule a `setTimeout(() => setHighlightedField(null), 700)`
- On each `DroppableInput` and the manual override `Input`, add a conditional class: `highlightedField === 'fieldName' && 'animate-fill-highlight'`

**2. `src/index.css`**

- Add a `@keyframes fill-highlight` animation that briefly flashes the input with a colored ring/background pulse:
  - `0%`: ring + light background color
  - `100%`: back to normal
- Add the `.animate-fill-highlight` utility class using this keyframe

### Result

A subtle 700ms ring pulse on the exact input field that was just populated, giving analysts instant feedback on where the value landed.

