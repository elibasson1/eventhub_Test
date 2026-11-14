import { expect } from '@playwright/test';

// Shared API setup/teardown for EventHub E2E tests (test-strategy A5/A7).
// Tests book their OWN events so shared static-event seats are never consumed.

export const API_URL       = process.env.API_URL ?? 'https://api.eventhub.rahulshettyacademy.com/api';
export const USER_EMAIL    = 'rahulshetty1@gmail.com';
export const USER_PASSWORD = 'Magiclife1!';

export const EVENT_DEFAULTS = {
  category:   'Conference',
  venue:      'Booking Flow Test Hall',
  city:       'Bangalore',
  price:      150,
  totalSeats: 50,
};

export const CUSTOMER = {
  customerName:  'Booking Flow Tester',
  customerEmail: 'bookingflow@example.com',
  customerPhone: '9876543210',
};

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

export async function apiLogin(request) {
  const res = await request.post(`${API_URL}/auth/login`, {
    data: { email: USER_EMAIL, password: USER_PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

export async function apiClearBookings(request, token) {
  const res = await request.delete(`${API_URL}/bookings`, { headers: auth(token) });
  expect(res.ok()).toBeTruthy();
}

export async function apiCreateEvent(request, token, title = `Booking Flow E2E ${Date.now()}`) {
  // Noon UTC, 30 days out — keeps the rendered date stable across time zones
  const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  date.setUTCHours(12, 0, 0, 0);
  const res = await request.post(`${API_URL}/events`, {
    headers: auth(token),
    data: { ...EVENT_DEFAULTS, title, description: 'Created by Playwright E2E', eventDate: date.toISOString() },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data;
}

export async function apiCreateBooking(request, token, eventId, quantity = 1) {
  const res = await request.post(`${API_URL}/bookings`, {
    headers: auth(token),
    data: { eventId, quantity, ...CUSTOMER },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data;
}

export async function apiListBookings(request, token) {
  const res = await request.get(`${API_URL}/bookings`, { headers: auth(token) });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

export async function apiDeleteEvent(request, token, eventId) {
  // Cascade-deletes the event's bookings too
  const res = await request.delete(`${API_URL}/events/${eventId}`, { headers: auth(token) });
  expect.soft(res.ok(), `cleanup: delete event ${eventId}`).toBeTruthy();
}

/** Skip the UI login: put the JWT where client.js / useAuth read it. */
export async function authenticatePage(page, token) {
  await page.addInitScript((t) => window.localStorage.setItem('eventhub_token', t), token);
}
