# EventHub — Booking Management Test Scenarios

Generated: 2026-10-31
Scope: Booking Management — view list, view detail, cancel (list + detail), clear all, refund eligibility, FIFO pruning, seat release, booking-ref rules, sandbox isolation.

Sources: `eventhub-domain` skill (`business-rules.md`, `user-flows.md`), `frontend/app/bookings/**`, `frontend/components/bookings/BookingCard.jsx`, `frontend/lib/hooks/useBookings.ts`, `frontend/lib/api/client.js`, `backend/src/services/bookingService.js`, `backend/src/repositories/bookingRepository.js`, `backend/src/validators/bookingValidator.js`, `backend/src/middleware/errorHandler.js`.

---

## Code vs. Domain Discrepancies (discovered during analysis)

These are places where the code behaves differently from the documented rules. The scenarios that exercise them are tagged **[DISCREPANCY]** and are the most likely to find real bugs.

| # | Documented | Actual code behavior | Scenario |
|---|---|---|---|
| D1 | Cross-user booking access → 403 | `cancelBooking` looks up with `findById(id, userId)` (scoped), so cross-user **DELETE returns 404**, not 403. The `ForbiddenError` branch is unreachable. GET by id/ref still returns 403. | TC-202 |
| D2 | FIFO prunes oldest when a *new booking* is made | Pruning runs **before** the event-exists and seat checks. A booking that then fails (404 event / 400 insufficient seats) has still deleted the user's oldest booking. | TC-302, TC-303 |
| D3 | "Booking decrements availableSeats atomically" | No transaction wraps count → prune → seat check → create. Concurrent requests at 8 bookings can end with 10. Seats are only decremented in the DB in the same-event fallback. | TC-410 |
| D4 | Static events' seats are a fixed DB field | The same-event fallback calls `decrementSeats` on the event row, which **permanently reduces a static event's seats for every user**. Neither cancel nor clear-all restores it. | TC-101, TC-206 |
| D5 | Bookings page shows max 9 per page | Frontend requests `limit: 10`; the API defaults to 10. With a 9-booking cap the pagination never renders through the UI. | TC-108, TC-510 |
| D6 | Bookings page has a conditional sandbox banner | No banner exists in `app/bookings/page.tsx`; the only sandbox banner is on `/events`. | TC-511 |
| D7 | Refund button labeled "Check Refund Eligibility" | Actual text is "Check eligibility for refund?" (`data-testid="check-refund-btn"`). | TC-103 |
| D8 | — | "Clear all bookings" has no error handling: a failed request gives no feedback and can raise an unhandled promise rejection. | TC-309 |

---

## Happy Path

### TC-001: View bookings list with existing bookings
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in as `rahulshetty1@gmail.com`; at least one booking exists (create one via UI or API)
**Steps**:
1. Navigate to `/bookings`
2. Wait for `[data-testid="booking-card"]` to be visible
**Expected Results**: Heading "My Bookings" visible. Each card shows booking ref (`.booking-ref`), "confirmed" badge, `#<id>` (`data-testid="booking-id"`), event title, event date, "N ticket(s)", city, "Booked <date>", total price, "View Details" link and "Cancel Booking" button. Cards are ordered newest first (`createdAt desc`).
**Business Rule**: Flow 4 — Manage Bookings; repository `orderBy: createdAt desc`
**Suggested Layer**: E2E

---

### TC-002: View single booking detail page
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in; user owns a booking
**Steps**:
1. Navigate to `/bookings`
2. Click "View Details" on a booking card
**Expected Results**: URL is `/bookings/<id>`. Page shows breadcrumb "My Bookings / <ref>", ref badge, status badge, and event title as H1. Sections: Event Details (Event, Category, Date, Venue, City), Customer Details (Name, Email, Phone), Payment Summary (Tickets, Price per ticket, Total Paid), Refund, Booking Information (Booked on, Booking ID `#<id>`). "Cancel Booking" and "← Back to My Bookings" are visible.
**Business Rule**: Booking model; Flow 4
**Suggested Layer**: E2E

---

### TC-003: Cancel a booking from the detail page
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in; user owns a booking
**Steps**:
1. Open `/bookings/<id>`
2. Click "Cancel Booking"
3. In the dialog, click "Yes, cancel it" (`data-testid="confirm-dialog-yes"`)
**Expected Results**: Toast "Booking cancelled successfully". Redirect to `/bookings`. The cancelled booking's ref no longer appears in the list. `GET /api/bookings/<id>` returns 404.
**Business Rule**: User can cancel (delete) individual bookings
**Suggested Layer**: E2E

---

### TC-004: Cancel a booking from the bookings list card
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in; user has ≥2 bookings
**Steps**:
1. Navigate to `/bookings`
2. On a specific card (filter by its ref), click `data-testid="cancel-booking-btn"`
3. Click "Yes, cancel it"
**Expected Results**: Toast "Booking cancelled successfully". User **stays** on `/bookings` (no redirect). The list refetches, the cancelled card disappears and the other bookings remain.
**Business Rule**: Cancel individual bookings; `useCancelBooking` invalidates `['bookings']`
**Suggested Layer**: E2E

---

### TC-005: Clear all bookings from the list page
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in; user has ≥2 bookings
**Steps**:
1. Navigate to `/bookings`
2. Register `page.once('dialog', d => d.accept())` (native `confirm()`)
3. Click "Clear all bookings"
**Expected Results**: Confirm text is "Clear all your bookings? This cannot be undone.". After accepting, the empty state "No bookings yet" appears with a "Browse Events" button. `GET /api/bookings` returns `data: []`, `pagination.total: 0`.
**Business Rule**: "Clear All Bookings" removes all bookings in one go
**Suggested Layer**: E2E

---

### TC-006: Navigate from booking confirmation to My Bookings
**Category**: Happy Path
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. Book any event from `/events/<id>` (quantity 1, valid customer data)
2. On the "Booking Confirmed! 🎉" card, note the ref
3. Click "View My Bookings"
**Expected Results**: URL is `/bookings`. The **first** card has the same ref as the confirmation card (newest first).
**Business Rule**: After booking, user can view bookings via "View My Bookings"
**Suggested Layer**: E2E

---

### TC-007: Back navigation from detail to list
**Category**: Happy Path
**Priority**: P2
**Preconditions**: Logged in; user owns a booking
**Steps**:
1. Open `/bookings/<id>`
2. Click "← Back to My Bookings"; then reopen the detail and click the "My Bookings" breadcrumb link
**Expected Results**: Both navigate to `/bookings`.
**Business Rule**: Flow 4 navigation
**Suggested Layer**: E2E

---

### TC-008: API — list, get by id, get by ref, cancel, clear all
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Valid JWT from `POST /api/auth/login`; one booking created via `POST /api/bookings`
**Steps**:
1. `GET /api/bookings` → find the created booking
2. `GET /api/bookings/<id>`
3. `GET /api/bookings/ref/<bookingRef>`
4. `DELETE /api/bookings/<id>`
5. Create two more bookings, then `DELETE /api/bookings`
**Expected Results**: (1) 200, `{ success, data[], pagination{total,page,limit,totalPages} }`. (2) and (3) 200 with the same booking, including a nested `event`. (4) 200 `{ success: true, message: "Booking cancelled" }`. (5) 200 `message: "2 booking(s) cleared"`.
**Business Rule**: Booking API contract
**Suggested Layer**: API

---

## Business Rules

### TC-100: FIFO — 10th booking prunes the oldest booking of a *different* event
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Logged in; all bookings cleared
**Steps**:
1. Via API, create booking B1 for event A, then B2–B9 for event B (9 total; B1 is oldest)
2. Create a 10th booking for event B
**Expected Results**: Total is still 9. B1 (the event A booking) is gone. B2–B9 plus the new booking remain.
**Business Rule**: Max 9 bookings, FIFO; `findOldestUserBookingExcludingEvent` is preferred
**Suggested Layer**: API

---

### TC-101: FIFO same-event fallback permanently burns seats **[DISCREPANCY D4]**
**Category**: Business Rule
**Priority**: P1
**Preconditions**: Logged in; bookings cleared; a **user-created** event E (use your own event to avoid affecting shared static data)
**Steps**:
1. Record E's `availableSeats` via `GET /api/events/<E>` → S
2. Create 9 bookings for E, each with quantity 1
3. Create a 10th booking for E with quantity 1
4. Clear all bookings (`DELETE /api/bookings`), then `GET /api/events/<E>`
**Expected Results**: After step 3 there are 9 bookings and the oldest booking for E was deleted. After step 4 `availableSeats` is `S - 1`, not `S`: the fallback decremented the DB row and nothing restores it. Document this as intended behavior or a defect.
**Business Rule**: `sameEventFallback` → `eventRepository.decrementSeats`
**Suggested Layer**: API

---

### TC-102: Booking ref prefix equals uppercase first character of event title
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Logged in
**Steps**:
1. Book static "Tech Conference Bangalore", then "AI Summit Hyderabad"
2. Create own event titled "zebra night" (lowercase) and book it
3. Check refs on the confirmation card, the list card and the detail page
**Expected Results**: Refs match `/^T-[A-Z0-9]{6}$/`, `/^A-[A-Z0-9]{6}$/` and `/^Z-[A-Z0-9]{6}$/`. The ref is identical in all three UI locations.
**Business Rule**: Ref format `[FIRST_LETTER]-[6_RANDOM]`, uppercased
**Suggested Layer**: E2E (one) + API (variants)

---

### TC-103: Refund eligibility — 1 ticket is eligible **[DISCREPANCY D7]**
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Logged in; booking with quantity = 1
**Steps**:
1. Open `/bookings/<id>`
2. Click `data-testid="check-refund-btn"` (text "Check eligibility for refund?")
**Expected Results**: `refund-spinner` appears with "Checking your refund eligibility…". Then `refund-result` shows "Eligible for refund. Single-ticket bookings qualify for a full refund." (green).
**Business Rule**: quantity = 1 → eligible (client-side)
**Suggested Layer**: E2E

---

### TC-104: Refund eligibility — multiple tickets are not eligible
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Logged in; booking with quantity = 3
**Steps**:
1. Open the booking detail and click "Check eligibility for refund?"
**Expected Results**: After the spinner, `refund-result` shows "Not eligible for refund. Group bookings (3 tickets) are non-refundable." The quantity in the message matches the booking.
**Business Rule**: quantity > 1 → not eligible
**Suggested Layer**: E2E

---

### TC-105: Refund spinner lasts ~4 seconds
**Category**: Business Rule
**Priority**: P2
**Preconditions**: Booking detail open
**Steps**:
1. Click the refund button and record the time
2. Assert `refund-spinner` is visible immediately and `refund-result` is not
3. Wait for `refund-result` (timeout ≥ 6s, web-first assertion)
**Expected Results**: The result appears about 4s after the click (allow 3.5–6s). The spinner is hidden once the result is shown. Use `page.clock` to make this deterministic and do not use `waitForTimeout`.
**Business Rule**: 4-second spinner
**Suggested Layer**: E2E / Component

---

### TC-106: Total price = event price × quantity
**Category**: Business Rule
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. Book "Digital Marketing Workshop" ($299) with quantity 3
2. Check the API response, the list card and the detail Payment Summary
**Expected Results**: `totalPrice` = 897. The card shows "$897". Detail shows Tickets 3, Price per ticket $299, Total Paid $897.
**Business Rule**: `totalPrice = event.price × quantity`
**Suggested Layer**: API + E2E

---

### TC-107: Cancelling releases seats (per-user available count)
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Logged in; bookings cleared
**Steps**:
1. `GET /api/events/<id>` → seats S
2. Book quantity 4 → event shows S − 4 (API and `/events/<id>` page)
3. Cancel the booking → re-check
**Expected Results**: Seats go back to S after cancellation, for both static and user-created events.
**Business Rule**: Cancellation immediately frees seats; per-user computed availability
**Suggested Layer**: API + E2E

---

### TC-108: Page size — API default 10 vs documented 9 **[DISCREPANCY D5]**
**Category**: Business Rule
**Priority**: P3
**Preconditions**: 9 bookings exist
**Steps**:
1. `GET /api/bookings` (no params) and `GET /api/bookings?limit=5&page=2`
2. Open `/bookings`
**Expected Results**: Default `pagination.limit` = 10 and `totalPages` = 1. With limit=5 & page=2 the response has 4 items, `totalPages` = 2. The UI shows all 9 cards and no pagination control.
**Business Rule**: Bookings page shows max 9 bookings
**Suggested Layer**: API

---

### TC-109: Clear all also releases seats
**Category**: Business Rule
**Priority**: P1
**Preconditions**: Bookings for events X (qty 2) and Y (qty 3)
**Steps**:
1. Record seats for X and Y; clear all; re-check
**Expected Results**: X gains 2 and Y gains 3 (back to their pre-booking values), assuming no same-event fallback has happened.
**Business Rule**: Booking deletion frees seats
**Suggested Layer**: API

---

### TC-110: Deleting own event cascades to its bookings
**Category**: Business Rule
**Priority**: P1
**Preconditions**: User-created event E with 2 bookings, plus 1 booking on a static event
**Steps**:
1. Delete E via `/admin/events` or `DELETE /api/events/<E>`
2. Open `/bookings`
**Expected Results**: Only the static-event booking remains. `GET /api/bookings/<oldE-booking-id>` returns 404.
**Business Rule**: Booking `eventId` cascade delete
**Suggested Layer**: API + E2E

---

### TC-111: FIFO via event pruning — 7th event removes bookings of the pruned event
**Category**: Business Rule
**Priority**: P2
**Preconditions**: User has 6 events; the oldest event has a booking
**Steps**:
1. Create a 7th event
2. Check the bookings list
**Expected Results**: The oldest event is deleted and its bookings disappear from `/bookings`.
**Business Rule**: Max 6 events FIFO + cascade
**Suggested Layer**: API

---

### TC-112: Status is always "confirmed"; status filter works
**Category**: Business Rule
**Priority**: P3
**Preconditions**: ≥1 booking
**Steps**:
1. `GET /api/bookings?status=confirmed` and `?status=cancelled`
2. `GET /api/bookings?eventId=<id>`
**Expected Results**: "confirmed" returns all bookings and "cancelled" returns `[]`. `eventId` returns only that event's bookings.
**Business Rule**: Booking status always "confirmed"; cancellation is a hard delete
**Suggested Layer**: API

---

## Security

### TC-200: Cross-user booking detail shows "Access Denied" (UI)
**Category**: Security
**Priority**: P0
**Preconditions**: User A (gmail) creates a booking and captures its id
**Steps**:
1. Log in as User B (`rahulshetty1@yahoo.com`) in a fresh context
2. Navigate to `/bookings/<A's id>`
**Expected Results**: "Access Denied" and "You are not authorized to view this booking." are shown, with a "View My Bookings" button. No booking data is rendered.
**Business Rule**: Cross-user access → "Access Denied"
**Suggested Layer**: E2E

---

### TC-201: Cross-user GET by id and by ref return 403 (API)
**Category**: Security
**Priority**: P0
**Preconditions**: A's booking id and ref; B's token
**Steps**:
1. As B: `GET /api/bookings/<id>` and `GET /api/bookings/ref/<ref>`
**Expected Results**: 403. Messages: "You are not authorized to view this booking" (id) and "You do not own this booking" (ref). The body has no booking data.
**Business Rule**: Sandbox isolation
**Suggested Layer**: API

---

### TC-202: Cross-user cancel is rejected and A's booking survives **[DISCREPANCY D1]**
**Category**: Security
**Priority**: P0
**Preconditions**: A's booking id; B's token
**Steps**:
1. As B: `DELETE /api/bookings/<A's id>`
2. As A: `GET /api/bookings/<id>`
**Expected Results**: Step 1 is non-2xx. **Actual code returns 404** "Booking with id X not found", not the documented 403. Assert the status deliberately and record the gap. Step 2 returns 200, so A's booking still exists.
**Business Rule**: Cross-user access forbidden
**Suggested Layer**: API

---

### TC-203: Clear-all only affects the caller's bookings
**Category**: Security
**Priority**: P0
**Preconditions**: A and B each have ≥1 booking
**Steps**:
1. As B: `DELETE /api/bookings`
2. As A: `GET /api/bookings`
**Expected Results**: B's bookings are 0. A's count is unchanged.
**Business Rule**: Bookings scoped by `userId`
**Suggested Layer**: API

---

### TC-204: Bookings list never includes other users' bookings
**Category**: Security
**Priority**: P0
**Preconditions**: A and B each have bookings
**Steps**:
1. As B: `GET /api/bookings` and open `/bookings`
**Expected Results**: None of A's refs or ids appear. Every returned booking belongs to B.
**Business Rule**: Sandbox isolation
**Suggested Layer**: API + E2E

---

### TC-205: Unauthenticated / invalid token access
**Category**: Security
**Priority**: P0
**Preconditions**: None
**Steps**:
1. Call `GET /api/bookings`, `GET /api/bookings/1`, `GET /api/bookings/ref/T-AAAAAA`, `DELETE /api/bookings/1` and `DELETE /api/bookings` with (a) no header, (b) `Bearer garbage`, (c) a token signed with the wrong secret, (d) an expired token
2. In the UI, clear `localStorage.eventhub_token` and open `/bookings` and `/bookings/<id>`
**Expected Results**: All API calls return 401. In the UI, the 401 interceptor removes the token and redirects to `/login`.
**Business Rule**: `router.use(authMiddleware)`
**Suggested Layer**: API + E2E

---

### TC-206: Same-event fallback on a static event leaks across users **[DISCREPANCY D4]**
**Category**: Security
**Priority**: P2
**Preconditions**: Only run in a disposable environment, because it mutates shared seed data
**Steps**:
1. As B: record static event S's `availableSeats`
2. As A: make 9 bookings for S, then a 10th for S
3. As B: re-check S's seats
**Expected Results**: Actual behavior: B sees 1 seat fewer, even though B made no bookings. Sandbox isolation is broken for static events. Report as a defect; do not automate against prod.
**Business Rule**: Static events immutable; sandbox isolation
**Suggested Layer**: API (manual/exploratory)

---

### TC-207: Mass-assignment — client-supplied server fields are ignored
**Category**: Security
**Priority**: P1
**Preconditions**: Valid token
**Steps**:
1. `POST /api/bookings` with valid fields plus `userId: <B's id>`, `status: "cancelled"`, `totalPrice: 1`, `bookingRef: "X-HACKED"`
**Expected Results**: 201. Response has the caller's userId, status "confirmed", totalPrice = price × qty and a generated ref (not "X-HACKED"). The booking does not appear in B's list.
**Business Rule**: Service builds the record from whitelisted fields only
**Suggested Layer**: API

---

### TC-208: Stored XSS in customer fields renders as text
**Category**: Security
**Priority**: P1
**Preconditions**: Valid token
**Steps**:
1. Create a booking with `customerName: "<img src=x onerror=alert(1)>"`
2. Open the list and the detail page
**Expected Results**: The name renders as literal text. No dialog fires (attach a `page.on('dialog')` that fails the test) and no `<img>` element is injected.
**Business Rule**: Input safety
**Suggested Layer**: E2E

---

### TC-209: Booking another user's private event is rejected
**Category**: Security
**Priority**: P1
**Preconditions**: User A has a user-created event E
**Steps**:
1. As B: `POST /api/bookings` with `eventId: E`
**Expected Results**: 404 "Event with id E not found". No booking is created for B. (If B already had 9 bookings, see TC-303.)
**Business Rule**: Events scoped `OR: [{isStatic}, {userId}]`
**Suggested Layer**: API

---

### TC-210: Ref enumeration / injection on `/ref/:ref`
**Category**: Security
**Priority**: P2
**Preconditions**: Valid token
**Steps**:
1. `GET /api/bookings/ref/' OR 1=1 --` (URL-encoded) and `GET /api/bookings/ref/%25`
**Expected Results**: 404, with no data leak and no 500. Prisma queries are parameterized.
**Business Rule**: Input safety
**Suggested Layer**: API

---

## Negative / Error

### TC-300: Non-existent booking id in the UI shows "Booking not found"
**Category**: Negative
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. Navigate to `/bookings/99999999`
**Expected Results**: "Booking not found" and "This booking doesn't exist or may have been cancelled." are shown, with a "View My Bookings" button. The "Access Denied" text is not shown.
**Business Rule**: 404 → not-found state
**Suggested Layer**: E2E

---

### TC-301: API — non-existent id / ref returns 404
**Category**: Negative
**Priority**: P1
**Preconditions**: Valid token
**Steps**:
1. `GET /api/bookings/99999999`, `GET /api/bookings/ref/Z-000000`, `DELETE /api/bookings/99999999`
**Expected Results**: All return 404 with `success: false` and a descriptive `error`.
**Business Rule**: `NotFoundError` → 404
**Suggested Layer**: API

---

### TC-302: Failed booking (insufficient seats) at the 9-booking cap still prunes **[DISCREPANCY D2]**
**Category**: Negative
**Priority**: P1
**Preconditions**: User has exactly 9 bookings; a user-created event E with 2 seats
**Steps**:
1. Record the oldest booking's id
2. `POST /api/bookings` for E with quantity 5
3. `GET /api/bookings`
**Expected Results**: Step 2 returns 400 "Only 2 seat(s) available, but 5 requested". **Expected per rule**: still 9 bookings. **Actual code**: 8 bookings, because the oldest was deleted before the seat check. Treat as a defect.
**Business Rule**: FIFO prune happens only when a new booking is created
**Suggested Layer**: API

---

### TC-303: Failed booking (non-existent event) at the cap still prunes **[DISCREPANCY D2]**
**Category**: Negative
**Priority**: P1
**Preconditions**: User has exactly 9 bookings
**Steps**:
1. `POST /api/bookings` with `eventId: 99999999` and otherwise valid data
2. `GET /api/bookings`
**Expected Results**: 404 "Event with id 99999999 not found". **Actual**: 8 bookings remain, so the oldest was lost.
**Business Rule**: FIFO prune only on successful create
**Suggested Layer**: API

---

### TC-304: Create-booking validation errors
**Category**: Negative
**Priority**: P1
**Preconditions**: Valid token
**Steps**: `POST /api/bookings` once for each invalid payload:
1. Missing `eventId` / `eventId: 0` / `eventId: "abc"`
2. `customerName: ""` / `"A"` / `"  A  "` (trimmed to 1 char)
3. `customerEmail: ""` / `"not-an-email"`
4. `customerPhone: "12345"` / `"12345abcde"`
5. `quantity` missing / `0` / `-1` / `11` / `2.5`
**Expected Results**: Each returns 400 `{ error: "Validation failed", details: [{ field, message }] }` with the matching message (e.g. "Quantity must be an integer between 1 and 10"). No booking is created **and no FIFO prune happens** (the validator runs before the service).
**Business Rule**: `bookingValidator.js`
**Suggested Layer**: API

---

### TC-305: Insufficient seats below the cap
**Category**: Negative
**Priority**: P1
**Preconditions**: User-created event with 3 seats; user has <9 bookings
**Steps**:
1. Book quantity 3 (succeeds), then book quantity 1
**Expected Results**: The second request returns 400 "Only 0 seat(s) available, but 1 requested". The event detail page shows "Sold Out" and the Confirm button is disabled.
**Business Rule**: Per-user seat availability
**Suggested Layer**: API + E2E

---

### TC-306: Cancel an already-cancelled booking
**Category**: Negative
**Priority**: P2
**Preconditions**: A booking just cancelled via API
**Steps**:
1. `DELETE /api/bookings/<id>` again
**Expected Results**: 404 "Booking with id X not found".
**Business Rule**: Hard delete
**Suggested Layer**: API

---

### TC-307: Cancel from a stale detail page (booking removed elsewhere)
**Category**: Negative
**Priority**: P2
**Preconditions**: Detail page for booking X open; X deleted via API in the background
**Steps**:
1. Click "Cancel Booking" → "Yes, cancel it"
**Expected Results**: Error toast "Booking with id X not found". The dialog closes. No redirect.
**Business Rule**: `useCancelBooking` onError → toast
**Suggested Layer**: E2E

---

### TC-308: Bookings list shows an error state when the API fails
**Category**: Negative
**Priority**: P2
**Preconditions**: Logged in
**Steps**:
1. `page.route('**/api/bookings*', r => r.fulfill({ status: 500 }))`
2. Open `/bookings`, then unroute and click "Retry"
**Expected Results**: "Couldn't load bookings" and "Failed to connect to the server. Please try again." are shown with a "Retry" button. After Retry the list loads.
**Business Rule**: UI error handling
**Suggested Layer**: E2E (mocked)

---

### TC-309: Clear-all failure gives no feedback **[DISCREPANCY D8]**
**Category**: Negative
**Priority**: P3
**Preconditions**: ≥1 booking
**Steps**:
1. Mock `DELETE **/api/bookings` → 500
2. Accept the confirm dialog after clicking "Clear all bookings"
**Expected Results**: The button returns from "Clearing…" to "Clear all bookings" and the bookings are still listed. Record that no error toast is shown (UX gap) and check the console for an unhandled rejection.
**Business Rule**: `handleClearAll` has try/finally with no catch
**Suggested Layer**: E2E (mocked)

---

### TC-310: Malformed booking id
**Category**: Negative
**Priority**: P2
**Preconditions**: Valid token
**Steps**:
1. `GET /api/bookings/abc`, `GET /api/bookings/-1`, `GET /api/bookings/1.5`, `DELETE /api/bookings/abc`
2. UI: open `/bookings/abc`
**Expected Results**: The API should return 400 or 404, never a 500 (`Number('abc')` is `NaN`, which reaches Prisma). The UI shows "Booking not found".
**Business Rule**: Robust input handling
**Suggested Layer**: API

---

### TC-311: Invalid pagination params
**Category**: Negative
**Priority**: P3
**Preconditions**: Valid token
**Steps**:
1. `GET /api/bookings?page=-1`, `?page=abc`, `?limit=0`, `?limit=-5`, `?limit=100000`
**Expected Results**: No 500. `page=abc` and `limit=0` fall back to the defaults (1/10). Check whether negative values cause a Prisma error and whether a large `limit` is capped.
**Business Rule**: `getBookings` param coercion
**Suggested Layer**: API

---

## Edge Cases

### TC-400: Exactly 9 bookings — no pruning
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Bookings cleared
**Steps**:
1. Create 9 bookings across different events
**Expected Results**: All 9 exist and the first one is still present. Pruning only starts at the 10th (`count >= 9` checked before create).
**Business Rule**: Max 9 bookings
**Suggested Layer**: API

---

### TC-401: 8 → 9 → 10 transitions
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Bookings cleared
**Steps**:
1. Create 8, then the 9th, then the 10th and 11th (different events)
**Expected Results**: Counts are 8 → 9 → 9 → 9. The 10th removes the 1st and the 11th removes the 2nd (FIFO order kept).
**Business Rule**: FIFO
**Suggested Layer**: API

---

### TC-402: Quantity boundaries 1 and 10
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. Book quantity 1 (card shows "1 ticket"); book quantity 10 (card shows "10 tickets")
**Expected Results**: Both succeed. The singular/plural label is correct. Totals = price × qty.
**Business Rule**: Quantity 1–10
**Suggested Layer**: E2E + API

---

### TC-403: Refund boundary — quantity 2
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Booking with quantity 2
**Steps**:
1. Check refund eligibility
**Expected Results**: "Not eligible… Group bookings (2 tickets) are non-refundable."
**Business Rule**: `quantity === 1` → eligible
**Suggested Layer**: E2E / Component

---

### TC-404: Refund result is not persisted
**Category**: Edge Case
**Priority**: P3
**Preconditions**: Detail page; refund result shown
**Steps**:
1. Reload the page; separately, click the refund button and navigate away before 4s, then come back
**Expected Results**: After reload the "Check eligibility for refund?" button is shown again (state resets). Navigating away mid-check produces no errors.
**Business Rule**: Client-side only refund logic
**Suggested Layer**: E2E

---

### TC-405: Customer email is normalized on save
**Category**: Edge Case
**Priority**: P2
**Preconditions**: Valid token
**Steps**:
1. Book with `customerEmail: "John.Doe+test@GMAIL.com"`
2. View the detail page
**Expected Results**: The stored and displayed email is normalized by `normalizeEmail()` (lowercased; for gmail, dots and the `+tag` are stripped → `johndoe@gmail.com`). Confirm this is acceptable, since users may not recognize it.
**Business Rule**: Validator `.normalizeEmail()`
**Suggested Layer**: API

---

### TC-406: Phone with punctuation only
**Category**: Edge Case
**Priority**: P3
**Preconditions**: Valid token
**Steps**:
1. Book with `customerPhone: "----------"` and with `"+91 (98) 765-43210"`
**Expected Results**: The second is accepted. The first is **also accepted** by the current regex (10 chars, no digits), which contradicts the "min 10 digits" rule; flag it.
**Business Rule**: Phone min 10 digits
**Suggested Layer**: API

---

### TC-407: Fractional price display rounding
**Category**: Edge Case
**Priority**: P3
**Preconditions**: User-created event with price 0.5
**Steps**:
1. Book quantity 3 → `totalPrice` 1.5
2. View the card and detail
**Expected Results**: The API returns 1.5. The UI shows "$2" (`maximumFractionDigits: 0`) and the price per ticket shows "$1" (or "$0"), so the displayed per-ticket × qty ≠ total. Flag the display inconsistency.
**Business Rule**: Price calculation display
**Suggested Layer**: E2E

---

### TC-408: Ref prefix for non-letter titles
**Category**: Edge Case
**Priority**: P2
**Preconditions**: Own events titled "2026 Expo" and "ébène fest"
**Steps**:
1. Book each
**Expected Results**: Refs start with "2-" and "É-". Note: the "É" prefix falls outside the `[A-Z0-9]` charset used by the random part, which may break consumers using `/^[A-Z0-9]-/`.
**Business Rule**: `eventTitle[0].toUpperCase()`
**Suggested Layer**: API

---

### TC-409: Same user books the same event multiple times
**Category**: Edge Case
**Priority**: P2
**Preconditions**: Logged in
**Steps**:
1. Book event X (qty 2), then X again (qty 3)
**Expected Results**: Two separate bookings with distinct refs. Seats drop by 5 in total. Cancelling one restores only its own quantity.
**Business Rule**: Per-user availability allows repeat bookings
**Suggested Layer**: API

---

### TC-410: Concurrent bookings at the cap **[DISCREPANCY D3]**
**Category**: Edge Case
**Priority**: P2
**Preconditions**: User has 8 bookings
**Steps**:
1. Fire 3 `POST /api/bookings` in parallel (`Promise.all`)
2. `GET /api/bookings`
**Expected Results**: Per rule the total is ≤ 9. The code has no transaction, so 10 or 11 is possible. Record the observed count. Run several times.
**Business Rule**: Max 9 bookings
**Suggested Layer**: API

---

### TC-411: Ref lookup is case-sensitive?
**Category**: Edge Case
**Priority**: P3
**Preconditions**: Booking with ref `T-AB12CD`
**Steps**:
1. `GET /api/bookings/ref/t-ab12cd`
**Expected Results**: Document the behavior. MySQL's default collation is case-insensitive, so a lowercase lookup may return 200.
**Business Rule**: Ref uniqueness
**Suggested Layer**: API

---

### TC-412: Clear all with 0 bookings
**Category**: Edge Case
**Priority**: P3
**Preconditions**: No bookings
**Steps**:
1. `DELETE /api/bookings`; in the UI, click "Clear all bookings" on the empty state and accept
**Expected Results**: The API returns 200 "0 booking(s) cleared". The UI stays on the empty state with no error.
**Business Rule**: Clear all
**Suggested Layer**: API + E2E

---

### TC-413: Booking a past event
**Category**: Edge Case
**Priority**: P3
**Preconditions**: A user event whose date has passed (if achievable, e.g. via DB) or a stale event
**Steps**:
1. `POST /api/bookings` for it
**Expected Results**: Document the behavior. The service has no date check, so it probably succeeds.
**Business Rule**: Event date must be future (event creation only)
**Suggested Layer**: API

---

## UI State

### TC-500: Bookings list loading skeleton
**Category**: UI State
**Priority**: P3
**Preconditions**: Logged in
**Steps**:
1. Delay `**/api/bookings*` by 2s via `page.route`
2. Open `/bookings`
**Expected Results**: 5 pulsing skeleton cards are shown, then the real cards replace them.
**Business Rule**: Loading state
**Suggested Layer**: E2E (mocked)

---

### TC-501: Empty state
**Category**: UI State
**Priority**: P1
**Preconditions**: No bookings
**Steps**:
1. Open `/bookings`; click "Browse Events"
**Expected Results**: "No bookings yet" and "You haven't booked any events yet…" are shown. The button navigates to `/events`. "Clear all bookings" is still shown.
**Business Rule**: Empty state
**Suggested Layer**: E2E

---

### TC-502: Detail page loading spinner
**Category**: UI State
**Priority**: P3
**Preconditions**: Booking exists
**Steps**:
1. Delay `**/api/bookings/<id>` and open the detail page
**Expected Results**: A centered large spinner is shown, then the content.
**Business Rule**: Loading state
**Suggested Layer**: E2E (mocked)

---

### TC-503: Cancel confirmation dialog content
**Category**: UI State
**Priority**: P1
**Preconditions**: Booking with ref R, quantity Q
**Steps**:
1. Click "Cancel Booking" on the detail page; repeat on a list card
**Expected Results**: Title "Cancel this booking?". The detail page shows "Cancelling R will release Q seat(s) back to the event. This cannot be undone." and the card shows "This will cancel R and release Q seat(s)…". Buttons are a secondary close/cancel and "Yes, cancel it".
**Business Rule**: Confirm before destructive action
**Suggested Layer**: E2E

---

### TC-504: Dismissing the cancel dialog keeps the booking
**Category**: UI State
**Priority**: P1
**Preconditions**: Booking exists
**Steps**:
1. Open the dialog and close it via the secondary button
2. Reopen it and press Escape / click the overlay
**Expected Results**: The dialog closes, no DELETE request is sent (assert via `page.waitForRequest` absence / route spy) and the booking is still shown.
**Business Rule**: Confirm dialog
**Suggested Layer**: E2E

---

### TC-505: Dialog is locked while cancellation is pending
**Category**: UI State
**Priority**: P3
**Preconditions**: Delay `DELETE **/api/bookings/*` via route
**Steps**:
1. Click "Yes, cancel it"; try the close button and Escape while pending
**Expected Results**: The confirm button shows a loading state and the close button is disabled. The dialog cannot be dismissed (`onClose` is undefined while loading). Only one DELETE is sent.
**Business Rule**: `ConfirmDialog isLoading`
**Suggested Layer**: E2E (mocked)

---

### TC-506: Dismissing the clear-all native confirm keeps bookings
**Category**: UI State
**Priority**: P1
**Preconditions**: ≥1 booking
**Steps**:
1. `page.once('dialog', d => d.dismiss())`; click "Clear all bookings"
**Expected Results**: No `DELETE /api/bookings` is sent and all cards remain.
**Business Rule**: `confirm()` guard
**Suggested Layer**: E2E

---

### TC-507: "Clearing…" in-progress state
**Category**: UI State
**Priority**: P3
**Preconditions**: Delay `DELETE **/api/bookings`
**Steps**:
1. Accept the confirm dialog after clicking "Clear all bookings"
**Expected Results**: The button text is "Clearing…" and it is disabled. It reverts once the request completes.
**Business Rule**: Clear-all UI feedback
**Suggested Layer**: E2E (mocked)

---

### TC-508: Refund button hidden after the check starts
**Category**: UI State
**Priority**: P2
**Preconditions**: Detail page
**Steps**:
1. Click the refund button
**Expected Results**: `check-refund-btn` is hidden during the spinner and after the result. It cannot be re-triggered without a reload.
**Business Rule**: Refund state machine idle → checking → result
**Suggested Layer**: E2E / Component

---

### TC-509: Access Denied vs Not Found states are distinct
**Category**: UI State
**Priority**: P1
**Preconditions**: Mock `GET **/api/bookings/1` to return 403, then 404
**Steps**:
1. Open `/bookings/1` under each mock
**Expected Results**: 403 shows "Access Denied" / "You are not authorized to view this booking.". 404 shows "Booking not found". Both have a "View My Bookings" button that goes to `/bookings`.
**Business Rule**: `error.status === 403` branch
**Suggested Layer**: E2E (mocked)

---

### TC-510: Pagination control visibility **[DISCREPANCY D5]**
**Category**: UI State
**Priority**: P3
**Preconditions**: Mock `GET **/api/bookings*` to return `pagination: { total: 25, page: 1, limit: 10, totalPages: 3 }`
**Steps**:
1. Open `/bookings`; click page 2
**Expected Results**: The pagination control renders. Clicking page 2 updates the URL to `?page=2` and requests `page=2`. With real data (≤9 bookings) the control is never shown (`totalPages <= 1` → null).
**Business Rule**: Pagination
**Suggested Layer**: E2E (mocked)

---

### TC-511: No sandbox banner on the bookings page **[DISCREPANCY D6]**
**Category**: UI State
**Priority**: P3
**Preconditions**: User has 8–9 bookings
**Steps**:
1. Open `/bookings`; then open `/events`
**Expected Results**: Per the domain doc, a limit banner should appear on `/bookings`. In the actual code there is none; only `/events` shows "Your sandbox holds up to 9 bookings…". Confirm the intended behavior with product before automating.
**Business Rule**: Sandbox warning banners
**Suggested Layer**: E2E

---

### TC-512: Cancel/clear refreshes dependent views
**Category**: UI State
**Priority**: P2
**Preconditions**: Booking for event X (qty 2)
**Steps**:
1. Open `/events/X` and note the seats; go to `/bookings` and cancel the booking from the card; navigate back to `/events/X` (client-side navigation, no reload)
**Expected Results**: The seats shown are +2. React Query invalidated both `['bookings']` and `['events']`.
**Business Rule**: Seats freed immediately
**Suggested Layer**: E2E

---

## Summary

| Category | Count | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| Happy Path | 8 | 6 | 1 | 1 | 0 |
| Business Rule | 13 | 5 | 4 | 2 | 2 |
| Security | 11 | 6 | 3 | 2 | 0 |
| Negative | 12 | 0 | 6 | 4 | 2 |
| Edge Case | 14 | 0 | 4 | 4 | 6 |
| UI State | 13 | 0 | 5 | 2 | 6 |
| **Total** | **71** | **17** | **23** | **15** | **16** |

Tests marked as mutating shared seed data (TC-101 on static events, TC-206) must not run against the production `baseURL`. Use user-created events or a local environment.
