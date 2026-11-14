import { test, expect } from '@playwright/test';
import {
  CUSTOMER,
  apiLogin,
  apiClearBookings,
  apiCreateEvent,
  apiCreateBooking,
  apiListBookings,
  apiDeleteEvent,
  authenticatePage,
} from './helpers/eventhub-api';

// E2E — booking management journeys from docs/test-strategy.md §3.4:
//   TC-006 (+TC-102)  book through the UI → "View My Bookings" → same ref in list
//   TC-102            ref prefix rule + ref agrees across confirmation, list and detail
//   TC-005            "Clear all bookings" → native confirm → empty state
//
// TC-001, TC-002(+007) and TC-003 live in booking-flow.spec.js.
// Setup/teardown use the API; each test books its OWN event, never shared static seats.

// ── UI helper ──────────────────────────────────────────────────────────────────

/**
 * Books 1 ticket for `eventId` through the real booking form.
 * Returns the booking ref shown on the confirmation card.
 */
async function bookViaUI(page, eventId) {
  await page.goto(`/events/${eventId}`);
  await page.getByLabel('Full Name').fill(CUSTOMER.customerName);
  await page.locator('#customer-email').fill(CUSTOMER.customerEmail);
  await page.getByPlaceholder('+91 98765 43210').fill(CUSTOMER.customerPhone);
  await page.getByRole('button', { name: 'Confirm Booking' }).click();

  await expect(page.getByRole('heading', { name: /Booking Confirmed/ })).toBeVisible();
  // No data-testid on the confirmation ref — .booking-ref is the only stable hook
  const refEl = page.locator('.booking-ref');
  await expect(refEl).toHaveText(/^[A-Z0-9]-[A-Z0-9]{6}$/);
  return (await refEl.textContent()).trim();
}

// ── Suite ──────────────────────────────────────────────────────────────────────

test.describe('Booking Management — critical E2E journeys', () => {
  let token;
  let event;

  test.beforeEach(async ({ page, request }) => {
    event = undefined;
    token = await apiLogin(request);
    await apiClearBookings(request, token);
    await authenticatePage(page, token);
  });

  test.afterEach(async ({ request }) => {
    if (event) await apiDeleteEvent(request, token, event.id);
  });

  // TC-006 ───────────────────────────────────────────────────────────────────
  test('TC-006: booking via UI then "View My Bookings" lists the new booking first', async ({ page, request }) => {
    // -- Step 1: Arrange — own event --
    event = await apiCreateEvent(request, token);

    // -- Step 2: Book through the event page --
    const bookingRef = await bookViaUI(page, event.id);

    // -- Step 3: Follow "View My Bookings" from the confirmation card --
    await page.getByRole('link', { name: 'View My Bookings' }).click();
    await expect(page).toHaveURL(/\/bookings$/);

    // -- Step 4: Newest booking is the first card and carries the same ref --
    const firstCard = page.getByTestId('booking-card').first();
    await expect(firstCard.locator('.booking-ref')).toHaveText(bookingRef);
    await expect(firstCard.getByRole('heading', { name: event.title })).toBeVisible();
  });

  // TC-102 ───────────────────────────────────────────────────────────────────
  test('TC-102: booking ref starts with the uppercased first letter of the event title, everywhere it is shown', async ({ page, request }) => {
    // -- Step 1: Arrange — own event whose title starts lowercase (proves the uppercasing) --
    event = await apiCreateEvent(request, token, `zebra night e2e ${Date.now()}`);
    const expectedPrefix = event.title[0].toUpperCase(); // 'Z'

    // -- Step 2: Book through the UI; confirmation card ref --
    const bookingRef = await bookViaUI(page, event.id);
    expect(bookingRef[0]).toBe(expectedPrefix);
    expect(bookingRef).toMatch(/^Z-[A-Z0-9]{6}$/);

    // -- Step 3: Same ref on the bookings list card --
    await page.goto('/bookings');
    const card = page.getByTestId('booking-card').filter({ hasText: bookingRef });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { name: event.title })).toBeVisible();

    // -- Step 4: Same ref on the detail page breadcrumb --
    await card.getByRole('link', { name: 'View Details' }).click();
    await expect(page).toHaveURL(/\/bookings\/\d+$/);
    const breadcrumb = page.getByRole('navigation').filter({ hasText: bookingRef });
    await expect(breadcrumb.getByRole('link', { name: 'My Bookings' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);
  });

  // TC-005 ───────────────────────────────────────────────────────────────────
  test('TC-005: "Clear all bookings" removes every booking and shows the empty state', async ({ page, request }) => {
    // -- Step 1: Arrange — two bookings on own event --
    event = await apiCreateEvent(request, token);
    await apiCreateBooking(request, token, event.id, 1);
    await apiCreateBooking(request, token, event.id, 2);

    // -- Step 2: Bookings list shows both --
    await page.goto('/bookings');
    const cards = page.getByTestId('booking-card');
    await expect(cards).toHaveCount(2);

    // -- Step 3: Click "Clear all bookings" and accept the native confirm --
    let dialogMessage = '';
    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message();
      dialog.accept();
    });
    await page.getByRole('button', { name: 'Clear all bookings' }).click();

    // -- Step 4: Empty state replaces the list --
    await expect(page.getByText('No bookings yet')).toBeVisible();
    await expect(cards).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('link', { name: 'Browse Events' })).toBeVisible();
    expect(dialogMessage).toContain('Clear all your bookings?');

    // -- Step 5: Backend confirms nothing is left --
    expect(await apiListBookings(request, token)).toHaveLength(0);
  });
});
