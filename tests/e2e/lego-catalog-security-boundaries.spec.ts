import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { requireDevelopmentDatabase } from './helpers/database-safety';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const prefix = 'Consavro Catalog Security E2E';
const manage = '/dashboard/lego-catalog/manage';
const inventory = (businessId: string) => `/dashboard/businesses/${businessId}/inventory`;
const catalogIds: string[] = [];

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
  for (const id of catalogIds.splice(0)) await pool.query('DELETE FROM "lego_set" WHERE id=$1', [id]);
}
async function fixtureSet() {
  const id = randomUUID();
  const setNumber = `E2ES-${randomUUID().slice(0, 10).toUpperCase()}`;
  await pool.query(`INSERT INTO "lego_set" (id,"setNumber",name,theme,source,"verificationStatus","createdAt","updatedAt") VALUES ($1,$2,$3,'Space','MANUAL','UNVERIFIED',NOW(),NOW())`, [id, setNumber, `${prefix} Rocket`]);
  catalogIds.push(id);
  return { id, setNumber };
}
async function business(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function item(page: Page, businessId: string, setNumber: string) {
  await page.goto(`${inventory(businessId)}/new`);
  await page.getByRole('textbox', { name: 'Search LEGO sets' }).fill(setNumber);
  await page.getByRole('button', { name: new RegExp(prefix) }).click();
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventory(businessId)}/?$`), { timeout: 20_000 });
  const rows = await pool.query<{ id: string; legoSetId: string }>('SELECT id,"legoSetId" FROM "inventory_item" WHERE "businessId"=$1', [businessId]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0];
}
async function assertNoWrite(businessId: string, itemId: string, expectedSetId: string) {
  const rows = await pool.query<{ legoSetId: string; archivedAt: Date | null }>('SELECT "legoSetId","archivedAt" FROM "inventory_item" WHERE id=$1 AND "businessId"=$2', [itemId, businessId]);
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].legoSetId).toBe(expectedSetId);
  expect(rows.rows[0].archivedAt).toBeNull();
}

test.describe('LEGO catalog — remaining Layer 5 security boundaries', () => {
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

  test('non-admin business OWNER cannot access catalog management or mutate catalog through its UI', async ({ page }) => {
    // Fail explicitly rather than accidentally testing an allowlisted administrator.
    const allowlist = (process.env.CONSAVRO_CATALOG_ADMIN_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase());
    test.skip(allowlist.includes(email.toLowerCase()), 'E2E account is allowlisted; run with a non-admin test email to verify this boundary.');
    const set = await fixtureSet();
    await signIn(page);
    await business(page, 'Owner No Admin');
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /LEGO Catalog Management/i })).toHaveCount(0);
    await page.goto(manage);
    await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add missing LEGO set' })).toHaveCount(0);
    const rows = await pool.query('SELECT name,"verificationStatus" FROM "lego_set" WHERE id=$1', [set.id]);
    expect(rows.rows[0]).toMatchObject({ name: `${prefix} Rocket`, verificationStatus: 'UNVERIFIED' });
  });

  test('STAFF can search a shared set but cannot create, edit or re-associate inventory', async ({ page }) => {
    const set = await fixtureSet();
    await signIn(page);
    const businessId = await business(page, 'Staff');
    const created = await item(page, businessId, set.setNumber);
    expect(created.legoSetId).toBe(set.id);
    const user = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [email]);
    const changed = await pool.query('UPDATE "business_member" SET role=$1,"updatedAt"=NOW() WHERE "businessId"=$2 AND "userId"=$3', ['STAFF', businessId, user.rows[0].id]);
    expect(changed.rowCount).toBe(1);
    const search = await page.request.get(`/api/businesses/${businessId}/lego-sets?q=${set.setNumber}`);
    expect(search.ok()).toBe(true);
    await page.goto(inventory(businessId));
    await expect(page.getByRole('link', { name: /Add inventory item/ })).toHaveCount(0);
    await page.goto(`${inventory(businessId)}/${created.id}`);
    await expect(page.getByRole('link', { name: 'Edit item' })).toHaveCount(0);
    await page.goto(`${inventory(businessId)}/${created.id}/edit`);
    await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible();
    await page.goto(`${inventory(businessId)}/new`);
    await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible();
    await assertNoWrite(businessId, created.id, set.id);
  });

  test('deleted catalog record unlinks existing inventory without corrupting its snapshot', async ({ page }) => {
    const set = await fixtureSet();
    await signIn(page);
    const businessId = await business(page, 'Deleted Reference');
    const created = await item(page, businessId, set.setNumber);
    await pool.query('DELETE FROM "lego_set" WHERE id=$1', [set.id]);
    catalogIds.splice(catalogIds.indexOf(set.id), 1);
    const rows = await pool.query<{ legoSetId: string | null; name: string }>('SELECT "legoSetId",name FROM "inventory_item" WHERE id=$1', [created.id]);
    expect(rows.rows[0].legoSetId).toBeNull();
    expect(rows.rows[0].name).toBe(`${prefix} Rocket`);
    await page.goto(`${inventory(businessId)}/${created.id}`);
    await expect(page.getByRole('heading', { name: `${prefix} Rocket` })).toBeVisible();
  });

  test('archiving a catalog-linked item preserves its association and blocks further editing', async ({ page }) => {
    const set = await fixtureSet();
    await signIn(page);
    const businessId = await business(page, 'Archive');
    const created = await item(page, businessId, set.setNumber);
    await page.goto(`${inventory(businessId)}/${created.id}`);
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: /Archive item/ }).click();
    await expect.poll(async () => {
      const rows = await pool.query<{ archivedAt: Date | null }>('SELECT "archivedAt" FROM "inventory_item" WHERE id=$1', [created.id]);
      return rows.rows[0]?.archivedAt ?? null;
    }).not.toBeNull();
    const rows = await pool.query<{ legoSetId: string }>('SELECT "legoSetId" FROM "inventory_item" WHERE id=$1', [created.id]);
    expect(rows.rows[0].legoSetId).toBe(set.id);
    await page.goto(`${inventory(businessId)}/${created.id}/edit`);
    await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible();
  });
});
