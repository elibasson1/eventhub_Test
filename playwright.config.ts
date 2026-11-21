import { defineConfig, devices } from '@playwright/test';

// Default: run against the live deployed site.
// LOCAL_APP=true: Playwright starts the backend + frontend from this checkout
// (used by the Jenkinsfile) and tests run against them on localhost.
const LOCAL_APP = process.env.LOCAL_APP === 'true';
const WEB_PORT = process.env.WEB_PORT ?? '4000';
const API_PORT = process.env.API_PORT ?? '4001';

const BASE_URL =
  process.env.BASE_URL ??
  (LOCAL_APP ? `http://localhost:${WEB_PORT}` : 'https://eventhub.rahulshettyacademy.com');

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // All specs share one test account and clear its bookings in beforeEach,
  // so files must not run concurrently either.
  workers: 1,
  retries: 0,
  reporter: 'html',

  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Requires DATABASE_URL in the environment and a built frontend (next build).
  // START_SERVERS=false: the servers are already running (Jenkins starts and
  // stops them itself — under the Jenkins Windows service, Playwright's
  // webServer teardown hangs for minutes after the last test).
  webServer: LOCAL_APP && process.env.START_SERVERS !== 'false'
    ? [
        {
          command: 'node server.js',
          cwd: 'backend',
          url: `http://localhost:${API_PORT}/api/health`,
          timeout: 60_000,
          reuseExistingServer: false,
          env: {
            PORT: API_PORT,
            CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
            NODE_ENV: 'production',
          },
        },
        {
          command: `node node_modules/next/dist/bin/next start -p ${WEB_PORT}`,
          cwd: 'frontend',
          url: `http://localhost:${WEB_PORT}`,
          timeout: 120_000,
          reuseExistingServer: false,
        },
      ]
    : undefined,
});
