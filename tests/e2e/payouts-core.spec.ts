import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: use only with a disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Payout Core E2E';
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
test.describe('payout management — layer 1 core workflow', () => {
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

  test('unpaid consignment sale appears in outstanding payouts and is linked to its sale', async ({ page }) => {
    await signIn(page);
    const { businessId, saleId, itemName } = await createConsignment(page, 'Outstanding');
    await page.goto(`/dashboard/businesses/${businessId}/payouts`);
    await expect(page.getByRole('heading', { name: 'Unpaid consignor sales (1)' })).toBeVisible();
    await expect(page.getByRole('link', { name: itemName })).toHaveAttribute('href', `${salesPath(businessId)}/${saleId}`);
    await expect(page.getByRole('heading', { name: 'Payment history (0)' })).toBeVisible();
    expect(await payout(saleId)).toHaveLength(0);
  });

  test('recording a full payout persists exact proceeds, method, reference and notes after reload', async ({ page }) => {
    await signIn(page);
    const { businessId, saleId, clientId } = await createConsignment(page, 'Recorded');
    await submitPayout(page, businessId, saleId, 'BANK_TRANSFER', 'WIRE-2026-001');
    await expect.poll(async () => (await payout(saleId)).length).toBe(1);
    expect((await payout(saleId))[0]).toMatchObject({ amount: '160.00', method: 'BANK_TRANSFER', reference: 'WIRE-2026-001', notes: 'Payout confirmed with consignor', clientId, businessId });
    await page.reload();
    await expect(page.locator('dl').getByText('Paid', { exact: true })).toBeVisible();
    await expect(page.locator('dl').getByText('WIRE-2026-001')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record payout' })).toHaveCount(0);
    await page.goto(`/dashboard/businesses/${businessId}/payouts`);
    await expect(page.getByRole('heading', { name: 'Unpaid consignor sales (0)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment history (1)' })).toBeVisible();
    await expect(page.getByText('WIRE-2026-001')).toBeVisible();
  });

  test('a paid sale cannot be cancelled or paid a second time through normal controls', async ({ page }) => {
    await signIn(page);
    const { businessId, saleId, itemId } = await createConsignment(page, 'Protected');
    await submitPayout(page, businessId, saleId, 'CHECK', 'CHECK-007');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Cancel sale' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Record payout' })).toHaveCount(0);
    expect(await payout(saleId)).toHaveLength(1);
    expect((await inventory(itemId)).status).toBe('SOLD');
    const rows = await pool.query<{ cancelledAt: Date | null }>('SELECT "cancelledAt" FROM "sale" WHERE id=$1', [saleId]);
    expect(rows.rows[0].cancelledAt).toBeNull();
  });

  test('payout amount uses historical sale proceeds after consignor commission changes', async ({ page }) => {
    await signIn(page);
    const { businessId, saleId, clientId } = await createConsignment(page, 'Snapshot');
    await pool.query('UPDATE "client" SET "commissionRateOverride"=$1 WHERE id=$2', ['50.00', clientId]);
    await submitPayout(page, businessId, saleId, 'CASH', 'SNAPSHOT-001');
    expect((await payout(saleId))[0].amount).toBe('160.00');
    const rows = await pool.query<{ commissionRate: string; consignorProceeds: string }>('SELECT "commissionRate", "consignorProceeds" FROM "sale" WHERE id=$1', [saleId]);
    expect(rows.rows[0]).toMatchObject({ commissionRate: '20.00', consignorProceeds: '160.00' });
  });

  test('cancelled consignment sale and business-owned sale do not create payout obligations', async ({ page }) => {
    await signIn(page);
    const { businessId, saleId } = await createConsignment(page, 'Cancelled');
    await cancel(page, businessId, saleId);
    const ownName = 'LEGO Business Owned Payout';
    await createItem(page, businessId, ownName);
    const ownSaleId = await record(page, businessId, ownName);
    await page.goto(`/dashboard/businesses/${businessId}/payouts`);
    await expect(page.getByRole('heading', { name: 'Unpaid consignor sales (0)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment history (0)' })).toBeVisible();
    expect(await payout(saleId)).toHaveLength(0);
    expect(await payout(ownSaleId)).toHaveLength(0);
    await page.goto(`${salesPath(businessId)}/${ownSaleId}`);
    await expect(page.getByRole('button', { name: 'Record payout' })).toHaveCount(0);
  });
});
