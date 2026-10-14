import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

const blockedEmail = 'consavro-e2e-blocked@example.com';
const allowedEmail = 'consavro-e2e-auth@example.com';
const password = 'Consavro-E2E-Strong-Password-2026!';
const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function removeTestUsers() {
  await db.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [[blockedEmail, allowedEmail]]);
}

async function userExists(email: string) {
  const result = await db.query('SELECT id FROM "user" WHERE email = $1', [email]);
  return result.rowCount !== 0;
}

test.describe('private registration restrictions', () => {
  test.beforeAll(removeTestUsers);
  test.afterAll(removeTestUsers);

  test('unapproved email cannot register using the sign-up form', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByLabel('Full name').fill('Unapproved Consavro User');
    await page.getByLabel('Email').fill(blockedEmail);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Empty validation alerts do not count as an actual error.
    await expect.poll(async () => (await page.getByRole('alert').allTextContents())
      .map((value) => value.trim()).filter(Boolean).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => userExists(blockedEmail)).toBe(false);
    await expect(page).not.toHaveURL(/\/dashboard(?:\?|$)/);
  });

  test('direct Better Auth API cannot bypass the allowlist', async ({ request }) => {
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Unapproved API User', email: blockedEmail, password },
    });
    expect(response.ok(), `Unexpected successful registration: ${response.status()}`).toBe(false);
    await expect.poll(() => userExists(blockedEmail)).toBe(false);
  });

  test('approved email is permitted by the same server-side API', async ({ request }) => {
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Approved API User', email: allowedEmail, password },
    });
    expect(response.ok(), `Approved registration returned ${response.status()}: ${await response.text()}`).toBe(true);
    await expect.poll(() => userExists(allowedEmail), { timeout: 20_000 }).toBe(true);
  });
});
