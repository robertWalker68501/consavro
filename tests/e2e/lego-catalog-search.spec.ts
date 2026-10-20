import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { requireDevelopmentDatabase } from './helpers/database-safety';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Only isolated fixtures on the explicitly allowlisted Neon development endpoint.
const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const prefix = 'Consavro LEGO Search E2E';
const createdIds: string[] = [];
const businessNames = `${prefix} Business%`;

async function createBusiness(page: Page, suffix: string) {
  const name = `${prefix} Business ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name = $1', [name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}

async function seedSet(name: string, options: { theme?: string; year?: number; pieces?: number; number?: string } = {}) {
  const id = randomUUID();
  const setNumber = options.number ?? `E2E-${randomUUID().slice(0, 12).toUpperCase()}`;
  await pool.query(`INSERT INTO "lego_set" (id, "setNumber", name, theme, "releaseYear", "pieceCount", source, "verificationStatus", "createdAt", "updatedAt")
    VALUES ($1,$2,$3,$4,$5,$6,'MANUAL','UNVERIFIED',NOW(),NOW())`,
    [id, setNumber, name, options.theme ?? null, options.year ?? null, options.pieces ?? null]);
  createdIds.push(id);
  return { id, setNumber, name };
}

async function cleanup() {
  for (const id of createdIds.splice(0)) await pool.query('DELETE FROM "lego_set" WHERE id = $1', [id]);
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [businessNames]);
}

const path = (businessId: string) => `/dashboard/businesses/${businessId}/lego-catalog`;
const api = (businessId: string, q: string) => `/api/businesses/${businessId}/lego-sets?q=${encodeURIComponent(q)}`;

test.describe('LEGO catalog — Layer 2 search and identification', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `E2E registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => {
    try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); }
  });

  test('searches by set number and name and selects a result', async ({ page }) => {
    const set = await seedSet(`${prefix} Searchable Falcon`, { theme: 'Star Wars', year: 2024, pieces: 999 });
    await signIn(page);
    const businessId = await createBusiness(page, 'Search');
    await page.goto(path(businessId));
    await expect(page.getByRole('heading', { name: 'LEGO set catalog' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'LEGO set catalog search' })).toHaveAttribute('data-hydrated', 'true');
    const search = page.getByRole('textbox', { name: 'Search LEGO sets' });
    await search.fill(set.setNumber);
    const result = page.getByRole('button', { name: new RegExp(set.name) });
    await expect(page.getByRole('status')).toContainText('1 matching set');
    await expect(result).toBeVisible();
    await expect(result).toContainText('Star Wars');
    await expect(result).toContainText('2024');
    await expect(result).toContainText('999 pieces');
    await result.click();
    await expect(result).toHaveAttribute('aria-pressed', 'true');
    await expect(result).toContainText('Selected');
    await search.fill('Searchable Falcon');
    await expect(result).toBeVisible();
    await expect(result).toHaveAttribute('aria-pressed', 'false');
  });

  test('handles ambiguous name matches and incomplete metadata', async ({ page }) => {
    const first = await seedSet(`${prefix} Twin Explorer`);
    const second = await seedSet(`${prefix} Twin Explorer`, { theme: 'City' });
    await signIn(page);
    const businessId = await createBusiness(page, 'Ambiguous');
    await page.goto(path(businessId));
    await page.getByRole('textbox', { name: 'Search LEGO sets' }).fill('Twin Explorer');
    const results = page.getByRole('list', { name: 'LEGO set search results' });
    await expect(results.getByRole('button')).toHaveCount(2);
    await expect(results).toContainText(first.setNumber);
    await expect(results).toContainText(second.setNumber);
    await expect(results).toContainText('No image');
    await expect(results).toContainText('Unverified catalog entry');
  });

  test('shows minimum-length and missing-set states', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Empty');
    await page.goto(path(businessId));
    const search = page.getByRole('textbox', { name: 'Search LEGO sets' });
    await expect(page.getByRole('status')).toContainText('Enter at least two characters');
    await search.fill('X');
    await expect(page.getByRole('status')).toContainText('Enter at least two characters');
    await search.fill('NO-SUCH-LEGO-SET-987654321');
    await expect(page.getByRole('status')).toContainText('No matching sets in the local catalog');
    await expect(page.getByRole('list', { name: 'LEGO set search results' })).toHaveCount(0);
  });

  test('shares catalog results across authorized businesses', async ({ page }) => {
    const set = await seedSet(`${prefix} Shared Product`);
    await signIn(page);
    const first = await createBusiness(page, 'One');
    const second = await createBusiness(page, 'Two');
    for (const businessId of [first, second]) {
      const response = await page.request.get(api(businessId, set.setNumber));
      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.results).toEqual(expect.arrayContaining([expect.objectContaining({ id: set.id, setNumber: set.setNumber })]));
    }
  });

  test('rejects anonymous, unknown-business and revoked-membership API access', async ({ page, browser }) => {
    const set = await seedSet(`${prefix} Protected Product`);
    await signIn(page);
    const businessId = await createBusiness(page, 'Security');
    const anonymous = await browser.newContext();
    try {
      const response = await anonymous.request.get(`http://127.0.0.1:3100${api(businessId, set.setNumber)}`, { maxRedirects: 0 });
      expect(response.status()).not.toBe(200);
      expect(await response.text()).not.toContain(set.name);
    } finally { await anonymous.close(); }
    const unknown = await page.request.get(api('forged-business-id', set.setNumber), { maxRedirects: 0 });
    expect(unknown.status()).not.toBe(200);
    const user = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
    await pool.query('DELETE FROM "business_member" WHERE "businessId" = $1 AND "userId" = $2', [businessId, user.rows[0].id]);
    const revoked = await page.request.get(api(businessId, set.setNumber), { maxRedirects: 0 });
    expect(revoked.status()).not.toBe(200);
    expect(await revoked.text()).not.toContain(set.name);
  });

  test('rejects oversized search queries and returns an empty result for short queries', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Validation');
    const oversized = await page.request.get(api(businessId, 'x'.repeat(101)));
    expect(oversized.status()).toBe(400);
    const short = await page.request.get(api(businessId, 'x'));
    expect(short.status()).toBe(200);
    expect((await short.json()).results).toEqual([]);
  });
});
