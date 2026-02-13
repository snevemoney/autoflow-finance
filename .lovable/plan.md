

# File Preview Before Upload

## What Changes
Enhance the DocumentUpload component so that files in the "ready to upload" staging area show a visible preview of their content -- not just a filename and icon.

- **Images (JPG, PNG):** Show a larger inline thumbnail preview of the image (currently only a tiny 10x10 icon)
- **PDFs:** Show an embedded PDF preview using an iframe/embed element so pages are visible and scrollable before uploading

## Technical Details

### Modified File
- `src/components/deals/DocumentUpload.tsx`

### Changes
1. **Expand the file card layout** from a single-row compact view to a card with a preview area above the filename/type selector row
2. **For image files:** Render the existing `item.preview` blob URL in a larger preview container (e.g., max-height 200px, object-contain)
3. **For PDF files:** Create an object URL via `URL.createObjectURL(item.file)` and render it in an `<embed>` or `<iframe>` element (approx 200-250px tall) so the user can see and scroll through pages
4. **For other file types (DOC, DOCX):** Show a larger icon placeholder with the filename since browsers cannot natively render these
5. **Update the `UploadedFile` interface** to also store a preview URL for PDFs (created on drop)
6. **Clean up object URLs** on file removal to prevent memory leaks

### Layout
Each staged file card will look like:

```text
+----------------------------------+
|  [Preview area: image or PDF]    |
|  (200px tall, scrollable for PDF)|
+----------------------------------+
|  icon | filename | type | remove |
+----------------------------------+
```

No database or backend changes needed -- this is purely a frontend UI enhancement.
