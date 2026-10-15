import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: only run against a disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Sales Security E2E';
const salesPath = (id: string) => `/dashboard/businesses/${id}/sales`;
const inventoryPath = (id: string) => `/dashboard/businesses/${id}/inventory`;

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
async function createBusiness(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function createItem(page: Page, id: string, name: string) {
  await page.goto(`${inventoryPath(id)}/new`);
  await page.getByLabel('Item name').fill(name);
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryPath(id)}/?$`), { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [id, name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function recordSale(page: Page, id: string, name: string) {
  await page.goto(`${salesPath(id)}/new`);
  await page.getByRole('combobox', { name: 'Inventory item' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await page.getByLabel('Sale price (USD)').fill('80.00');
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  // /sales/new also matches a generic /sales/:id regex. Wait for a real detail route.
  await expect(page).toHaveURL(
    new RegExp(`${salesPath(id)}/(?!new(?:[/?]|$))[^/?]+/?$`),
    { timeout: 20_000 },
  );
  await expect(page.getByRole('heading', { name })).toBeVisible();
  let saleId = '';
  await expect.poll(async () => {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM "sale" WHERE "businessId"=$1', [id],
    );
    saleId = result.rows[0]?.id ?? '';
    return result.rows.length;
  }, { timeout: 10_000 }).toBe(1);
  return saleId;
}
async function role(id: string, value: 'OWNER' | 'MANAGER' | 'STAFF') {
  const result = await pool.query(
    'UPDATE "business_member" SET role=$1, "updatedAt"=NOW() WHERE "businessId"=$2 AND "userId"=(SELECT id FROM "user" WHERE email=$3)',
    [value, id, email]);
  expect(result.rowCount).toBe(1);
}
async function snapshot(id: string) {
  const sales = await pool.query<{ id: string; cancelledAt: Date | null }>('SELECT id, "cancelledAt" FROM "sale" WHERE "businessId"=$1 ORDER BY id', [id]);
  const inventory = await pool.query<{ id: string; quantity: number; status: string }>('SELECT id, quantity, status FROM "inventory_item" WHERE "businessId"=$1 ORDER BY id', [id]);
  return { sales: sales.rows, inventory: inventory.rows };
}
async function expectNotFound(page: Page) {
  // Next.js not-found UI can vary by route and Next version; assert the semantic result.
  await expect(page.getByText(/This page could not be found|404|not found/i).first()).toBeVisible();
}

test.describe('sales & transactions — layer 4 authorization and business isolation', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', { data: { name: 'Consavro E2E User', email, password } });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => { try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); } });

  test('anonymous visitors cannot view sales history, record forms, or sale details', async ({ page, browser }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Anonymous');
    await createItem(page, id, 'LEGO Anonymous Sale');
    const saleId = await recordSale(page, id, 'LEGO Anonymous Sale');
    const anonymous = await browser.newContext();
    try {
      const guest = await anonymous.newPage();
      for (const path of [salesPath(id), `${salesPath(id)}/new`, `${salesPath(id)}/${saleId}`]) {
        await guest.goto(path);
        await expect(guest).toHaveURL(/\/sign-in(?:\?|$)/);
        await expect(guest.getByText('LEGO Anonymous Sale')).toHaveCount(0);
      }
    } finally { await anonymous.close(); }
  });

  test('STAFF can read sales and financial details but cannot access creation or cancellation', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Staff');
    await createItem(page, id, 'LEGO Staff Visibility');
    const saleId = await recordSale(page, id, 'LEGO Staff Visibility');
    await role(id, 'STAFF');
    await page.goto(salesPath(id));
    await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Record sale' })).toHaveCount(0);
    await page.goto(`${salesPath(id)}/${saleId}`);
    await expect(page.getByRole('heading', { name: 'LEGO Staff Visibility' })).toBeVisible();
    await expect(page.locator('dl').getByText('$80.00').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel sale' })).toHaveCount(0);
    await page.goto(`${salesPath(id)}/new`);
    await expectNotFound(page);
    const state = await snapshot(id);
    expect(state.sales).toHaveLength(1);
    expect(state.sales[0].cancelledAt).toBeNull();
    expect(state.inventory[0].status).toBe('SOLD');
  });

  test('role permissions are evaluated per business rather than per user', async ({ page }) => {
    await signIn(page);
    const managed = await createBusiness(page, 'Managed');
    const staff = await createBusiness(page, 'Staff Only');
    await createItem(page, managed, 'LEGO Manager Inventory');
    await createItem(page, staff, 'LEGO Staff Inventory');
    await role(managed, 'MANAGER');
    await role(staff, 'STAFF');
    await page.goto(`${salesPath(managed)}/new`);
    await expect(page.getByRole('heading', { name: 'Record sale' })).toBeVisible();
    await page.goto(`${salesPath(staff)}/new`);
    await expectNotFound(page);
    await page.goto(`${salesPath(staff)}`);
    await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
  });

  test('sale details are restricted to their business even when the user belongs to both', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'First');
    const second = await createBusiness(page, 'Second');
    await createItem(page, first, 'LEGO Secret First');
    const saleId = await recordSale(page, first, 'LEGO Secret First');
    await page.goto(`${salesPath(second)}/${saleId}`);
    await expectNotFound(page);
    await page.goto(salesPath(second));
    await expect(page.getByText('LEGO Secret First')).toHaveCount(0);
    await expect(page.getByText('No sales recorded yet.')).toBeVisible();
  });

  test('foreign inventory cannot appear in another business sale selector', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'Inventory A');
    const second = await createBusiness(page, 'Inventory B');
    await createItem(page, first, 'LEGO Foreign Item');
    await createItem(page, second, 'LEGO Local Item');
    await page.goto(`${salesPath(second)}/new`);
    await page.getByRole('combobox', { name: 'Inventory item' }).click();
    await expect(page.getByRole('option', { name: /LEGO Foreign Item/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /LEGO Local Item/ })).toBeVisible();
    expect((await snapshot(first)).sales).toHaveLength(0);
    expect((await snapshot(second)).sales).toHaveLength(0);
  });

  test('an inaccessible business cannot expose sales after membership is revoked', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Revoked');
    await createItem(page, id, 'LEGO Revoked Inventory');
    const saleId = await recordSale(page, id, 'LEGO Revoked Inventory');
    const before = await snapshot(id);
    const removed = await pool.query(
      'DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=(SELECT id FROM "user" WHERE email=$2)',
      [id, email]);
    expect(removed.rowCount).toBe(1);
    for (const path of [salesPath(id), `${salesPath(id)}/new`, `${salesPath(id)}/${saleId}`]) {
      await page.goto(path);
      await expectNotFound(page);
    }
    expect(await snapshot(id)).toEqual(before);
  });
});
