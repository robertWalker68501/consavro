import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import 'dotenv/config';
import { requireDevelopmentDatabase } from './tests/e2e/helpers/database-safety';

const port = 3101;
const baseURL = `http://127.0.0.1:${port}`;

const safeDatabaseUrl = requireDevelopmentDatabase();

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'auth-public-registration.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: safeDatabaseUrl,
      BETTER_AUTH_URL: baseURL,
      NEXT_PUBLIC_APP_URL: baseURL,
      CONSAVRO_PUBLIC_REGISTRATION: 'true',
      CONSAVRO_ALLOWED_EMAILS: '',
      CONSAVRO_E2E_EMAIL_DIR: resolve('.consavro-e2e-emails'),
    },
  },
});
