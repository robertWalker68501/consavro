import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: use only with a disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Sales Lifecycle E2E';
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
async function createItem(page: Page, businessId: string, name: string) {
  await page.goto(`${inventoryPath(businessId)}/new`);
  await page.getByLabel('Item name').fill(name);
  await page.getByLabel('Quantity').fill('3');
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/?$`), { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [businessId, name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function record(page: Page, id: string, name: string, price = '200.00') {
  await page.goto(`${salesPath(id)}/new`);
  await page.getByRole('combobox', { name: 'Inventory item' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await page.getByLabel('Sale price (USD)').fill(price);
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${salesPath(id)}/(?!new(?:/|$))[^/?]+/?$`), { timeout: 20_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const rows = await pool.query<{ id: string }>('SELECT id FROM "sale" WHERE "businessId"=$1 ORDER BY "createdAt" DESC LIMIT 1', [id]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function cancel(page: Page, businessId: string, saleId: string) {
  await page.goto(`${salesPath(businessId)}/${saleId}`);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Cancel sale' }).click();
  await expect(page.locator('dl').getByText('Cancelled', { exact: true })).toBeVisible();
}
async function inventory(itemId: string) {
  const rows = await pool.query<{ archivedAt: Date | null; quantity: number; status: string }>(
    'SELECT "archivedAt", quantity, status FROM "inventory_item" WHERE id=$1', [itemId]);
  return rows.rows[0];
}
async function history(itemId: string) {
  const rows = await pool.query<{ id: string; cancelledAt: Date | null; salePrice: string; consignorName: string | null; commissionRate: string; commissionAmount: string; consignorProceeds: string }>(
    'SELECT id, "cancelledAt", "salePrice", "consignorName", "commissionRate", "commissionAmount", "consignorProceeds" FROM "sale" WHERE "inventoryItemId"=$1 ORDER BY "createdAt", id', [itemId]);
  return rows.rows;
}
async function archiveItem(page: Page, businessId: string, itemId: string) {
  await page.goto(`${inventoryPath(businessId)}/${itemId}`);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/?$`), { timeout: 20_000 });
}

test.describe('sales & transactions — layer 5 integration and lifecycle', () => {
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

  test('inventory detail links to its active sale and disallows archiving while sold', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Active history');
    const itemId = await createItem(page, id, 'LEGO Active History');
    const saleId = await record(page, id, 'LEGO Active History');
    await page.goto(`${inventoryPath(id)}/${itemId}`);
    await expect(page.getByRole('heading', { name: 'Sales history' })).toBeVisible();
    await expect(page.getByRole('link', { name: /200\.00.*Recorded/ })).toHaveAttribute('href', `${salesPath(id)}/${saleId}`);
    await expect(page.getByText('This item has an active sale. Cancel that sale before archiving or editing the item.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archive item' })).toHaveCount(0);
    expect((await inventory(itemId)).archivedAt).toBeNull();
  });

  test('cancelling a sale restores inventory and changes payout status without deleting history', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Cancelled payout');
    const itemId = await createItem(page, id, 'LEGO Cancelled Payout');
    const saleId = await record(page, id, 'LEGO Cancelled Payout', '135.25');
    const original = (await history(itemId))[0];
    await cancel(page, id, saleId);
    await expect(page.locator('dl').getByText('Not applicable — sale cancelled')).toBeVisible();
    await expect.poll(() => inventory(itemId)).toMatchObject({ quantity: 3, status: 'IN_STOCK', archivedAt: null });
    const updated = (await history(itemId))[0];
    expect(updated.cancelledAt).not.toBeNull();
    expect(updated.salePrice).toBe(original.salePrice);
    expect(updated.commissionAmount).toBe(original.commissionAmount);
    expect(updated.consignorProceeds).toBe(original.consignorProceeds);
    await page.goto(`${inventoryPath(id)}/${itemId}`);
    await expect(page.getByRole('link', { name: /135\.25.*Cancelled/ })).toHaveAttribute('href', `${salesPath(id)}/${saleId}`);
  });

  test('archived inventory retains its cancelled sale history and transaction detail link', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Archived history');
    const itemId = await createItem(page, id, 'LEGO Archived History');
    const saleId = await record(page, id, 'LEGO Archived History');
    await cancel(page, id, saleId);
    await archiveItem(page, id, itemId);
    await expect.poll(async () => (await inventory(itemId)).archivedAt).not.toBeNull();
    await page.goto(`${inventoryPath(id)}/${itemId}`);
    await expect(page.getByRole('heading', { name: 'LEGO Archived History' })).toBeVisible();
    await expect(page.getByRole('link', { name: /200\.00.*Cancelled/ })).toHaveAttribute('href', `${salesPath(id)}/${saleId}`);
    await page.goto(`${salesPath(id)}/${saleId}`);
    await expect(page.locator('dl').getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(page.locator('dl').getByText('Not applicable — sale cancelled')).toBeVisible();
  });

  test('commission and consignor snapshots survive consignor archival and policy changes', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Consignor snapshots');
    const itemId = await createItem(page, id, 'LEGO Consignor Snapshot');
    // Attach a same-business consignor and override before recording the sale.
    const clientId = `e2e-${itemId}`;
    await pool.query(
      'INSERT INTO "client" (id, "businessId", name, "commissionRateOverride", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())',
      [clientId, id, 'Consignor Original', '20.00']);
    await pool.query('UPDATE "inventory_item" SET "clientId"=$1 WHERE id=$2', [clientId, itemId]);
    const saleId = await record(page, id, 'LEGO Consignor Snapshot');
    const before = (await history(itemId))[0];
    expect(before.consignorName).toBe('Consignor Original');
    expect(before.commissionRate).toBe('20.00');
    expect(before.commissionAmount).toBe('40.00');
    expect(before.consignorProceeds).toBe('160.00');
    await pool.query(
      'UPDATE "client" SET name=$1, "commissionRateOverride"=$2, "archivedAt"=NOW() WHERE id=$3',
      ['Consignor Renamed', '35.00', clientId]);
    expect((await history(itemId))[0]).toEqual(before);
    await page.goto(`${salesPath(id)}/${saleId}`);
    await expect(page.locator('dl').getByText('Consignor Original', { exact: true })).toBeVisible();
    await expect(page.locator('dl').getByText('20.00%', { exact: true })).toBeVisible();
    await expect(page.locator('dl').getByText('$40.00', { exact: true })).toBeVisible();
    await expect(page.locator('dl').getByText('$160.00', { exact: true })).toBeVisible();
    await expect(page.locator('dl').getByText('Unpaid — payout not yet recorded')).toBeVisible();
    await page.goto(`${inventoryPath(id)}/${itemId}`);
    await expect(page.getByRole('link', { name: 'Consignor Renamed (archived)' })).toBeVisible();
  });

  test('a second sale after cancellation remains separate in inventory history', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Resale history');
    const itemId = await createItem(page, id, 'LEGO Repeat Listing');
    const first = await record(page, id, 'LEGO Repeat Listing', '75.00');
    await cancel(page, id, first);
    const second = await record(page, id, 'LEGO Repeat Listing', '95.00');
    await page.goto(`${inventoryPath(id)}/${itemId}`);
    const section = page.getByRole('heading', { name: 'Sales history' }).locator('..');
    await expect(section.getByRole('link', { name: /75\.00.*Cancelled/ })).toHaveAttribute('href', `${salesPath(id)}/${first}`);
    await expect(section.getByRole('link', { name: /95\.00.*Recorded/ })).toHaveAttribute('href', `${salesPath(id)}/${second}`);
    const sales = await history(itemId);
    expect(sales).toHaveLength(2);
    expect(sales.filter(s => s.cancelledAt !== null)).toHaveLength(1);
    expect(sales.filter(s => s.cancelledAt === null)).toHaveLength(1);
    expect((await inventory(itemId)).status).toBe('SOLD');
  });
});
