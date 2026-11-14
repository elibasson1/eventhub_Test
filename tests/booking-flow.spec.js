import { test, expect } from '@playwright/test';

// E2E — first three journeys from docs/test-strategy.md §3.4:
//   TC-001  bookings list renders real card data
//   TC-002  booking detail page sections (+ TC-007 back / breadcrumb navigation)
//   TC-003  cancel from the detail page → toast, redirect, booking gone
//
// Setup/teardown go through the API (strategy A5). Each test books its OWN event
// (strategy A7) so no shared static-event seats are consumed in production.

import {
  API_URL,
  CUSTOMER,
  EVENT_DEFAULTS,
  auth,
  apiLogin,
  apiClearBookings,
  apiCreateEvent,
  apiCreateBooking,
  apiDeleteEvent,
  authenticatePage,
} from './helpers/eventhub-api';

const EVENT_PRICE = EVENT_DEFAULTS.price;
const EVENT_CITY  = EVENT_DEFAULTS.city;
const EVENT_VENUE = EVENT_DEFAULTS.venue;

// Same formatters the UI uses (BookingCard.jsx / bookings/[id]/page.tsx)
const fmtCardDate   = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDetailDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtPrice      = (n)   => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// ── Suite ──────────────────────────────────────────────────────────────────────

test.describe('Booking flow — critical E2E journeys', () => {
  let token;
  let event;

  test.beforeEach(async ({ page, request }) => {
    event = undefined;
    token = await apiLogin(request);
    await apiClearBookings(request, token);
    event = await apiCreateEvent(request, token);
    await authenticatePage(page, token);
  });

  test.afterEach(async ({ request }) => {
    if (event) await apiDeleteEvent(request, token, event.id);
  });

  // TC-001 ───────────────────────────────────────────────────────────────────
  test('TC-001: bookings list shows a card with all booking fields', async ({ page, request }) => {
    // -- Step 1: Arrange — one 2-ticket booking on our own event --
    const booking = await apiCreateBooking(request, token, event.id, 2);

    // -- Step 2: Open the bookings list --
    await page.goto('/bookings');
    await expect(page.getByRole('heading', { name: 'My Bookings' })).toBeVisible();

    // -- Step 3: Assert every field on the card --
    const card = page.getByTestId('booking-card').filter({ hasText: booking.bookingRef });
    await expect(card).toHaveCount(1);
    await expect(card.locator('.booking-ref')).toHaveText(booking.bookingRef);
    await expect(card).toContainText('confirmed');
    await expect(card.getByTestId('booking-id')).toHaveText(`#${booking.id}`);
    await expect(card.getByRole('heading', { name: event.title })).toBeVisible();
    await expect(card).toContainText(fmtCardDate(event.eventDate));
    await expect(card).toContainText('2 tickets');
    await expect(card).toContainText(EVENT_CITY);
    await expect(card).toContainText(`Booked ${fmtCardDate(booking.createdAt)}`);
    await expect(card).toContainText(fmtPrice(EVENT_PRICE * 2)); // totalPrice = price × qty
    await expect(card.getByRole('link', { name: 'View Details' })).toBeVisible();
    await expect(card.getByTestId('cancel-booking-btn')).toBeVisible();
  });

  // TC-002 + TC-007 ──────────────────────────────────────────────────────────
  test('TC-002 + TC-007: detail page shows all sections; back link and breadcrumb return to list', async ({ page, request }) => {
    // -- Step 1: Arrange — one 2-ticket booking --
    const booking = await apiCreateBooking(request, token, event.id, 2);

    // -- Step 2: List → View Details --
    await page.goto('/bookings');
    const card = page.getByTestId('booking-card').filter({ hasText: booking.bookingRef });
    await card.getByRole('link', { name: 'View Details' }).click();
    await expect(page).toHaveURL(new RegExp(`/bookings/${booking.id}$`));

    // -- Step 3: Header — breadcrumb, ref badge, status, H1, actions --
    const breadcrumb = page.getByRole('navigation').filter({ hasText: booking.bookingRef });
    await expect(breadcrumb.getByRole('link', { name: 'My Bookings' })).toBeVisible();
    await expect(page.getByText(booking.bookingRef)).toHaveCount(2); // breadcrumb + badge
    await expect(page.getByText('confirmed', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);
    await expect(page.getByRole('button', { name: 'Cancel Booking' })).toBeVisible();

    // -- Step 4: Event Details --
    await expect(page.getByRole('heading', { name: 'Event Details' })).toBeVisible();
    await expect(page.getByText('Conference', { exact: true })).toBeVisible();
    await expect(page.getByText(fmtDetailDate(event.eventDate))).toBeVisible();
    await expect(page.getByText(EVENT_VENUE)).toBeVisible();
    await expect(page.getByText(EVENT_CITY, { exact: true })).toBeVisible();

    // -- Step 5: Customer Details --
    await expect(page.getByRole('heading', { name: 'Customer Details' })).toBeVisible();
    await expect(page.getByText(CUSTOMER.customerName)).toBeVisible();
    await expect(page.getByText(CUSTOMER.customerEmail)).toBeVisible();
    await expect(page.getByText(CUSTOMER.customerPhone)).toBeVisible();

    // -- Step 6: Payment Summary --
    await expect(page.getByRole('heading', { name: 'Payment Summary' })).toBeVisible();
    await expect(page.getByText('Price per ticket')).toBeVisible();
    await expect(page.getByText(fmtPrice(EVENT_PRICE), { exact: true })).toBeVisible();
    await expect(page.getByText('Total Paid')).toBeVisible();
    await expect(page.getByText(fmtPrice(EVENT_PRICE * 2), { exact: true })).toBeVisible();

    // -- Step 7: Refund + Booking Information --
    await expect(page.getByRole('heading', { name: 'Refund' })).toBeVisible();
    await expect(page.getByTestId('check-refund-btn')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Booking Information' })).toBeVisible();
    await expect(page.getByText(`#${booking.id}`)).toBeVisible();

    // -- Step 8 (TC-007): "← Back to My Bookings" returns to the list --
    await page.getByRole('link', { name: '← Back to My Bookings' }).click();
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(card).toBeVisible();

    // -- Step 9 (TC-007): breadcrumb "My Bookings" also returns to the list --
    await page.goto(`/bookings/${booking.id}`);
    await breadcrumb.getByRole('link', { name: 'My Bookings' }).click();
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(card).toBeVisible();
  });

  // TC-003 ───────────────────────────────────────────────────────────────────
  test('TC-003: cancel from detail page shows toast, redirects, and removes the booking', async ({ page, request }) => {
    // -- Step 1: Arrange — booking to cancel + one to keep (proves the list really loaded) --
    const keeper = await apiCreateBooking(request, token, event.id, 1);
    const target = await apiCreateBooking(request, token, event.id, 1);

    // -- Step 2: Open the detail page and click Cancel Booking --
    await page.goto(`/bookings/${target.id}`);
    await page.getByRole('button', { name: 'Cancel Booking' }).click();

    // -- Step 3: Confirm in the dialog --
    await expect(page.getByText('Cancel this booking?')).toBeVisible();
    await page.getByTestId('confirm-dialog-yes').click();

    // -- Step 4: Toast + redirect to /bookings --
    await expect(page.getByText('Booking cancelled successfully')).toBeVisible();
    await expect(page).toHaveURL(/\/bookings$/);

    // -- Step 5: Cancelled ref gone, other booking still listed --
    const cards = page.getByTestId('booking-card');
    await expect(cards.filter({ hasText: keeper.bookingRef })).toBeVisible();
    await expect(cards.filter({ hasText: target.bookingRef })).toHaveCount(0);

    // -- Step 6: Backend confirms deletion --
    const res = await request.get(`${API_URL}/bookings/${target.id}`, { headers: auth(token) });
    expect(res.status()).toBe(404);
  });
});
