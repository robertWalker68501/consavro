import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { Pool } from 'pg';

// Keep Playwright's Node runtime independent of Next.js's generated Prisma client.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const email = 'consavro-e2e-auth@example.com';
export const password = 'Consavro-E2E-Strong-Password-2026!';
const mailPath = join(resolve('.consavro-e2e-emails'), `${createHash('sha256').update(email).digest('hex')}.json`);

export async function resetTestAccount() {
  await pool.query('DELETE FROM "user" WHERE email = $1', [email]);
  await rm(mailPath, { force: true });
}

export async function waitForVerificationUrl() {
  let url: string | undefined;
  await expect.poll(async () => {
    try {
      const record = JSON.parse(await readFile(mailPath, 'utf8')) as { url: string };
      url = record.url;
      return Boolean(url);
    } catch { return false; }
  }, { timeout: 20_000 }).toBe(true);
  if (!url) throw new Error('Verification URL not captured');
  return url;
}

export async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
}

export async function isTestEmailVerified(): Promise<boolean> {
  const result = await pool.query<{ emailVerified: boolean }>(
    'SELECT "emailVerified" FROM "user" WHERE email = $1',
    [email],
  );
  return result.rows[0]?.emailVerified === true;
}
