import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { requireDevelopmentDatabase } from './helpers/database-safety';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const prefix = 'Consavro Catalog Final Security E2E';
const nonAdminEmail = 'consavro-e2e-catalog-nonadmin@example.com';
const inventory = (businessId: string) => `/dashboard/businesses/${businessId}/inventory`;
const sets: string[] = [];
const businesses: string[] = [];
let nonAdminId: string;

async function setFixture() {
  const id = randomUUID();
  const setNumber = `SEC-${randomUUID().slice(0, 10).toUpperCase()}`;
  await pool.query('INSERT INTO "lego_set" (id,"setNumber",name,theme,source,"verificationStatus","createdAt","updatedAt") VALUES ($1,$2,$3,$4,\'MANUAL\',\'UNVERIFIED\',NOW(),NOW())', [id, setNumber, `${prefix} Rocket`, 'Space']);
  sets.push(id);
  return { id, setNumber };
}
async function createBusiness(page: Page, label: string) {
  const name = `${prefix} ${label}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const rows = await pool.query<{id: string}>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(rows.rows).toHaveLength(1);
  businesses.push(rows.rows[0].id);
  return rows.rows[0].id;
}
async function createItem(page: Page, businessId: string, setNumber: string) {
  await page.goto(`${inventory(businessId)}/new`);
  await page.getByRole('textbox', { name: 'Search LEGO sets' }).fill(setNumber);
  await page.getByRole('button', { name: new RegExp(prefix) }).click();
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventory(businessId)}/?$`), { timeout: 20_000 });
  const rows = await pool.query<{id: string; legoSetId: string}>('SELECT id,"legoSetId" FROM "inventory_item" WHERE "businessId"=$1', [businessId]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0];
}
async function snapshot(itemId: string) {
  const result = await pool.query('SELECT "legoSetId",name,theme,"askingPrice","archivedAt" FROM "inventory_item" WHERE id=$1', [itemId]);
  return result.rows[0];
}
async function signInAsNonAdmin(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(nonAdminEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
}

test.describe('LEGO catalog — final authorization and lifecycle boundaries', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestAccount();
    await pool.query('DELETE FROM "user" WHERE email=$1', [nonAdminEmail]);
    const response = await request.post('/api/auth/sign-up/email', { data: { name: 'Consavro E2E User', email, password } });
    expect(response.ok(), await response.text()).toBe(true);
    await request.get(await waitForVerificationUrl());
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
    // Clone only the verified test account's credential into a distinct, non-allowlisted
    // user. This avoids modifying the catalog-admin allowlist or registration policy.
    const user = await pool.query<{id: string}>('SELECT id FROM "user" WHERE email=$1', [email]);
    const credentials = await pool.query<{password: string}>('SELECT password FROM "account" WHERE "userId"=$1 AND "providerId"=$2', [user.rows[0].id, 'credential']);
    expect(credentials.rows[0]?.password).toBeTruthy();
    nonAdminId = randomUUID();
    await pool.query('INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,NOW(),NOW())', [nonAdminId, 'Catalog Nonadmin E2E', nonAdminEmail]);
    await pool.query('INSERT INTO "account" (id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW(),NOW())', [randomUUID(), nonAdminId, 'credential', nonAdminId, credentials.rows[0].password]);
  });
  test.afterEach(async () => {
    for (const id of businesses.splice(0)) await pool.query('DELETE FROM "business" WHERE id=$1', [id]);
    for (const id of sets.splice(0)) await pool.query('DELETE FROM "lego_set" WHERE id=$1', [id]);
  });
  test.afterAll(async () => {
    try {
      await pool.query('DELETE FROM "user" WHERE email=$1', [nonAdminEmail]);
      await resetTestAccount();
    } finally { await pool.end(); }
  });

  test('separate non-admin OWNER cannot access catalog management', async ({ page }) => {
    await signInAsNonAdmin(page);
    const businessId = await createBusiness(page, 'Nonadmin Owner');
    const role = await pool.query('SELECT role FROM "business_member" WHERE "businessId"=$1 AND "userId"=$2', [businessId, nonAdminId]);
    expect(role.rows[0]?.role).toBe('OWNER');
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /LEGO Catalog Management/i })).toHaveCount(0);
    await page.goto('/dashboard/lego-catalog/manage');
    await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add missing LEGO set' })).toHaveCount(0);
  });

  test('non-admin OWNER cannot replay an actual catalog Server Action request', async ({ browser, page }) => {
    // Capture the real Next.js Server Action request from the authorized UI.
    await signIn(page);
    await page.goto('/dashboard/lego-catalog/manage');
    await page.getByRole('button', { name: 'Add missing LEGO set' }).click();
    const setNumber = `REPLAY-${randomUUID().slice(0, 10).toUpperCase()}`;
    await page.getByLabel('Set number').fill(setNumber);
    await page.getByLabel('Name', { exact: true }).fill(`${prefix} Replay`);
    const captured = page.waitForRequest(req => req.method() === 'POST' && !!req.headers()['next-action']);
    await page.getByRole('button', { name: 'Save set' }).click();
    const original = await captured;
    await expect.poll(async () => (await pool.query('SELECT count(*)::int AS count FROM "lego_set" WHERE "setNumber"=$1', [setNumber])).rows[0].count).toBe(1);
    const created = await pool.query<{id: string}>('SELECT id FROM "lego_set" WHERE "setNumber"=$1', [setNumber]);
    sets.push(created.rows[0].id);
    const nonAdminContext = await browser.newContext();
    try {
      const nonAdminPage = await nonAdminContext.newPage();
      await signInAsNonAdmin(nonAdminPage);
      const headers: Record<string,string> = {};
      for (const key of ['next-action', 'next-router-state-tree', 'content-type', 'accept']) {
        const value = original.headers()[key];
        if (value) headers[key] = value;
      }
      // Replaying the same request must not cause any additional catalog mutation.
      // The original request may contain framework-specific state; either rejection
      // or an unchanged database is acceptable, but mutation is never acceptable.
      await nonAdminPage.request.post(original.url(), { headers, data: original.postDataBuffer() ?? undefined, failOnStatusCode: false, maxRedirects: 0 });
      const rows = await pool.query('SELECT count(*)::int AS count FROM "lego_set" WHERE "setNumber"=$1', [setNumber]);
      expect(rows.rows[0].count).toBe(1);
    } finally { await nonAdminContext.close(); }
  });

  test('missing and malformed catalog references cannot alter inventory', async ({ page }) => {
    const set = await setFixture();
    await signIn(page);
    const businessId = await createBusiness(page, 'Invalid Reference');
    const item = await createItem(page, businessId, set.setNumber);
    const before = await snapshot(item.id);
    // UI cannot select arbitrary IDs; verify that navigating to an invalid ID
    // does not silently re-associate the existing inventory record.
    for (const invalid of [randomUUID(), 'not-a-valid-catalog-id']) {
      await page.goto(`${inventory(businessId)}/${item.id}/edit?legoSetId=${encodeURIComponent(invalid)}`);
      await expect(page.getByRole('textbox', { name: 'Search LEGO sets' })).toBeVisible();
      expect(await snapshot(item.id)).toEqual(before);
    }
    await pool.query('DELETE FROM "lego_set" WHERE id=$1', [set.id]);
    sets.splice(sets.indexOf(set.id), 1);
    await expect.poll(async () => (await snapshot(item.id)).legoSetId).toBeNull();
  });

  test('an active sale prevents inventory edit and archive while preserving catalog snapshot', async ({ page }) => {
    const set = await setFixture();
    await signIn(page);
    const businessId = await createBusiness(page, 'Active Sale');
    const item = await createItem(page, businessId, set.setNumber);
    const saleId = randomUUID();
    await pool.query(`INSERT INTO "sale" (id,"businessId","inventoryItemId","itemName","salePrice","commissionRate","commissionAmount","consignorProceeds","soldAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,100,0,0,100,NOW(),NOW(),NOW())`, [saleId, businessId, item.id, `${prefix} Rocket`]);
    const before = await snapshot(item.id);
    await page.goto(`${inventory(businessId)}/${item.id}`);
    await expect(page.getByText(/Cancel that sale before archiving or editing/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Archive item/ })).toHaveCount(0);
    await page.goto(`${inventory(businessId)}/${item.id}/edit`);
    // The edit page is accessible; the Server Action must reject the mutation.
    await expect(page.getByRole('heading', { name: 'Edit inventory item' })).toBeVisible();
    await page.getByRole('textbox', { name: 'LEGO set name / item name' }).fill(`${prefix} Forbidden Active Sale Edit`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Active inventory item not found.' })).toBeVisible();
    expect(await snapshot(item.id)).toEqual(before);
  });
});
