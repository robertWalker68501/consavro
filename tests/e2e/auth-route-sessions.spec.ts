import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Use the same dedicated development/test database as the existing auth E2E suite.
// Keep the test runner independent of Next.js's Prisma generated ESM client.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function userId(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM "user" WHERE email = $1', [email],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Authentication E2E user not found');
  return id;
}

async function sessionCount(): Promise<number> {
  const result = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM "session" WHERE "userId" = $1',
    [await userId()],
  );
  return result.rows[0].count;
}

async function expectDashboard(page: Page) {
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  await expect(page.getByRole('heading', { name: /^Good to see you, Consavro E2E User$/ })).toBeVisible();
}

test.describe('authentication route protection and sessions', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `Setup sign-up failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verificationUrl = await waitForVerificationUrl();
    const verification = await request.get(verificationUrl);
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });

  test.afterAll(async () => {
    try { await resetTestAccount(); } finally { await pool.end(); }
  });

  test('anonymous visitors cannot access the dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    await expect(page.getByRole('heading', { name: /^Good to see you, Consavro E2E User$/ })).toHaveCount(0);
  });

  test('authenticated users are redirected away from sign-in and sign-up', async ({ page }) => {
    await signIn(page);
    await page.goto('/sign-in');
    await expectDashboard(page);
    await page.goto('/sign-up');
    await expectDashboard(page);
  });

  test('session survives navigation and full page reload', async ({ page }) => {
    await signIn(page);
    await page.reload();
    await expectDashboard(page);
    await page.goto('/');
    await page.goto('/dashboard');
    await expectDashboard(page);
    expect(await sessionCount()).toBeGreaterThan(0);
  });

  test('a forged session cookie cannot authenticate a visitor', async ({ page, context }) => {
    await context.addCookies([{
      name: 'better-auth.session_token',
      value: 'forged-session-token-that-does-not-exist',
      url: test.info().project.use.baseURL as string,
    }]);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  });

  test('signing out revokes access even after a full reload', async ({ page, context }) => {
    await signIn(page);
    const sessionCookies = (await context.cookies()).filter(cookie => cookie.name.includes('session_token'));
    expect(sessionCookies.length).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    // Reusing a cookie saved before logout must not restore the revoked session.
    await context.addCookies(sessionCookies);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  });

  test('server-side session revocation blocks an existing browser session', async ({ page }) => {
    await signIn(page);
    const id = await userId();
    await pool.query('DELETE FROM "session" WHERE "userId" = $1', [id]);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  });

  test('an expired session cannot access protected content', async ({ page }) => {
    await signIn(page);
    await pool.query(
      `UPDATE "session" SET "expiresAt" = NOW() - INTERVAL '1 hour' WHERE "userId" = $1`,
      [await userId()],
    );
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  });
});
