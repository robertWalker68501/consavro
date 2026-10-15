import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive setup: run only against a disposable development/test database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Sales Core E2E';
const salesPath = (businessId: string) => `/dashboard/businesses/${businessId}/sales`;
const inventoryPath = (businessId: string) => `/dashboard/businesses/${businessId}/inventory`;
const saleDate = '2025-05-14';

type SaleRow = { id: string; businessId: string; inventoryItemId: string; itemName: string; salePrice: string; soldAt: Date; notes: string | null };

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
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
async function createItem(page: Page, businessId: string, name: string, quantity = '2') {
  await page.goto(`${inventoryPath(businessId)}/new`);
  await page.getByLabel('Item name').fill(name);
  await page.getByLabel('Quantity').fill(quantity);
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [businessId, name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function sales(businessId: string): Promise<SaleRow[]> {
  const result = await pool.query<SaleRow>('SELECT id, "businessId", "inventoryItemId", "itemName", "salePrice", "soldAt", notes FROM "sale" WHERE "businessId"=$1 ORDER BY "createdAt", id', [businessId]);
  return result.rows;
}
async function chooseItem(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Inventory item' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(page.getByRole('combobox', { name: 'Inventory item' })).toContainText(name);
}
async function recordSale(page: Page, businessId: string, itemName: string, price: string, notes = '') {
  await page.goto(`${salesPath(businessId)}/new`);
  await chooseItem(page, itemName);
  await page.getByLabel('Sale price (USD)').fill(price);
  await page.getByLabel('Sale date').fill(saleDate);
  if (notes) await page.getByLabel('Notes').fill(notes);
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${salesPath(businessId)}/[^/?]+/?$`), { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: itemName })).toBeVisible();
}
async function changeRole(businessId: string, role: 'OWNER' | 'MANAGER' | 'STAFF') {
  const result = await pool.query('UPDATE "business_member" SET role=$1, "updatedAt"=NOW() WHERE "businessId"=$2 AND "userId"=(SELECT id FROM "user" WHERE email=$3)', [role, businessId, email]);
  expect(result.rowCount).toBe(1);
}

test.describe('sales & transactions — layer 1 core workflow', () => {
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

  test('OWNER sees empty sales history and can navigate to Record sale', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Empty');
    await page.goto(`/dashboard/businesses/${id}`);
    await page.getByRole('link', { name: /View sales/ }).click();
    await expect(page).toHaveURL(new RegExp(`${salesPath(id)}/?$`));
    await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
    await expect(page.getByText('No sales recorded yet.')).toBeVisible();
    await page.getByRole('link', { name: 'Record sale' }).click();
    await expect(page.getByRole('heading', { name: 'Record sale' })).toBeVisible();
    expect(await sales(id)).toHaveLength(0);
  });

  test('OWNER records a sale with exact price, date and notes; detail persists after reload', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Create');
    const itemId = await createItem(page, id, 'LEGO Botanical Collection');
    await recordSale(page, id, 'LEGO Botanical Collection', '149.95', 'Customer paid in store');
    await expect.poll(async () => (await sales(id)).length).toBe(1);
    const [sale] = await sales(id);
    expect(sale).toMatchObject({ businessId: id, inventoryItemId: itemId, itemName: 'LEGO Botanical Collection', salePrice: '149.95', notes: 'Customer paid in store' });
    expect(sale.soldAt.toISOString().slice(0, 10)).toBe(saleDate);
    await expect(page.locator('dl dd').getByText('$149.95', { exact: true }).first()).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'Customer paid in store' })).toBeVisible();
    await expect(page.locator('dl').getByRole('link', { name: 'LEGO Botanical Collection', exact: true })).toHaveAttribute('href', `${inventoryPath(id)}/${itemId}`);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'LEGO Botanical Collection' })).toBeVisible();
    await expect(page.locator('dl dd').getByText('$149.95', { exact: true }).first()).toBeVisible();
  });

  test('sales history shows saved transactions and navigates to their details', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'History');
    await createItem(page, id, 'LEGO Castle');
    await createItem(page, id, 'LEGO Train');
    await recordSale(page, id, 'LEGO Castle', '79.50');
    await recordSale(page, id, 'LEGO Train', '129.00');
    await page.goto(salesPath(id));
    await expect(page.getByText('2 sales')).toBeVisible();
    await expect(page.getByRole('link', { name: /LEGO Castle/ })).toContainText('$79.50');
    await expect(page.getByRole('link', { name: /LEGO Train/ })).toContainText('$129.00');
    await page.getByRole('link', { name: /LEGO Castle/ }).click();
    await expect(page.getByRole('heading', { name: 'LEGO Castle' })).toBeVisible();
    expect(await sales(id)).toHaveLength(2);
  });

  test('missing inventory and invalid prices do not create transactions', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Validation');
    await createItem(page, id, 'LEGO Technic');
    await page.goto(`${salesPath(id)}/new`);
    await page.getByRole('button', { name: 'Record sale', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${salesPath(id)}/new/?$`));
    expect(await sales(id)).toHaveLength(0);
    await chooseItem(page, 'LEGO Technic');
    await page.getByLabel('Sale price (USD)').fill('12.345');
    await page.getByRole('button', { name: 'Record sale', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${salesPath(id)}/new/?$`));
    expect(await sales(id)).toHaveLength(0);
  });

  test('unavailable inventory is excluded from the sale selector', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Availability');
    await createItem(page, id, 'LEGO Available');
    await createItem(page, id, 'LEGO Zero Quantity', '0');
    await page.goto(`${salesPath(id)}/new`);
    await page.getByRole('combobox', { name: 'Inventory item' }).click();
    await expect(page.getByRole('option', { name: 'LEGO Available' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'LEGO Zero Quantity' })).toHaveCount(0);
  });

  test('MANAGER can record sales; STAFF can read history but not open Record sale', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Roles');
    await createItem(page, id, 'LEGO Roles');
    await changeRole(id, 'MANAGER');
    await recordSale(page, id, 'LEGO Roles', '40.00');
    await changeRole(id, 'STAFF');
    await page.goto(salesPath(id));
    await expect(page.getByRole('link', { name: /LEGO Roles/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Record sale' })).toHaveCount(0);
    await page.goto(`${salesPath(id)}/new`);
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
    expect(await sales(id)).toHaveLength(1);
  });

  test('sales and inventory selectors remain isolated between businesses', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'Tenant A');
    const second = await createBusiness(page, 'Tenant B');
    await createItem(page, first, 'LEGO First Tenant');
    await createItem(page, second, 'LEGO Second Tenant');
    await recordSale(page, second, 'LEGO Second Tenant', '88.00');
    const [foreignSale] = await sales(second);
    await page.goto(`${salesPath(first)}/new`);
    await page.getByRole('combobox', { name: 'Inventory item' }).click();
    await expect(page.getByRole('option', { name: 'LEGO First Tenant' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'LEGO Second Tenant' })).toHaveCount(0);
    await page.goto(salesPath(first));
    await expect(page.getByText('No sales recorded yet.')).toBeVisible();
    await page.goto(`${salesPath(first)}/${foreignSale.id}`);
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
    expect(await sales(first)).toHaveLength(0);
  });
});
