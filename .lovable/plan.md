

# Fix Document Viewer + Add Upload File Previews

## Problem
1. Clicking uploaded documents in the deal detail page opens the DocumentViewer, but the iframe shows a 404 because mock data uses non-existent file paths (e.g., `/documents/credit-app.pdf`)
2. Files in the "ready to upload" staging area only show tiny icons -- no visible content preview

## Changes

### 1. Fix DocumentViewer for mock/missing documents
**File:** `src/components/deals/DocumentViewer.tsx`
- Add a fallback when the document URL is a relative path that won't resolve (mock data)
- Show a styled placeholder with the document name, type icon, and a message like "Document preview unavailable -- file not yet stored in cloud storage"
- Once real documents are uploaded to storage, the viewer will work with actual URLs automatically

### 2. Add file previews in DocumentUpload staging area
**File:** `src/components/deals/DocumentUpload.tsx`
- Generate object URLs for PDFs on drop (alongside existing image preview logic)
- Update the staged file card layout from a single compact row to a card with a preview area on top:
  - **Images:** Show the blob URL in a larger preview container (~200px, object-contain)
  - **PDFs:** Show an `<embed>` element (~200px tall) so pages are visible and scrollable
  - **DOC/DOCX:** Show a larger file icon placeholder
- Clean up object URLs on file removal to prevent memory leaks (revoke blob URLs in `removeFile`)
- Update the `UploadedFile` interface to always store a `preview` URL (for both images and PDFs)

### Layout for each staged file card

```text
+----------------------------------+
|  [Preview area: image or PDF]    |
|  (200px tall, scrollable for PDF)|
+----------------------------------+
|  icon | filename | type | remove |
+----------------------------------+
```

## Technical Details

- `URL.createObjectURL(file)` creates a blob URL for PDFs that works in `<embed>` elements
- `URL.revokeObjectURL()` called on removal to free memory
- No database or backend changes needed -- purely frontend UI
- Two files modified: `DocumentViewer.tsx` and `DocumentUpload.tsx`

