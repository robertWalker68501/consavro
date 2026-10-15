import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive setup: run only against a disposable development/test database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Sales Inventory E2E';
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
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function createItem(page: Page, businessId: string, name: string, quantity = '3') {
  await page.goto(`${inventoryPath(businessId)}/new`);
  await page.getByLabel('Item name').fill(name);
  await page.getByLabel('Quantity').fill(quantity);
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [businessId, name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function inventory(itemId: string) {
  const result = await pool.query<{ quantity: number; status: string }>(
    'SELECT quantity, status FROM "inventory_item" WHERE id=$1', [itemId]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}
async function sale(businessId: string) {
  const result = await pool.query<{
    id: string; inventoryQuantityBefore: number | null; inventoryStatusBefore: string | null;
    cancelledAt: Date | null; salePrice: string; commissionAmount: string; consignorProceeds: string;
  }>('SELECT id, "inventoryQuantityBefore", "inventoryStatusBefore", "cancelledAt", "salePrice", "commissionAmount", "consignorProceeds" FROM "sale" WHERE "businessId"=$1', [businessId]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}
async function recordSale(page: Page, businessId: string, name: string, price = '99.95') {
  await page.goto(`${salesPath(businessId)}/new`);
  await page.getByRole('combobox', { name: 'Inventory item' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await page.getByLabel('Sale price (USD)').fill(price);
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${salesPath(businessId)}/[^/?]+/?$`), { timeout: 20_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible();
}
async function cancel(page: Page) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel sale' }).click();
  await expect(page.locator('dl').getByText('Cancelled', { exact: true })).toBeVisible();
}
async function changeRole(businessId: string, role: 'OWNER' | 'MANAGER' | 'STAFF') {
  const result = await pool.query(
    'UPDATE "business_member" SET role=$1, "updatedAt"=NOW() WHERE "businessId"=$2 AND "userId"=(SELECT id FROM "user" WHERE email=$3)',
    [role, businessId, email]);
  expect(result.rowCount).toBe(1);
}

test.describe('sales & transactions — layer 3 inventory integration', () => {
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

  test('recording a sale fulfills inventory and stores the original quantity and status', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Fulfillment');
    const itemId = await createItem(page, businessId, 'LEGO Inventory Fulfilled', '3');
    await recordSale(page, businessId, 'LEGO Inventory Fulfilled');
    await expect.poll(() => inventory(itemId)).toEqual({ quantity: 0, status: 'SOLD' });
    const row = await sale(businessId);
    expect(row.inventoryQuantityBefore).toBe(3);
    expect(row.inventoryStatusBefore).toBe('IN_STOCK');
    await page.goto(`${inventoryPath(businessId)}/${itemId}`);
    await expect(page.locator('dl').getByText('Sold', { exact: true })).toBeVisible();
    await expect(page.locator('dl').getByText('0', { exact: true })).toBeVisible();
  });

  test('fulfilled inventory cannot be sold again or edited while the sale is active', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Protection');
    const itemId = await createItem(page, businessId, 'LEGO Protected Listing');
    await recordSale(page, businessId, 'LEGO Protected Listing');
    await page.goto(`${salesPath(businessId)}/new`);
    await page.getByRole('combobox', { name: 'Inventory item' }).click();
    await expect(page.getByRole('option', { name: 'LEGO Protected Listing' })).toHaveCount(0);
    await page.goto(`${inventoryPath(businessId)}/${itemId}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit inventory item' })).toBeVisible();
    await page.getByLabel('Item name').fill('Attempted inventory edit');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('alert').getByText('Active inventory item not found.')).toBeVisible();
    const unchanged = await pool.query<{ name: string }>('SELECT name FROM "inventory_item" WHERE id=$1', [itemId]);
    expect(unchanged.rows[0].name).toBe('LEGO Protected Listing');
    expect((await inventory(itemId)).status).toBe('SOLD');
  });

  test('cancellation restores inventory and retains the cancelled sale financial history', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Cancellation');
    const itemId = await createItem(page, businessId, 'LEGO Restored Listing', '4');
    await recordSale(page, businessId, 'LEGO Restored Listing', '129.50');
    const before = await sale(businessId);
    await cancel(page);
    await expect.poll(() => inventory(itemId)).toEqual({ quantity: 4, status: 'IN_STOCK' });
    const after = await sale(businessId);
    expect(after.id).toBe(before.id);
    expect(after.cancelledAt).not.toBeNull();
    expect(after.salePrice).toBe(before.salePrice);
    expect(after.commissionAmount).toBe(before.commissionAmount);
    expect(after.consignorProceeds).toBe(before.consignorProceeds);
    await expect(page.locator('dl dd').filter({ hasText: '$129.50' }).first()).toBeVisible();
    await page.reload();
    await expect(page.locator('dl').getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel sale' })).toHaveCount(0);
    await page.goto(salesPath(businessId));
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  });

  test('restored inventory can be sold again without reactivating the old sale', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Resale');
    const itemId = await createItem(page, businessId, 'LEGO Resale Listing', '2');
    await recordSale(page, businessId, 'LEGO Resale Listing', '45.00');
    await cancel(page);
    await recordSale(page, businessId, 'LEGO Resale Listing', '55.00');
    await expect.poll(() => inventory(itemId)).toEqual({ quantity: 0, status: 'SOLD' });
    const result = await pool.query<{ cancelledAt: Date | null; salePrice: string }>(
      'SELECT "cancelledAt", "salePrice" FROM "sale" WHERE "businessId"=$1 ORDER BY "createdAt", id', [businessId]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.filter(row => row.cancelledAt !== null)).toHaveLength(1);
    expect(result.rows.filter(row => row.cancelledAt === null)).toHaveLength(1);
    expect(result.rows.map(row => row.salePrice).sort()).toEqual(['45.00', '55.00']);
  });

  test('STAFF can view sales but cannot cancel; MANAGER can cancel', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Permissions');
    const itemId = await createItem(page, businessId, 'LEGO Role Cancellation');
    await recordSale(page, businessId, 'LEGO Role Cancellation');
    const row = await sale(businessId);
    await changeRole(businessId, 'STAFF');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'LEGO Role Cancellation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel sale' })).toHaveCount(0);
    expect((await sale(businessId)).cancelledAt).toBeNull();
    await changeRole(businessId, 'MANAGER');
    await page.goto(`${salesPath(businessId)}/${row.id}`);
    await cancel(page);
    await expect.poll(() => inventory(itemId)).toEqual({ quantity: 3, status: 'IN_STOCK' });
  });
});
