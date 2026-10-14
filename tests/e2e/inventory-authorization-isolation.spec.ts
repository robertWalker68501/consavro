import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Destructive setup: use a disposable development/test database only.
// Cleanup is scoped to businesses created by this suite.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Inventory Authorization E2E';
const inventoryPath = (id: string) => `/dashboard/businesses/${id}/inventory`;
type Role = 'OWNER' | 'MANAGER' | 'STAFF';

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
async function userId() {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [email]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function createBusiness(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function createItem(page: Page, businessId: string, name: string) {
  await page.goto(`${inventoryPath(businessId)}/new`);
  await page.getByLabel('Item name').fill(name);
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [businessId, name],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function changeRole(businessId: string, role: Role) {
  const result = await pool.query(
    'UPDATE "business_member" SET role=$1, "updatedAt"=NOW() WHERE "businessId"=$2 AND "userId"=$3',
    [role, businessId, await userId()],
  );
  expect(result.rowCount).toBe(1);
}
async function revoke(businessId: string) {
  const result = await pool.query(
    'DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=$2',
    [businessId, await userId()],
  );
  expect(result.rowCount).toBe(1);
}
async function expectNotFound(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
}
async function itemState(businessId: string, itemId: string) {
  const result = await pool.query<{ name: string; status: string; archivedAt: Date | null }>(
    'SELECT name, status, "archivedAt" FROM "inventory_item" WHERE "businessId"=$1 AND id=$2',
    [businessId, itemId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

test.describe('inventory management — layer 4 authorization and isolation', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => {
    try { await cleanup(); await resetTestAccount(); }
    finally { await pool.end(); }
  });

  test('anonymous users are redirected from inventory list, detail, create, and edit', async ({ page, browser }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Anonymous');
    const itemId = await createItem(page, businessId, 'Private LEGO Item');
    const context = await browser.newContext();
    try {
      const anonymous = await context.newPage();
      for (const url of [inventoryPath(businessId), `${inventoryPath(businessId)}/${itemId}`,
        `${inventoryPath(businessId)}/new`, `${inventoryPath(businessId)}/${itemId}/edit`]) {
        await anonymous.goto(url);
        await expect(anonymous).toHaveURL(/\/sign-in(?:\?|$)/);
      }
    } finally { await context.close(); }
  });

  test('OWNER can view, create, edit, and archive inventory', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Owner');
    const itemId = await createItem(page, businessId, 'Owner LEGO Item');
    await page.goto(`${inventoryPath(businessId)}/${itemId}`);
    await expect(page.getByRole('link', { name: 'Edit item' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Archive item/ })).toBeVisible();
    await page.getByRole('link', { name: 'Edit item' }).click();
    await page.getByLabel('Inventory status').selectOption('RESERVED');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(async () => (await itemState(businessId, itemId)).status).toBe('RESERVED');
  });

  test('MANAGER can create and edit inventory within their business', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Manager');
    await changeRole(businessId, 'MANAGER');
    const itemId = await createItem(page, businessId, 'Manager LEGO Item');
    await page.goto(`${inventoryPath(businessId)}/${itemId}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit inventory item' })).toBeVisible();
    await page.getByLabel('Inventory status').selectOption('SOLD');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(async () => (await itemState(businessId, itemId)).status).toBe('SOLD');
  });

  test('STAFF can read inventory but cannot access create/edit or archive controls', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Staff');
    const itemId = await createItem(page, businessId, 'Staff Readable LEGO');
    await changeRole(businessId, 'STAFF');
    await page.goto(inventoryPath(businessId));
    await expect(page.getByText('Staff Readable LEGO')).toBeVisible();
    await expect(page.getByRole('link', { name: /Add inventory item/ })).toHaveCount(0);
    await page.goto(`${inventoryPath(businessId)}/${itemId}`);
    await expect(page.getByRole('heading', { name: 'Staff Readable LEGO' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit item' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Archive item/ })).toHaveCount(0);
    await expectNotFound(page, `${inventoryPath(businessId)}/new`);
    await expectNotFound(page, `${inventoryPath(businessId)}/${itemId}/edit`);
    expect((await itemState(businessId, itemId)).archivedAt).toBeNull();
  });

  test('a member of one business cannot access another business inventory by direct URL', async ({ page }) => {
    await signIn(page);
    const allowed = await createBusiness(page, 'Allowed');
    const forbidden = await createBusiness(page, 'Forbidden');
    const foreignItem = await createItem(page, forbidden, 'Foreign LEGO Item');
    await revoke(forbidden);
    for (const url of [inventoryPath(forbidden), `${inventoryPath(forbidden)}/new`,
      `${inventoryPath(forbidden)}/${foreignItem}`, `${inventoryPath(forbidden)}/${foreignItem}/edit`]) {
      await expectNotFound(page, url);
    }
    await page.goto(inventoryPath(allowed));
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  });

  test('foreign item IDs cannot be read or edited through an authorized business URL', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'First');
    const second = await createBusiness(page, 'Second');
    const itemId = await createItem(page, second, 'Second Business LEGO');
    await expectNotFound(page, `${inventoryPath(first)}/${itemId}`);
    await expectNotFound(page, `${inventoryPath(first)}/${itemId}/edit`);
    expect((await itemState(second, itemId)).name).toBe('Second Business LEGO');
  });

  test('revoked membership blocks inventory immediately while preserving other business access', async ({ page }) => {
    await signIn(page);
    const retained = await createBusiness(page, 'Retained');
    const revoked = await createBusiness(page, 'Revoked');
    const itemId = await createItem(page, revoked, 'Revoked LEGO Item');
    await revoke(revoked);
    await expectNotFound(page, inventoryPath(revoked));
    await expectNotFound(page, `${inventoryPath(revoked)}/${itemId}`);
    await expectNotFound(page, `${inventoryPath(revoked)}/new`);
    await expectNotFound(page, `${inventoryPath(revoked)}/${itemId}/edit`);
    await page.goto(inventoryPath(retained));
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  });
});
