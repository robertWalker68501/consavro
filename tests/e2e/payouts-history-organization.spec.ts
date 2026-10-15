import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: use only with a disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Payout History E2E';
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

const payoutPath = (businessId: string) => `/dashboard/businesses/${businessId}/payouts`;
async function additionalConsignment(page: Page, businessId: string, suffix: string) {
  const itemName = `LEGO History ${suffix}`;
  const itemId = await createItem(page, businessId, itemName);
  const clientId = `e2e-${itemId}`;
  await pool.query('INSERT INTO "client" (id, "businessId", name, "commissionRateOverride", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())', [clientId, businessId, `Consignor ${suffix}`, '20.00']);
  await pool.query('UPDATE "inventory_item" SET "clientId"=$1 WHERE id=$2', [clientId, itemId]);
  const saleId = await record(page, businessId, itemName);
  return { saleId, clientId, itemName };
}
async function seedHistory(page: Page) {
  const first = await createConsignment(page, 'History First');
  const second = await additionalConsignment(page, first.businessId, 'Second');
  const third = await additionalConsignment(page, first.businessId, 'Third');
  await submitPayout(page, first.businessId, first.saleId, 'ZELLE', 'ZELLE-001');
  await submitPayout(page, first.businessId, second.saleId, 'VENMO', 'VENMO-002');
  await submitPayout(page, first.businessId, third.saleId, 'CHECK', 'CHECK-003');
  return { businessId: first.businessId, first, second, third };
}
test.describe('payout management — layer 3 history and organization', () => {
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

  test('all-time paid and matching totals reflect recorded payouts', async ({ page }) => {
    await signIn(page);
    const { businessId, first, second, third } = await seedHistory(page);
    await page.goto(payoutPath(businessId));
    await expect(page.getByRole('heading', { name: 'Payment history (3)' })).toBeVisible();
    await expect(page.getByText('3 payouts')).toBeVisible();
    await expect(page.getByText('3 matching payouts')).toBeVisible();
    await expect(page.getByText('$480.00')).toHaveCount(2);
    for (const item of [first, second, third]) {
      await expect(page.getByRole('link', { name: item.itemName })).toHaveAttribute('href', `${salesPath(businessId)}/${item.saleId}`);
    }
    await expect(page.getByText('Reference: ZELLE-001')).toBeVisible();
    await expect(page.getByText('Notes: Payout confirmed with consignor')).toHaveCount(3);
  });

  test('consignor filter selects one client and clear restores full history', async ({ page }) => {
    await signIn(page);
    const { businessId, first, second } = await seedHistory(page);
    await page.goto(payoutPath(businessId));
    await page.getByLabel('Consignor').selectOption(first.clientId);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByRole('heading', { name: 'Payment history (1)' })).toBeVisible();
    await expect(page.getByRole('link', { name: first.itemName })).toBeVisible();
    await expect(page.getByRole('link', { name: second.itemName })).toHaveCount(0);
    await expect(page.getByText('1 matching payouts')).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page.getByRole('heading', { name: 'Payment history (3)' })).toBeVisible();
  });

  test('payment method filter supports Zelle and Venmo and keeps all-time totals', async ({ page }) => {
    await signIn(page);
    const { businessId, first, second } = await seedHistory(page);
    await page.goto(payoutPath(businessId));
    await page.getByLabel('Payment method').selectOption('ZELLE');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByRole('heading', { name: 'Payment history (1)' })).toBeVisible();
    await expect(page.getByRole('link', { name: first.itemName })).toBeVisible();
    await expect(page.getByText('3 payouts')).toBeVisible();
    await page.getByLabel('Payment method').selectOption('VENMO');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByRole('link', { name: second.itemName })).toBeVisible();
    await expect(page.getByRole('link', { name: first.itemName })).toHaveCount(0);
  });

  test('inclusive date range and combined filters restrict matching payments', async ({ page }) => {
    await signIn(page);
    const { businessId, first, second, third } = await seedHistory(page);
    // Set deterministic historical dates; payout records are immutable through the UI.
    await pool.query('UPDATE "payout" SET "paidAt"=$1 WHERE "saleId"=$2', ['2026-01-10T12:00:00Z', first.saleId]);
    await pool.query('UPDATE "payout" SET "paidAt"=$1 WHERE "saleId"=$2', ['2026-01-11T12:00:00Z', second.saleId]);
    await pool.query('UPDATE "payout" SET "paidAt"=$1 WHERE "saleId"=$2', ['2026-01-12T12:00:00Z', third.saleId]);
    await page.goto(payoutPath(businessId));
    await page.getByLabel('From date').fill('2026-01-10');
    await page.getByLabel('To date').fill('2026-01-11');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByRole('heading', { name: 'Payment history (2)' })).toBeVisible();
    await expect(page.getByRole('link', { name: third.itemName })).toHaveCount(0);
    await page.getByLabel('Payment method').selectOption('VENMO');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByRole('heading', { name: 'Payment history (1)' })).toBeVisible();
    await expect(page.getByRole('link', { name: second.itemName })).toBeVisible();
  });

  test('unpaid sales stay visible when payment history filters have no matches', async ({ page }) => {
    await signIn(page);
    const first = await createConsignment(page, 'Unpaid');
    await page.goto(`${payoutPath(first.businessId)}?method=ZELLE`);
    await expect(page.getByRole('heading', { name: 'Unpaid consignor sales (1)' })).toBeVisible();
    await expect(page.getByRole('link', { name: first.itemName })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment history (0)' })).toBeVisible();
    await expect(page.getByText('No payouts match these filters.')).toBeVisible();
  });
});
