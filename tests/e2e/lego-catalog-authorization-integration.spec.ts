import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { requireDevelopmentDatabase } from './helpers/database-safety';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const prefix = 'Consavro LEGO Layer5 E2E';
const catalogIds: string[] = [];

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
  for (const id of catalogIds.splice(0)) await pool.query('DELETE FROM "lego_set" WHERE id = $1', [id]);
}
async function createBusiness(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name = $1', [name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function createCatalogSet() {
  const id = randomUUID();
  const setNumber = `E2EL5-${randomUUID().slice(0, 10).toUpperCase()}`;
  await pool.query(`INSERT INTO "lego_set" (id,"setNumber",name,theme,"releaseYear","pieceCount",source,"verificationStatus","createdAt","updatedAt") VALUES ($1,$2,$3,'Space',2025,200,'MANUAL','UNVERIFIED',NOW(),NOW())`, [id, setNumber, `${prefix} Spaceship`]);
  catalogIds.push(id);
  return { id, setNumber };
}
async function addInventory(page: Page, businessId: string, setNumber: string) {
  await page.goto(`/dashboard/businesses/${businessId}/inventory/new`);
  await page.getByRole('textbox', { name: 'Search LEGO sets' }).fill(setNumber);
  await page.getByRole('button', { name: new RegExp(prefix) }).click();
  await page.getByLabel('LEGO set name / item name').fill(`${prefix} Inventory Override`);
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/businesses/${businessId}/inventory/?$`), { timeout: 20_000 });
  const rows = await pool.query<{ id: string; legoSetId: string; name: string; quantity: number }>('SELECT id,"legoSetId",name,quantity FROM "inventory_item" WHERE "businessId" = $1', [businessId]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0];
}

test.describe('LEGO catalog — Layer 5 authorization and integration', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', { data: { name: 'Consavro E2E User', email, password } });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    await request.get(await waitForVerificationUrl());
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => { try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); } });

  test('anonymous users cannot search a business catalog or open management', async ({ request }) => {
    const search = await request.get(`/api/businesses/${randomUUID()}/lego-sets?q=Space`, { maxRedirects: 0 });
    expect([302, 303, 307, 308, 404]).toContain(search.status());
    const management = await request.get('/dashboard/lego-catalog/manage', { maxRedirects: 0 });
    // Next.js may return 200 with a streamed redirect/not-found boundary.
    if (management.status() === 200) {
      const html = await management.text();
      expect(html).toMatch(/NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|sign-in|not.found|404/i);
      expect(html).not.toContain('Shared product data. Inventory details remain business-specific.');
    } else {
      expect([302, 303, 307, 308, 404]).toContain(management.status());
    }
  });

  test('shared catalog search does not expose another business inventory', async ({ page }) => {
    const set = await createCatalogSet();
    await signIn(page);
    const a = await createBusiness(page, 'Business A');
    const b = await createBusiness(page, 'Business B');
    const item = await addInventory(page, a, set.setNumber);
    expect(item.legoSetId).toBe(set.id);
    const response = await page.request.get(`/api/businesses/${b}/lego-sets?q=${set.setNumber}`);
    expect(response.ok()).toBe(true);
    const body = await response.json() as { results: Array<Record<string, unknown>> };
    expect(body.results.some(result => result.id === set.id)).toBe(true);
    for (const result of body.results) {
      expect(result).not.toHaveProperty('businessId');
      expect(result).not.toHaveProperty('clientId');
      expect(result).not.toHaveProperty('askingPrice');
      expect(result).not.toHaveProperty('inventoryItems');
    }
    const foreign = await page.goto(`/dashboard/businesses/${randomUUID()}/inventory/${item.id}`);
    // Suspense streaming can send HTTP 200 before rendering the 404 boundary.
    expect(foreign).not.toBeNull();
    await expect(page.getByRole('heading', { name: /not found|404/i })).toBeVisible();
    await expect(page.getByText(`${prefix} Inventory Override`)).toHaveCount(0);
    const stored = await pool.query('SELECT "businessId", "legoSetId" FROM "inventory_item" WHERE id = $1', [item.id]);
    expect(stored.rows[0]).toMatchObject({ businessId: a, legoSetId: set.id });
  });

  test('catalog corrections do not change linked inventory snapshots', async ({ page }) => {
    const set = await createCatalogSet();
    await signIn(page);
    const businessId = await createBusiness(page, 'Snapshot');
    const item = await addInventory(page, businessId, set.setNumber);
    const before = await pool.query('SELECT name,theme,"setNumber",quantity,"askingPrice","legoSetId" FROM "inventory_item" WHERE id = $1', [item.id]);
    // Simulates a successful catalog correction without altering tenant-owned inventory.
    await pool.query('UPDATE "lego_set" SET name = $2, theme = $3, "updatedAt" = NOW() WHERE id = $1', [set.id, `${prefix} Corrected`, 'Castle']);
    const after = await pool.query('SELECT name,theme,"setNumber",quantity,"askingPrice","legoSetId" FROM "inventory_item" WHERE id = $1', [item.id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  test('unlinked inventory remains valid after its catalog record is removed', async ({ page }) => {
    const set = await createCatalogSet();
    await signIn(page);
    const businessId = await createBusiness(page, 'Deletion');
    const item = await addInventory(page, businessId, set.setNumber);
    await pool.query('DELETE FROM "lego_set" WHERE id = $1', [set.id]);
    catalogIds.splice(catalogIds.indexOf(set.id), 1);
    const rows = await pool.query('SELECT id,name,"legoSetId" FROM "inventory_item" WHERE id = $1', [item.id]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].legoSetId).toBeNull();
    expect(rows.rows[0].name).toBe(`${prefix} Inventory Override`);
  });
});
