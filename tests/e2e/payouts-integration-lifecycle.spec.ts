import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: use only with a disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Payout Lifecycle E2E';
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


async function createConsignment(page: Page, suffix: string) {
  const businessId = await createBusiness(page, suffix);
  const itemName = `LEGO Payout ${suffix}`;
  const itemId = await createItem(page, businessId, itemName);
  const clientId = `e2e-${itemId}`;
  await pool.query('INSERT INTO "client" (id, "businessId", name, "commissionRateOverride", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())', [clientId, businessId, `Consignor ${suffix}`, '20.00']);
  await pool.query('UPDATE "inventory_item" SET "clientId"=$1 WHERE id=$2', [clientId, itemId]);
  const saleId = await record(page, businessId, itemName);
  return { businessId, itemId, saleId, clientId, itemName };
}
async function payout(saleId: string) {
  const rows = await pool.query<{ id: string; amount: string; method: string; reference: string | null; notes: string | null; clientId: string; businessId: string }>('SELECT id, amount, method, reference, notes, "clientId", "businessId" FROM "payout" WHERE "saleId"=$1', [saleId]);
  return rows.rows;
}
async function submitPayout(page: Page, businessId: string, saleId: string, method: string, reference: string) {
  await page.goto(`${salesPath(businessId)}/${saleId}`);
  await page.getByLabel('Payment method').selectOption(method);
  await page.getByLabel('Reference (optional)').fill(reference);
  await page.getByLabel('Notes (optional)').fill('Payout confirmed with consignor');
  await page.getByRole('button', { name: 'Record payout' }).click();
  await expect(page.locator('dl').getByText('Paid', { exact: true })).toBeVisible();
}

const payoutsPath = (id: string) => `/dashboard/businesses/${id}/payouts`;

test.describe('payout management — layer 5 integration and lifecycle', () => {
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

  test('cancelling an unpaid consignment sale restores inventory and removes its obligation', async ({ page }) => {
    await signIn(page);
    const { businessId, itemId, saleId, itemName } = await createConsignment(page, 'Cancel unpaid');
    const before = await inventory(itemId);
    expect(before.quantity).toBe(0);
    expect(before.status).toBe('SOLD');
    await page.goto(payoutsPath(businessId));
    await expect(page.getByRole('heading', { name: 'Unpaid consignor sales (1)' })).toBeVisible();
    await cancel(page, businessId, saleId);
    const after = await inventory(itemId);
    expect(after.quantity).toBe(3);
    expect(after.status).not.toBe('SOLD');
    expect((await history(itemId)).find(s => s.id === saleId)?.cancelledAt).not.toBeNull();
    await page.goto(payoutsPath(businessId));
    await expect(page.getByRole('heading', { name: 'Unpaid consignor sales (0)' })).toBeVisible();
    await expect(page.getByRole('link', { name: itemName })).toHaveCount(0);
    expect(await payout(saleId)).toHaveLength(0);
  });

  test('a paid sale stays active, inventory stays sold, and a second payout is unavailable', async ({ page }) => {
    await signIn(page);
    const { businessId, itemId, saleId } = await createConsignment(page, 'Paid lifecycle');
    await submitPayout(page, businessId, saleId, 'VENMO', 'LIFECYCLE-PAID');
    await page.reload();
    await expect(page.locator('dl').getByText('Paid', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel sale' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Record payout' })).toHaveCount(0);
    expect((await history(itemId)).find(s => s.id === saleId)?.cancelledAt).toBeNull();
    expect((await inventory(itemId)).quantity).toBe(0);
    expect((await inventory(itemId)).status).toBe('SOLD');
    expect(await payout(saleId)).toHaveLength(1);
    await page.goto(payoutsPath(businessId));
    await expect(page.getByRole('heading', { name: 'Unpaid consignor sales (0)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment history (1)' })).toBeVisible();
  });

  test('a later commission change does not change sale or payout snapshots', async ({ page }) => {
    await signIn(page);
    const { businessId, itemId, saleId, clientId } = await createConsignment(page, 'Historical proceeds');
    await pool.query('UPDATE "client" SET "commissionRateOverride"=$1 WHERE id=$2', ['75.00', clientId]);
    await submitPayout(page, businessId, saleId, 'ZELLE', 'LIFECYCLE-SNAPSHOT');
    const recorded = (await history(itemId)).find(s => s.id === saleId);
    expect(recorded).toMatchObject({ salePrice: '200.00', commissionRate: '20.00', commissionAmount: '40.00', consignorProceeds: '160.00' });
    expect((await payout(saleId))[0]).toMatchObject({ amount: '160.00', clientId, method: 'ZELLE' });
  });

  test('payout persists through navigation between sales, inventory, and history', async ({ page }) => {
    await signIn(page);
    const { businessId, itemId, saleId, itemName } = await createConsignment(page, 'Navigate');
    await submitPayout(page, businessId, saleId, 'BANK_TRANSFER', 'LIFECYCLE-NAV');
    await page.goto(`${inventoryPath(businessId)}/${itemId}`);
    await expect(page.getByRole('heading', { name: itemName })).toBeVisible();
    await page.goto(payoutsPath(businessId));
    await expect(page.getByRole('heading', { name: 'Payment history (1)' })).toBeVisible();
    await expect(page.getByText('Reference: LIFECYCLE-NAV')).toBeVisible();
    await page.getByRole('link', { name: itemName }).click();
    await expect(page.locator('dl').getByText('Paid', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('dl').getByText('LIFECYCLE-NAV')).toBeVisible();
    expect(await payout(saleId)).toHaveLength(1);
  });

  test('business-owned sales never create consignor obligations or payout records', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Business owned');
    const itemName = 'LEGO Lifecycle Business Owned';
    const itemId = await createItem(page, businessId, itemName);
    const saleId = await record(page, businessId, itemName);
    const sale = (await history(itemId)).find(s => s.id === saleId);
    expect(sale?.consignorName).toBeNull();
    await page.goto(`${salesPath(businessId)}/${saleId}`);
    await expect(page.getByRole('button', { name: 'Record payout' })).toHaveCount(0);
    await page.goto(payoutsPath(businessId));
    await expect(page.getByRole('heading', { name: 'Unpaid consignor sales (0)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment history (0)' })).toBeVisible();
    expect(await payout(saleId)).toHaveLength(0);
  });
});
