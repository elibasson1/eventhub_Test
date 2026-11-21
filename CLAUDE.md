# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
EventHub is a full-stack event ticket booking platform used for QA/test-automation training. Users register/log in, browse events, book tickets, manage bookings, and create their own events. Each user operates in an isolated sandbox: they see the shared seeded ("static") events plus only their own events and bookings.

- **Frontend** (`frontend/`, port 3000): Next.js 14 App Router, React 18, TypeScript + some `.jsx`, Tailwind, React Query v5, Axios (`lib/api/client.js` attaches the JWT). `lib/api/` has parallel `.js`/`.ts` modules (`client.js`+`client.ts`, `bookingsApi.js`+`bookings.ts`, `eventsApi.js`+`events.ts`); `@/lib/api/client` resolves to `client.js`, which attaches the token, unwraps `response.data`, and redirects to `/login` on a 401, so check which file is actually imported before editing.
- **Backend** (`backend/`, port 3001): Express, Prisma 5, MySQL 8, JWT auth (bcryptjs), Swagger UI at `/api/docs`.
- **Tests** (`tests/`, repo root): Playwright E2E, Chromium only.

## Commands
```bash
npm run setup        # install backend + frontend deps (root has its own deps for Playwright)
npm run dev          # backend (nodemon) + frontend (next dev) concurrently
npm run db:push      # push Prisma schema to DB (non-interactive)
npm run migrate      # prisma migrate dev (interactive)
npm run seed         # seed the 10 static events
npm run build        # Next.js production build
npm run lint         # next lint (frontend)

npm test                                                        # all Playwright tests
npx playwright test tests/<file>.spec.js --reporter=line        # single file
npx playwright test tests/<file>.spec.js -g "<test title>"      # single test
npm run test:ui / npm run test:report
docker compose up --build                                       # run tests in the Playwright container
```

Checks CI (`.github/workflows/ci.yml`) runs on PRs — reproduce locally before pushing:
- `cd backend && node --check server.js && node --check app.js && npx prisma validate && npx prisma format` (CI fails if `prisma format` changes `schema.prisma`)
- `cd frontend && npx tsc --noEmit && npm run build`
- A `schema-drift` job also SSHes to the production server and runs `prisma migrate diff` against the prod DB, so you can't run it locally. Keep the migrations in `backend/prisma/migrations/` in sync with schema changes.

Env: `backend/.env` (`DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `JWT_SECRET`), `frontend/.env.local` (`NEXT_PUBLIC_API_URL=http://localhost:3001/api`).

## Architecture
Backend is strictly layered: `routes` (Express routers + Swagger JSDoc, validators, `authMiddleware`) → `controllers` (thin HTTP) → `services` (business rules, transactions) → `repositories` (pure Prisma) → MySQL. Domain errors in `src/utils/errors.js` (e.g. `NotFoundError`, `ForbiddenError`, `InsufficientSeatsError`) are thrown from services and mapped to HTTP responses in `middleware/errorHandler.js`.

User isolation is enforced in the repositories: event queries filter with `OR: [{ isStatic: true }, { userId }]`; bookings are scoped by `userId`. Data model (`backend/prisma/schema.prisma`): `User` → `Event` (`isStatic`, nullable `userId`) and `Booking` (`userId`, `eventId`, unique `bookingRef`), with cascade deletes.

Key business rules (constants live in the services):
- Max 6 user-created events per user (`MAX_USER_DYNAMIC_EVENTS`, `eventService.js`) and max 9 bookings (`MAX_USER_BOOKINGS`, `bookingService.js`) — overflow prunes the oldest (FIFO) rather than erroring.
- Static (seeded) events cannot be modified or deleted.
- Booking decrements `availableSeats` atomically; cancellation restores them.
- Booking ref's first character = uppercase first character of the event title.
- Refund eligibility (1 ticket = eligible, >1 = not) is computed client-side only.
- Accessing another user's booking shows "Access Denied".

The README predates auth and the per-user sandbox; trust the code over the README's API section.

## Testing
- `playwright.config.ts` has `baseURL` pointing at the **live deployed site** (`https://eventhub.rahulshettyacademy.com`), not localhost; `fullyParallel: false`, `retries: 0`. The `playwright.yml` workflow runs the suite against production on every push to `main`.
- `LOCAL_APP=true` (plus `DATABASE_URL`, `API_URL=http://localhost:4001/api`, a built frontend) makes Playwright start backend:4001 + frontend:4000 itself and test against localhost. The `Jenkinsfile` (local Windows Jenkins, polls GitHub) uses this with a dedicated `eventhub_ci` DB from the Jenkins credential `eventhub-ci-database-url`.
- Test files: `tests/<feature-name>.spec.js` (JavaScript). Tests must be self-contained (login → action → assert); test account `rahulshetty1@gmail.com` / `Magiclife1!`.
- Locator priority: `data-testid` > role > label/placeholder > id > CSS class. No `page.waitForTimeout()` — use web-first assertions.
- Use the project skills for details: `playwright-best-practices` (test standards) and `eventhub-domain` (API reference, business rules, UI selectors, user flows under `.claude/skills/eventhub-domain/`).
- Workflow skills: `generate-tests`, `review-tests`, `create-scenarios`, `test-strategy`. Generated scenario/strategy docs live in `docs/`.

## Deployment
`deploy.yml` deploys to an Ubuntu server via SSH + PM2 on push to `main`, after re-running `ci.yml` as a gate. Prisma migrations are **not** run by the pipeline — schema changes require a manual `npx prisma migrate deploy` on the server first.
