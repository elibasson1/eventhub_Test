# EventHub — Booking Management Test Strategy

Generated: 2026-10-31
Input: `docs/test-scenarios.md` (2026-10-31, 71 scenarios, TC-001 to TC-512, discrepancies D1–D8)
Scope: Booking scenarios only. Supersedes the 2026-03-06 strategy, which was written against an older scenario set whose IDs no longer match.

Sources scanned: `backend/src/services/bookingService.js`, `backend/src/controllers/bookingController.js`, `backend/src/routes/bookingRoutes.js`, `backend/src/validators/bookingValidator.js`, `backend/src/repositories/bookingRepository.js`, `backend/src/repositories/eventRepository.js`, `backend/src/middleware/authMiddleware.js`, `backend/src/middleware/errorHandler.js`, `frontend/app/bookings/page.tsx`, `frontend/app/bookings/[id]/page.tsx`, `frontend/components/bookings/BookingCard.jsx`, `frontend/components/ui/ConfirmDialog.jsx`, `frontend/components/ui/Pagination.jsx`, `frontend/lib/hooks/useBookings.ts`, `frontend/lib/api/bookingsApi.js`, `frontend/lib/api/bookings.ts`, `tests/booking-management.spec.js`.

---

## 1. Layer Distribution Summary

Each scenario has exactly one **primary** layer, the place where its main proof lives. Critical rules also get **secondary** coverage at other layers for defense-in-depth. "Test cases" estimates the individual `test()` blocks after data-driven expansion (validator matrices, token variants, and so on).

| Layer | Primary TCs | Incl. secondary | Est. test cases | Focus | Approx. run time |
|---|---|---|---|---|---|
| **Unit** | 4 | 17 | ~45 | `randomRef`/`generateUniqueRef`, `createBooking` orchestration with mocked repositories (FIFO selection, prune ordering, fallback), validator chain, refund + price-format pure functions | < 2s |
| **API / Integration** | 35 | 37 | ~60 | HTTP contract, auth/403/404, FIFO against a real DB, seat release, cascades, input robustness | 30–90s |
| **Component (route-mocked)** | 20 | 24 | ~24 | Single-page UI states driven by mocked `/api/bookings*` responses and `page.clock` | 30–60s |
| **E2E** | 9 | 10 | ~10 | Critical user journeys on real data, cross-user UI, cache invalidation across pages | 2–4 min |
| **Manual / deferred** | 3 | — | — | Would mutate shared prod seed data, needs DB access, or needs a product decision first | — |
| **Total** | **71** | | **~139** | | |

**Shape:** by test cases this is a pyramid (45 → 60 → 24 → 10). By scenario count the API layer is widest. That's expected for this domain: most booking rules (FIFO, per-user seats, cascades, isolation) are DB-bound, and a mocked unit test can only prove the orchestration order, not the persisted outcome. The unit layer covers the orchestration and the API layer covers the persisted outcome, so each layer proves something the other cannot.

### Layer definitions (how each layer runs in this repo)

| Layer | Runner and location | Notes |
|---|---|---|
| Unit (backend) | `node --test` in `backend/tests/unit/*.test.js`, run in `ci.yml` (already installs backend deps) | Mock repositories by reassigning methods on the exported `bookingRepository`/`eventRepository` objects (`mock.method` from `node:test`). The service holds references to the same objects, so no DI refactor is needed. |
| Unit (frontend pure fns) | Playwright runner, browserless, `tests/unit/*.spec.js` | Needs no extra deps. Only for pure functions extracted to plain `.js` (see prerequisites). |
| API | Playwright `request` fixture, `tests/api/bookings.api.spec.js` | Get the token from `POST /api/auth/login` in `beforeAll`. Read the API base URL from an `API_URL` env var. The production API host is not recorded in the repo (`client.js:3` falls back to localhost), so confirm it from the browser network tab. |
| Component (route-mocked) | Playwright `page` with `page.route()` + `page.clock`, `tests/components/booking-ui.spec.js` | There is no React component-test harness (`@playwright/experimental-ct-react` isn't installed, and the pages depend on App Router hooks + the React Query provider). Instead, load the real page with **all** booking API calls mocked so no backend state is touched. Auth: inject `eventhub_token` into `localStorage` via `addInitScript`, mock `/api/auth/me` if the AuthGuard calls it, and skip the UI login. |
| E2E | Playwright `page`, `tests/booking-management.spec.js` | Real backend (production `baseURL`). Do setup and teardown through the API (`request`) wherever the UI isn't what's under test. |

---

## 2. Prerequisites (block the Unit layer)

| # | Change | Why | Unblocks |
|---|---|---|---|
| P1 | Export the helpers from `bookingService.js` without breaking the default export: `module.exports = bookingService; module.exports._internal = { randomRef, generateUniqueRef, MAX_USER_BOOKINGS };` | `randomRef` (`bookingService.js:11`) and `generateUniqueRef` (`:21`) are module-private today | TC-102, TC-408 unit |
| P2 | Replace `prisma.booking.create(...)` at `bookingService.js:103` with the existing `bookingRepository.create(...)` (`bookingRepository.js:49`) | The service bypasses its own repository, which breaks the strict layering in CLAUDE.md. Mocking a Prisma model delegate is fragile; mocking a repository method is trivial. | All `createBooking` unit tests |
| P3 | Extract `getRefundStatus(quantity)` from `RefundEligibility` (`[id]/page.tsx:27`) and a shared `formatPrice(n)` (duplicated at `BookingCard.jsx:11` and `[id]/page.tsx:17`) into `frontend/lib/utils/booking.js` | Inline logic can't be unit-tested. The price formatter is duplicated and the copies can drift. | TC-103/104/403 unit, TC-407 unit |
| P4 | Add a `@local-only` tag + `grep-invert` in `playwright.yml` | Some scenarios must never run against prod (TC-206, TC-410 at scale) | Safe CI |
| P5 | Use a second account `rahulshetty1@yahoo.com` / `Magiclife1!` (seeded in `backend/prisma/seed.js:8`) | Cross-user scenarios need User B | TC-200–204, TC-209 |

Until P1–P3 land, `/generate-tests` should generate the API, Component and E2E layers and leave Unit as a `test.fixme` skeleton.

---

## 3. Layer Assignments

`P` = primary, `S` = secondary (defense-in-depth).

### 3.1 Unit

| TC | Role | Subject under test | Source | What to assert |
|---|---|---|---|---|
| TC-102 | P | `randomRef(title)` | `bookingService.js:11-18` | `'Tech…'` → `/^T-[A-Z0-9]{6}$/`; `'zebra night'` → `Z-`; `undefined`/`''` → `E-` fallback (`?? 'E'`). Run 1,000 iterations and check the charset. |
| TC-102 | P | `generateUniqueRef(title)` | `bookingService.js:21-32` | Stub `findByRef` to return a hit 3× then `null` → 4 calls, returns the 4th ref. Stub it to always hit → after 10 attempts it falls back to `X-<base36>` (prefix still matches). |
| TC-408 | P | `randomRef` | `bookingService.js:12` | `'2026 Expo'` → `2-`; `'ébène fest'` → `É-` (document that the prefix falls outside `[A-Z0-9]`). |
| TC-403 | P | `getRefundStatus(q)` (after P3) | `[id]/page.tsx:27` | `1` → eligible; `2` → ineligible (boundary); `10` → ineligible. |
| TC-407 | P | `formatPrice(n)` (after P3) | `BookingCard.jsx:11`, `[id]/page.tsx:17` | `1.5` → `$2`, `0.5` → `$1` or `$0` (rounding mode, `maximumFractionDigits: 0`). Record that per-ticket × qty ≠ displayed total. |
| TC-103, TC-104 | S | `getRefundStatus` | as above | Covered by the TC-403 parameter table. |
| TC-100 | S | `createBooking` with mocked repos | `bookingService.js:70-79` | `countUserBookings → 9`, `findOldestUserBookingExcludingEvent → {id: 1, eventId: 5}` → `delete(1)` called; `findOldestUserBooking` **not** called. |
| TC-101 | S | `createBooking` same-event fallback | `bookingService.js:73-76, 95-97` | Excluding-event returns `null`, fallback returns the same `eventId` → `eventRepository.decrementSeats(eventId, qty)` called once. With a different-event prune → not called. |
| TC-400 | S | cap boundary | `bookingService.js:72` | `count = 8` → no `delete`; `count = 9` → one `delete`. |
| TC-302 | S | prune-before-seat-check (D2) | `bookingService.js:72-91` | count 9, event has 2 seats, qty 5 → rejects `InsufficientSeatsError` **and** `delete` was called. This test documents the defect: assert the *intended* behavior (`delete` not called) and mark it `test.fail()` until fixed. |
| TC-303 | S | prune-before-event-check (D2) | `bookingService.js:82-83` | `eventRepository.findById → null` → `NotFoundError`, `delete` called (defect; same `test.fail()` treatment). |
| TC-106 | S | price calc | `bookingService.js:99` | `price: '299.00'` (Prisma Decimal arrives as a string), qty 3 → `create` receives `totalPrice: 897`. |
| TC-202 | S | `cancelBooking` scoping (D1) | `bookingService.js:126-129` | `findById(id, userId)` is user-scoped → returns `null` for another user's booking → `NotFoundError`. The `ForbiddenError` branch at `:129` is dead code. |
| TC-304 | S | `validateCreateBooking` chain | `bookingValidator.js:15-44` | Run each chain via `await chain.run(req)` + `validationResult` over the full invalid matrix (eventId, name, email, phone, quantity). |
| TC-405 | S | `.normalizeEmail()` | `bookingValidator.js:30` | `John.Doe+test@GMAIL.com` → `johndoe@gmail.com`. |
| TC-406 | S | phone regex | `bookingValidator.js:35-36` | `'----------'` passes (defect: no digit requirement); `'+91 (98) 765-43210'` passes; `'12345abcde'` fails. |

### 3.2 API / Integration

All requests go through `router.use(authMiddleware)` (`bookingRoutes.js:8`). Domain errors map in `errorHandler.js` (`ForbiddenError` → 403 `:15`, `NotFoundError` → 404 `:19`, `InsufficientSeatsError` → 400 `:23`, Prisma `P2025` → 404 `:44`).

#### Contract (happy path)
| TC | Role | Endpoint(s) | Service / controller | Key assertions |
|---|---|---|---|---|
| TC-008 | P | `GET/POST/DELETE /api/bookings`, `GET /:id`, `GET /ref/:ref`, `DELETE /:id` | `bookingController.js:4-56` | Status codes 200/201; `{ success, data, pagination{total,page,limit,totalPages} }`; nested `event`; messages `"Booking confirmed!"`, `"Booking cancelled"`, `"N booking(s) cleared"`. Also assert `createdAt desc` ordering (`bookingRepository.js:19`), so TC-001 doesn't have to. |
| TC-102 | S | `POST /api/bookings` | `generateUniqueRef` via `createBooking:100` | Static "Tech Conference Bangalore" → `T-`, "AI Summit Hyderabad" → `A-`, own event "zebra night" → `Z-`. |
| TC-408 | S | `POST /api/bookings` on own event "2026 Expo" | as above | Ref starts `2-`. Proves the unit result survives the real path. |
| TC-106 | P | `POST /api/bookings` (Digital Marketing Workshop, qty 3) | `createBooking:99` | `totalPrice === 897`. |
| TC-402 | P | `POST` qty 1 and qty 10 | `bookingValidator.js:40` | Both 201; totals = price × qty. |
| TC-409 | P | Two `POST`s to the same event | `getBookedQuantitiesForEvents` (`bookingRepository.js:91`) | Distinct refs; `GET /api/events/:id` seats −5; cancel one → +its own qty only. |

#### Business rules (DB-dependent)
| TC | Role | Setup → action | Code path | Key assertions |
|---|---|---|---|---|
| TC-100 | P | Clear; B1 on event A, B2–B9 on event B; 10th on B | `findOldestUserBookingExcludingEvent` (`bookingRepository.js:79`) | Count 9; B1 gone; B2–B9 + new remain. |
| TC-101 | P | Own event E; 9× qty 1 on E; 10th on E; clear all | `sameEventFallback` → `eventRepository.decrementSeats` (`eventRepository.js:68`) | After clear, `availableSeats === S − 1`. **Own event only**, never static (see TC-206). |
| TC-400 | P | Create 9 across events | `bookingService.js:72` | All 9 present; first still present. |
| TC-401 | P | 8 → 9 → 10 → 11 | FIFO | Counts 8, 9, 9, 9; the 10th removes the 1st and the 11th removes the 2nd. |
| TC-107 | P | Book qty 4 on a static and an own event; cancel | per-user computed seats (`eventService.js:5-16`) | `GET /api/events/:id` shows S − 4 and then S again. |
| TC-109 | P | X qty 2, Y qty 3; `DELETE /api/bookings` | `clearAllBookings` (`bookingService.js:121`) | X +2, Y +3. |
| TC-110 | P | Own event E with 2 bookings + 1 static booking; `DELETE /api/events/E` | Prisma cascade on `Booking.eventId` | `GET /api/bookings` has only the static booking; old ids → 404. |
| TC-111 | P | 6 own events, oldest has a booking; create a 7th | `MAX_USER_DYNAMIC_EVENTS` (`eventService.js:20,51`) + cascade | Oldest event's booking gone. Slow (≈8 calls); tag `@slow`. |
| TC-112 | P | `?status=confirmed`, `?status=cancelled`, `?eventId=` | `bookingRepository.findAll:11-12` | All / `[]` / event-scoped. |
| TC-108 | P | 9 bookings; `GET` default and `?limit=5&page=2` | `getBookings:38-50` | Default `limit` 10, `totalPages` 1; page 2 → 4 items, `totalPages` 2 (D5). |

#### Security
| TC | Role | Endpoint | Enforcement | Key assertions |
|---|---|---|---|---|
| TC-201 | P | B → `GET /:id`, `GET /ref/:ref` of A's booking | `getBookingById:57`, `getBookingByRef:64` | 403; exact messages; no `data` in body. |
| TC-202 | P | B → `DELETE /:id` of A's booking | `cancelBooking:127` (scoped `findById`) | **404** (D1, documented, not the 403 in the domain doc). Then A → `GET /:id` → 200 (still exists). |
| TC-203 | P | B → `DELETE /api/bookings` | `deleteAllForUser` (`bookingRepository.js:60`) | A's count unchanged. |
| TC-204 | P | B → `GET /api/bookings` | `findAll where: { userId }` (`bookingRepository.js:9`) | No A refs or ids. |
| TC-205 | P | 5 endpoints × {no header, `Bearer garbage`, wrong-secret JWT, expired JWT} | `authMiddleware.js:6-14` | 401 everywhere: `"Unauthorized"` for a missing header, `"Invalid or expired token"` otherwise. Data-driven, about 20 cases. |
| TC-207 | P | `POST` with extra `userId`, `status`, `totalPrice`, `bookingRef` | `createBooking:103-115` builds the record from whitelisted fields | 201; caller's `userId`, `confirmed`, computed total, generated ref. |
| TC-209 | P | B → `POST` on A's private event | `eventRepository.findById(id, userId)` → `NotFoundError` (`bookingService.js:82-83`) | 404; B's booking count unchanged (make sure B has < 9 so D2 doesn't interfere). |
| TC-210 | P | `GET /ref/' OR 1=1 --`, `/ref/%25` | Prisma `findUnique` (parameterized) | 404, never 500. |
| TC-208 | S | `POST` with `customerName: "<img src=x onerror=alert(1)>"` | — | Stored verbatim (the API doesn't sanitize, and the UI must escape it; see Component TC-208). |

#### Negative / validation
| TC | Role | Request | Code | Key assertions |
|---|---|---|---|---|
| TC-301 | P | `GET /99999999`, `GET /ref/Z-000000`, `DELETE /99999999` | `NotFoundError` | 404, `success: false`. |
| TC-302 | P | 9 bookings; own event with 2 seats; qty 5 | D2 | 400 `"Only 2 seat(s) available, but 5 requested"`; count **8** (defect). Mark `test.fail()` against the intended 9. |
| TC-303 | P | 9 bookings; `eventId: 99999999` | D2 | 404; count 8 (defect, same treatment). |
| TC-304 | P | Representative invalid payload per field (≈6) | `handleValidationErrors` (`bookingValidator.js:3-13`) | 400 `{ error: "Validation failed", details[{field,message}] }`; count unchanged **at 9** (proves the validator runs before the FIFO prune). The full matrix lives in Unit. |
| TC-305 | P | Own event with 3 seats; qty 3 then qty 1 | `personalAvailable` (`bookingService.js:87`) | Second request → 400 `"Only 0 seat(s)…"`. |
| TC-306 | P | `DELETE /:id` twice | `cancelBooking:128` | Second → 404. |
| TC-310 | P | `GET /abc`, `/-1`, `/1.5`, `DELETE /abc` | `Number('abc')` → `NaN` into Prisma (`bookingRepository.js:37`) | 400 or 404, **never 500**. Likely to find a bug. |
| TC-311 | P | `?page=-1`, `abc`, `limit=0`, `-5`, `100000` | `getBookings:38-39`, `findAll:8` (`skip` negative) | No 500. `page=-1` gives `skip = -20` and Prisma throws → expect a 500 today. No cap on `limit`. |
| TC-405 | P | Email `John.Doe+test@GMAIL.com` | `.normalizeEmail()` | Stored as `johndoe@gmail.com`. |
| TC-406 | P | Phone `'----------'` | regex `bookingValidator.js:36` | 201 today (defect: no digits required). |
| TC-411 | P | `GET /ref/<lowercased ref>` | MySQL collation | Document the observed status. |
| TC-412 | P | `DELETE /api/bookings` with 0 bookings | `clearAllBookings` | 200 `"0 booking(s) cleared"`. |
| TC-410 | P | 8 bookings; 3 parallel `POST`s | No transaction around `bookingService.js:70-116` (D3) | Record the final count (≤ 9 expected). Tag `@flaky @exploratory`, excluded from the gating run. |

### 3.3 Component (route-mocked)

All tests mock every `/api/bookings*` call with `page.route()`, so they never touch production data. Use `page.clock.install()` + `clock.fastForward(4000)` for the refund timer, and never `waitForTimeout`.

#### Booking detail — `BookingDetailPage` / `RefundEligibility` (`frontend/app/bookings/[id]/page.tsx`)
| TC | Role | Mock | Code branch | Assertions |
|---|---|---|---|---|
| TC-103 | P | booking `quantity: 1` | `RefundEligibility:21-71` | Click `check-refund-btn` → `refund-spinner` "Checking your refund eligibility…" → fast-forward 4s → `refund-result` "Eligible for refund." (D7: button text "Check eligibility for refund?"). |
| TC-104 | P | `quantity: 3` | `:61-67` | "Group bookings (3 tickets) are non-refundable." |
| TC-403 | S | `quantity: 2` | `quantity === 1` (`:27`) | Ineligible, with "(2 tickets)". |
| TC-105 | P | `quantity: 1` | `setTimeout(…, 4000)` (`:26`) | At 3,999ms the spinner is visible and there's no result; at 4,000ms the result is shown and the spinner gone. |
| TC-508 | P | any | `status === 'idle'` (`:35`) | Button hidden during checking and after the result. |
| TC-404 | P | any | state is not persisted | Reload → button shown again. Start the check, navigate away, come back → no console errors (`page.on('pageerror')`). |
| TC-502 | P | delay the `GET /bookings/:id` response (hold the route until released) | `isLoading` (`:114-116`) | Large spinner shown, then content. |
| TC-509 | P | `GET /bookings/1` → 403, then → 404 | `is403` (`:119-128`) | "Access Denied" / "You are not authorized…" vs "Booking not found". Both have a "View My Bookings" → `/bookings` link. |
| TC-300 | P (merged into TC-509) | 404 | same | Covered by the 404 half of TC-509. |
| TC-503 | P | booking ref R, qty Q, on both detail and list | `ConfirmDialog` descriptions: `[id]/page.tsx:221`, `BookingCard.jsx:96` | Title "Cancel this booking?"; the two description variants; buttons "Cancel" and "Yes, cancel it". |
| TC-504 | P | any; spy on `DELETE` | `onClose` (`ConfirmDialog.jsx:17,20`) | Close via the secondary button, Escape, and overlay → zero `DELETE` requests. |
| TC-505 | P | hold `DELETE /bookings/:id` | `isLoading` → `onClose` undefined (`ConfirmDialog.jsx:17`) | Cancel disabled; Escape doesn't close; exactly one `DELETE`. |
| TC-307 | P | `DELETE /bookings/:id` → 404 `"Booking with id X not found"` | `onError` (`[id]/page.tsx:107-110`) | Error toast with the message; dialog closed; URL unchanged. |
| TC-208 | P | booking with `customerName: "<img src=x onerror=alert(1)>"` on list + detail | React text escaping | Literal text visible; no `img[src="x"]`; a `page.on('dialog')` handler fails the test. |

#### Bookings list — `BookingsContent` (`frontend/app/bookings/page.tsx`) / `BookingCard`
| TC | Role | Mock | Code branch | Assertions |
|---|---|---|---|---|
| TC-500 | P | hold `GET /bookings` | `isLoading` (`page.tsx:66-70`) | 5 skeletons, then cards. |
| TC-501 | P | `data: []` | `:80-92` | "No bookings yet"; "Browse Events" → `/events`; "Clear all bookings" still visible. |
| TC-308 | P | 500, then unroute + Retry | `isError` (`:72-78`) | "Couldn't load bookings" + Retry → list loads. |
| TC-506 | P | spy on `DELETE /bookings` | `confirm()` guard (`:28`) | `dialog.dismiss()` → no `DELETE`; cards remain. |
| TC-507 | P | hold `DELETE /bookings` | `clearing` state (`:18, 60`) | Text "Clearing…", `disabled`; reverts afterwards. |
| TC-309 | P | `DELETE /bookings` → 500 | `try/finally` with no `catch` (`:30-35`) (D8) | Button reverts; cards remain; no error toast (UX gap); capture `pageerror` for the unhandled rejection. |
| TC-412 | S | `data: []`, `DELETE` → 200 `0 booking(s) cleared` | `:27-36` | Empty state persists; no error. |
| TC-510 | P | `pagination.totalPages: 3` | `Pagination.jsx:20`, `changePage` (`page.tsx:41-45`) | Control renders; page 2 → URL `?page=2` and a request with `page=2`. With `totalPages: 1` → no control (D5). |
| TC-402 | S | bookings qty 1 and qty 10 | `BookingCard.jsx:66` | "1 ticket" vs "10 tickets". |
| TC-407 | S | event price 0.5, qty 3, total 1.5 | `fmt_price` (`BookingCard.jsx:11`, `[id]/page.tsx:17`) | Card "$2"; detail per-ticket vs total inconsistency recorded. |
| TC-205 | S | any `/api/bookings*` → 401 | 401 interceptor in `frontend/lib/api/client.js` | Redirect to `/login`; `localStorage.eventhub_token` removed. |
| TC-305 | S | `GET /events/:id` with `availableSeats: 0` | event detail page | "Sold Out"; Confirm button disabled. |

### 3.4 E2E (real backend)

Setup and teardown go through the API (`request` + token) unless the UI action is what's under test. Every test starts with `DELETE /api/bookings` via the API instead of the UI `clearBookings()` helper.

| TC | Role | Journey | Why it must be E2E |
|---|---|---|---|
| TC-001 | P | Login → `/bookings` → card fields | Critical P0: proves real data renders through the real client (`bookingsApi.js` + `useBookings`). |
| TC-002 + TC-007 | P | List → "View Details" → all sections → "← Back to My Bookings" → breadcrumb link | Critical P0 navigation; TC-007 folds in as two extra steps (no extra login). |
| TC-003 | P | Detail → Cancel → "Yes, cancel it" → toast + redirect → ref gone | Destructive P0 action; checks the `onSuccess` → `router.push('/bookings')` chain. |
| TC-004 | P | Card cancel with ≥ 2 bookings → stays on `/bookings`, only that card disappears | Separate code path (`BookingCard.jsx:35-40`, no redirect) plus a real `['bookings']` refetch. |
| TC-005 | P | "Clear all bookings" → accept native confirm → empty state | Uses `bookings.ts` → `client.ts`, a **different API module** from the rest of the page (`page.tsx:11` vs `useBookings.ts:3`). Only a real call proves that module's base URL + auth header work. |
| TC-006 | P | Book from `/events/:id` → "View My Bookings" → first card has the same ref | Multi-page full-stack journey. |
| TC-102 | S | During TC-006, assert the ref regex on the confirmation card **and** that the same ref appears on the list card and detail page | Unit and API prove the generation rule; only E2E proves the three UI locations agree. |
| TC-200 | P | A creates a booking (API) → B logs in in a new `browser.newContext()` → `/bookings/<A's id>` | Real 403 from the real backend rendered in the real UI. TC-509 covers the branch with mocks, and this proves the backend actually returns 403 for that route. |
| TC-512 | P | `/events/X` seats → cancel from the card → client-side navigation back to `/events/X` → seats +2 | Proves React Query invalidates `['events']` in `useCancelBooking` (`useBookings.ts:40-41`) against real computed seats. A stateful mock would just re-implement the backend. |

### 3.5 Manual / deferred

| TC | Reason | Recommendation |
|---|---|---|
| TC-206 | The same-event fallback on a **static** event permanently reduces seats for every user (D4). Automating it against prod corrupts shared seed data. | Manual check in a local or disposable env only. Report D4 as a defect. TC-101 (own event) plus the Unit fallback test cover the mechanism safely. |
| TC-413 | Event creation validates future dates, so a past event can only be made through the DB | Local env with a direct DB seed, tagged `@local-only`. |
| TC-511 | The domain doc says there's a banner on `/bookings` and the code has none (D6). Testing either way encodes a guess. | Get a product decision first, then add a single Component assertion. |

---

## 4. Decision Rationale: Contested Assignments

### Refund eligibility (TC-103, TC-104, TC-105, TC-403, TC-404, TC-508): Unit + Component, not E2E
The scenarios suggest E2E. `RefundEligibility` (`[id]/page.tsx:21-71`) makes no network call: it's a `useState` machine with a `setTimeout(…, 4000)`. A real-data E2E test pays for login, booking creation and a 4-second wait per case to test logic the backend never sees. The pure decision (`quantity === 1`) goes to Unit after P3. The rendering and the timer go to Component, using `page.clock` so the 4s wait becomes instant and the boundary (3,999ms vs 4,000ms) can be asserted exactly. The E2E suite keeps only the existing check that `#check-refund-btn` is visible in TC-002.

### Validation (TC-304, TC-405, TC-406): Unit matrix + thin API, never E2E
`validateCreateBooking` (`bookingValidator.js:15-44`) is an express-validator chain that runs before the controller. The ~15-case matrix goes to Unit (`chain.run(req)`). API keeps about 6 representative cases because the 400 response shape (`handleValidationErrors`, `:3-13`) is a contract, and because only a real request proves the validator runs **before** the FIFO prune (count stays 9). E2E for these would only exercise the UI form's own client-side validation, which isn't the server rule.

### FIFO pruning (TC-100, TC-101, TC-302, TC-303, TC-400, TC-401): Unit + API, no E2E
`createBooking` (`bookingService.js:68-119`) orders five repository calls. With mocked repositories, Unit can prove *which* booking is selected, *whether* `decrementSeats` fires, and the defective ordering D2 (prune before the event and seat checks). Those are exact call-order assertions an API test can only infer. API proves the persisted outcome on MySQL. E2E adds nothing: the UI just lists whatever `GET /api/bookings` returns, and seeding 9 bookings through the UI would take minutes.

### Discrepancy scenarios (TC-202/D1, TC-302/TC-303/D2, TC-406, TC-310, TC-311): assert intended behavior, mark `test.fail()`
Writing these to match current behavior would lock defects into the suite as passing tests. Writing them to the rule and marking them `test.fail()` keeps CI green, documents the gap, and automatically flags "now passing" once a fix ships. The exception is TC-202: assert **non-2xx + booking survives** as the hard requirement, and record 404 vs 403 as a soft annotation. The security property (B can't delete A's booking) holds; only the status code differs from the doc.

### Cross-user access (TC-200 vs TC-201 vs TC-509): all three layers
TC-201 (API) proves the 403 for `GET /:id` and `GET /ref/:ref`. TC-509 (Component) proves the UI branch `is403` (`[id]/page.tsx:119`) renders "Access Denied" and not "not found". TC-200 (E2E) is kept because it's the only test proving the two connect: the axios client (`client.js`) preserves `error.status` when it unwraps the response. If `client.js` changes how it shapes errors, TC-509's mocks would still pass and only TC-200 would catch it. That justifies one slow two-context test for a P0 security rule.

### TC-204 (list isolation): API only, scenario says API + E2E
The list renders `data` verbatim from `GET /api/bookings`. The isolation boundary is `where: { userId }` in `bookingRepository.findAll:9`. Once the API returns only B's bookings, rendering cannot add A's. An E2E check would need A's bookings to exist at the same time and adds no new failure mode.

### TC-208 (stored XSS): API (stored) + Component (rendered), not E2E
The risk is in rendering, not storage. A route-mocked page with the payload in `customerName` proves React escapes it on both the list and detail pages. The API test confirms the payload round-trips unsanitized, which is the precondition that makes the rendering test meaningful.

### TC-300 merged into TC-509
Both assert the "Booking not found" EmptyState from the same branch (`[id]/page.tsx:118-128`). TC-509 already mocks the 404, and a separate real-backend navigation to `/bookings/99999999` would only re-test TC-301 (API).

### TC-307 (stale cancel): Component, scenario says E2E
The behavior under test is `onError` → toast + close dialog (`[id]/page.tsx:107-110`). Deleting the booking in the background through the API and racing the UI is timing-sensitive. Mocking `DELETE` → 404 tests the same branch deterministically. The backend 404 itself is TC-306 (API).

### TC-305, TC-402, TC-407, TC-412: split by what each half tests
Each of these scenarios combines a server rule (seat check, quantity bounds, `totalPrice`, clear-all count) with a display concern (Sold Out, "1 ticket"/"10 tickets", `$` rounding, empty state). The server half goes to API and the display half to Component with a mocked payload. Neither half needs a real multi-page journey.

### TC-005 stays E2E even though it's "just a button"
`page.tsx:11` imports `bookingsApi` from `@/lib/api/bookings` (`client.ts`), while every other bookings call goes through `bookingsApi.js` (`client.js`). Two HTTP clients can differ in base URL, token handling and 401 behavior, and only a real request proves the clear-all client works in production. Flag this for the devs as consolidation debt.

### TC-512 stays E2E
Its purpose is cross-page cache invalidation against real computed seats (`eventService.js:5-16`). Mocking it would mean writing a stateful fake of the per-user seat calculation, which is more complex and less trustworthy than one real E2E run.

---

## 5. Anti-Patterns in Existing Tests (`tests/booking-management.spec.js`)

| # | Anti-pattern | Location | Impact | Fix |
|---|---|---|---|---|
| A1 | **Pure logic tested only at E2E.** The booking-ref prefix is checked by booking a real event through the UI. | `:155-168` (TC-102) | ~10s and a prod booking per run to test `randomRef`, a 5-line pure function. A sold-out first event or a title starting with a non-letter changes what's tested. | Unit (P1) + API variants. Keep only the three-location consistency check in E2E (TC-006). |
| A2 | **Ice cream cone.** 6 of 6 booking tests are E2E, with zero API, Unit or Component tests. | whole file | No coverage of FIFO, isolation, validation, auth or any D1–D8 discrepancy. Every failure surfaces as a slow UI timeout. | Implement §3.1–3.3. |
| A3 | **Scenario ID drift.** The file's "TC-004" is clear-all (now **TC-005**). The comment "TC-003 + TC-506" refers to the old cancel-success TC-506, but **TC-506 is now "dismiss clear-all confirm"**. | `:170, :201` | Traceability matrices and `/review-tests` will mis-map coverage. | Rename: TC-004 → TC-005; remove the TC-506 reference from TC-003. |
| A4 | **Hardcoded `BASE_URL`** that duplicates `playwright.config.ts` `baseURL`. | `:3`, every `goto` | Can't point the suite at localhost or staging. | Use relative paths (`page.goto('/bookings')`), and `toHaveURL(/\/bookings$/)`. |
| A5 | **UI-driven setup and teardown.** `login()` + `clearBookings()` + `bookEvent()` through the UI in every test. | `:9-64` | Roughly 70% of each test's runtime is setup. A UI regression in `/events` fails every bookings test. | API setup (`POST /auth/login`, `DELETE /bookings`, `POST /bookings`) + token injection via `storageState`/`addInitScript`. Keep a UI booking only in TC-006. |
| A6 | **Swallowed visibility check for control flow:** `isVisible().catch(() => false)` | `:58` | `isVisible()` doesn't wait, so on a slow load it returns `false` before the list renders. The helper then assumes "not empty", clicks, and may wait on a dialog that never comes (flaky). | Replace with `DELETE /api/bookings` via API (A5). |
| A7 | **Non-deterministic test data.** "First event with Book Now" changes as seats are consumed (and D4 permanently burns static seats). | `:27-29, :128-130` | Assertions depend on whichever event is first today. | Book a fixed static event by title, or create an own event via API per test. |
| A8 | **CSS-class locators where better ones exist:** `span.font-mono.font-bold`, `.confirm-booking-btn`, `.booking-ref` | `:102, :43, :46` | Break on styling changes. | Request a `data-testid` for the detail ref badge. Use `getByRole('button', { name: 'Confirm Booking' })`. |
| A9 | **Duplicated booking flow.** TC-006 re-implements `bookEvent()` inline. | `:127-144` | Two copies drift. | Reuse the helper / a page object. |
| A10 | **Weak assertion in TC-003:** "No bookings yet" stands in for "this ref is gone". | `:198` | Passes for the wrong reason if the list fails to load and shows empty. | `expect(page.getByTestId('booking-card').filter({ hasText: bookingRef })).toHaveCount(0)` + API `GET /:id` → 404. |
| A11 | `console.log` left in tests | `:34, :49, :144, :167` | Noise in CI logs. | Remove or use `test.info().annotations`. |

**Critical-flow coverage gaps in E2E** (the rule "always need some E2E" is only partly met today): TC-004 (cancel from the card) and TC-200 (cross-user Access Denied) are P0 and have no test at any layer.

---

## 6. Defense-in-Depth Coverage Map

| Rule | Unit | API | Component | E2E |
|---|---|---|---|---|
| Ref prefix = uppercase first char of title | TC-102, TC-408 | TC-102, TC-408 | — | TC-102 (via TC-006) |
| Max 9 bookings, FIFO prefers a different event | TC-100, TC-400 | TC-100, TC-400, TC-401 | — | — |
| FIFO only on a successful create (D2) | TC-302, TC-303 | TC-302, TC-303, TC-304 | — | — |
| Same-event fallback burns seats (D4) | TC-101 | TC-101 (own event) | — | — (TC-206 manual) |
| totalPrice = price × qty | TC-106 | TC-106, TC-402 | TC-407 (display) | TC-001 (card total) |
| Refund: qty 1 eligible, > 1 not | TC-403 | — (client-only) | TC-103, TC-104, TC-403 | — |
| Cross-user access denied | TC-202 | TC-201, TC-202, TC-203, TC-204, TC-209 | TC-509 | TC-200 |
| Auth required | — | TC-205 | TC-205 (401 → /login) | — |
| Cancel/clear releases seats | — | TC-107, TC-109, TC-409 | — | TC-512 |
| Input validation | TC-304, TC-405, TC-406 | TC-304, TC-405, TC-406 | — | — |

---

## 7. Implementation Priority

**Tier 1, P0 (gate every push to `main`)**
- E2E: TC-001, TC-002(+007), TC-003, TC-004, TC-005, TC-006(+102), TC-200
- API: TC-008, TC-100, TC-107, TC-201, TC-202, TC-203, TC-204, TC-205
- Unit (after P1–P2): TC-102, TC-100 (mocked)

**Tier 2, P1 (CI on every PR)**
- API: TC-101, TC-106, TC-109, TC-110, TC-207, TC-208, TC-209, TC-301, TC-302, TC-303, TC-304, TC-305, TC-400, TC-401, TC-402
- Component: TC-103, TC-104, TC-208, TC-307, TC-501, TC-503, TC-504, TC-506, TC-509
- Unit: TC-403, TC-304 matrix, TC-302/303 ordering

**Tier 3, P2/P3 (nightly)**
- API: TC-108, TC-111 `@slow`, TC-112, TC-210, TC-306, TC-310, TC-311, TC-405, TC-406, TC-409, TC-411, TC-412, TC-410 `@exploratory`
- Component: TC-105, TC-308, TC-309, TC-404, TC-500, TC-502, TC-505, TC-507, TC-508, TC-510
- E2E: TC-512
- Unit: TC-407, TC-408, TC-405, TC-406

---

## 8. File Map for `/generate-tests`

| Layer | Test file | Runner | Key source files |
|---|---|---|---|
| Unit (backend) | `backend/tests/unit/bookingService.test.js`, `backend/tests/unit/bookingValidator.test.js` | `node --test` (add a `"test:unit"` script to `backend/package.json`; run in `ci.yml`) | `backend/src/services/bookingService.js`, `backend/src/validators/bookingValidator.js`, `backend/src/repositories/*.js` |
| Unit (frontend) | `tests/unit/booking-utils.spec.js` | Playwright (no `page` fixture) | `frontend/lib/utils/booking.js` (created by P3) |
| API | `tests/api/bookings.api.spec.js` | Playwright `request` | `backend/src/routes/bookingRoutes.js`, `backend/src/controllers/bookingController.js`, `backend/src/middleware/*.js` |
| Component | `tests/components/booking-ui.spec.js` | Playwright `page` + `page.route` + `page.clock` | `frontend/app/bookings/page.tsx`, `frontend/app/bookings/[id]/page.tsx`, `frontend/components/bookings/BookingCard.jsx`, `frontend/components/ui/ConfirmDialog.jsx` |
| E2E | `tests/booking-management.spec.js` (refactor per §5) | Playwright `page` | Full stack |

Test accounts: User A `rahulshetty1@gmail.com` / `Magiclife1!`, User B `rahulshetty1@yahoo.com` / `Magiclife1!`. All suites share these accounts against production with `fullyParallel: false`. Every test must reset its own bookings through the API at the start and must not assume state left by another file.
