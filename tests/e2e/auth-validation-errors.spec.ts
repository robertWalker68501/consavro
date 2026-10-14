import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount } from './helpers/auth';

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function exists(address: string): Promise<boolean> {
  const result = await db.query('SELECT id FROM "user" WHERE email = $1', [address]);
  return (result.rowCount ?? 0) > 0;
}

async function submit(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Create account' }).click();
}

test.describe('authentication validation and errors', () => {
  test.beforeAll(resetTestAccount);
  test.afterAll(async () => {
    await resetTestAccount();
    await db.end();
  });

  test('sign-up requires a name, email, and password', async ({ page }) => {
    await page.goto('/sign-up');
    await submit(page);
    await expect(page.locator('#name-error')).toContainText('Name must be at least 2 characters');
    await expect(page.locator('#email-error')).toContainText('Enter a valid email address');
    await expect(page.locator('#password-error')).toContainText('Use at least 8 characters');
    await expect(page).toHaveURL(/\/sign-up(?:\?|$)/);
    expect(await exists(email)).toBe(false);
  });

  test('sign-up rejects malformed email and short password', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByLabel('Full name').fill('Valid User');
    await page.getByLabel('Email').fill('invalid-email');
    await page.getByLabel('Password').fill('short');
    await submit(page);
    await expect(page.locator('#email-error')).toContainText('Enter a valid email address');
    await expect(page.locator('#password-error')).toContainText('Use at least 8 characters');
    expect(await exists(email)).toBe(false);
  });

  test('sign-up rejects overlong name and password', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByLabel('Full name').fill('A'.repeat(101));
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('A'.repeat(129));
    await submit(page);
    await expect(page.locator('#name-error')).toContainText('100');
    await expect(page.locator('#password-error')).toContainText('128');
    expect(await exists(email)).toBe(false);
  });

  test('server rejects invalid registration payload independently of the UI', async ({ request }) => {
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'A', email, password: 'short' },
    });
    expect(response.ok()).toBe(false);
    expect(await exists(email)).toBe(false);
  });

  test('duplicate account returns an error without creating another user', async ({ page, request }) => {
    const first = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Existing User', email, password },
    });
    expect(first.ok(), await first.text()).toBe(true);
    await page.goto('/sign-up');
    await page.getByLabel('Full name').fill('Second User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await submit(page);
    // Better Auth may intentionally return a generic success response for an existing
    // email to avoid revealing which addresses are registered. Either outcome is valid.
    await expect(page.getByRole('status').or(page.locator('p[role="alert"]')).first()).toBeVisible({ timeout: 20_000 });
    const users = await db.query('SELECT name FROM "user" WHERE email = $1', [email]);
    expect(users.rows).toEqual([{ name: 'Existing User' }]);
    await expect(page).not.toHaveURL(/\/dashboard(?:\?|$)/);
  });

  test('sign-in requires valid form values', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('#email-error')).toContainText('Enter a valid email address');
    await expect(page.locator('#password-error')).toContainText('Password is required');
    await page.getByLabel('Email').fill('bad-email');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('#email-error')).toContainText('Enter a valid email address');
    await expect(page).not.toHaveURL(/\/dashboard(?:\?|$)/);
  });

  test('incorrect credentials show an error and do not grant access', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('incorrect-password-2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect.poll(async () =>
      (await page.getByRole('alert').allTextContents()).some(t => t.trim().length > 0),
    { timeout: 20_000 }).toBe(true);
    await expect(page).not.toHaveURL(/\/dashboard(?:\?|$)/);
  });
});
