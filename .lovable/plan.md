

# Next Steps for Auto Finance Platform

## Current State
The frontend MVP is complete with mock data: dashboard, pipeline board, department queues, deal details, settings, and reports. Everything runs on static mock data with no persistence or authentication.

## Recommended Next Steps (in priority order)

### 1. Connect a Backend (Lovable Cloud / Supabase)
Set up a database to persist deals, documents, users, and dealers. This replaces all mock data with real CRUD operations.

**Tables to create:**
- `dealers` - dealer info and status
- `customers` - customer contact and employment info
- `vehicles` - vehicle details per deal
- `deals` - core deal records linking customer, vehicle, dealer
- `documents` - uploaded file metadata
- `deal_notes` - internal comments on deals
- `deal_timeline` - activity/event log
- `notifications` - user notifications

### 2. Add Authentication & Role-Based Access
Implement login/signup with role-based access control (dealer, credit analyst, income verifier, funding manager, admin). Each role sees only their relevant pages and actions.

### 3. Dealer Submission Portal
Build a dedicated deal submission form where dealers can:
- Enter customer and vehicle information
- Upload required documents
- Track their submitted deals

### 4. Make Pipeline Functional
Wire up the drag-and-drop pipeline to actually update deal status in the database, trigger notifications, and route deals to the correct department queue.

### 5. Email Notifications (via Edge Functions)
Set up automated emails using Resend for deal status changes (submission confirmation, approval/decline notifications, document requests).

---

## Suggested Approach
Tackle these one at a time, starting with **Step 1 (backend setup)** since everything else depends on having real data persistence. Each step is a single prompt-sized task.

