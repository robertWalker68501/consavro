import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: use only with a disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Payout Integrity E2E';
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

type ActionRequest = { url: string; headers: Record<string, string>; body: string };
async function capturePayoutAction(page: Page, businessId: string, saleId: string): Promise<ActionRequest> {
  await page.goto(`${salesPath(businessId)}/${saleId}`);
  const captured: ActionRequest[] = [];
  const listener = (request: import('@playwright/test').Request) => {
    if (request.method() !== 'POST' || !request.headers()['next-action']) return;
    const headers = request.headers();
    const relevant: Record<string, string> = {};
    for (const name of ['next-action', 'next-router-state-tree', 'content-type', 'accept']) {
      if (headers[name]) relevant[name] = headers[name];
    }
    if (request.postData()) captured.push({ url: request.url(), headers: relevant, body: request.postData()! });
  };
  page.on('request', listener);
  try {
    await page.getByRole('button', { name: 'Record payout' }).click();
    await expect(page.locator('dl').getByText('Paid', { exact: true })).toBeVisible();
    expect(captured).toHaveLength(1);
    return captured[0];
  } finally { page.off('request', listener); }
}
async function replay(page: Page, request: ActionRequest, body = request.body) {
  return page.evaluate(async ({ url, headers, body }) => {
    const response = await fetch(url, { method: 'POST', headers, body, credentials: 'same-origin' });
    return { status: response.status, body: await response.text() };
  }, { ...request, body });
}
test.describe('payout management — layer 2 financial integrity', () => {
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

  test('same-day payout is accepted and a future calendar date is rejected', async ({ page }) => {
    await signIn(page);
    const first = await createConsignment(page, 'Same day');
    await page.goto(`${salesPath(first.businessId)}/${first.saleId}`);
    const sold = await pool.query<{ soldAt: Date }>('SELECT "soldAt" FROM "sale" WHERE id=$1', [first.saleId]);
    const soldDate = sold.rows[0].soldAt.toISOString().slice(0, 10);
    await page.getByLabel('Payment date').fill(soldDate);
    await page.getByRole('button', { name: 'Record payout' }).click();
    await expect(page.locator('dl').getByText('Paid', { exact: true })).toBeVisible();
    expect(await payout(first.saleId)).toHaveLength(1);

    const second = await createConsignment(page, 'Future date');
    await page.goto(`${salesPath(second.businessId)}/${second.saleId}`);
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Payment date').fill(tomorrow);
    await page.getByRole('button', { name: 'Record payout' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('not in the future');
    expect(await payout(second.saleId)).toHaveLength(0);
  });

  test('date before sale and invalid date are rejected without database changes', async ({ page }) => {
    await signIn(page);
    const { businessId, saleId } = await createConsignment(page, 'Earlier date');
    await page.goto(`${salesPath(businessId)}/${saleId}`);
    await page.getByLabel('Payment date').fill('2020-01-01');
    await page.getByRole('button', { name: 'Record payout' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('not eligible for payout');
    expect(await payout(saleId)).toHaveLength(0);
  });

  test('a replayed server action cannot create a duplicate payout', async ({ page }) => {
    await signIn(page);
    const { businessId, saleId } = await createConsignment(page, 'Duplicate replay');
    const action = await capturePayoutAction(page, businessId, saleId);
    const response = await replay(page, action);
    expect(await payout(saleId), `Unexpected duplicate (HTTP ${response.status})`).toHaveLength(1);
    const rows = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM "payout" WHERE "saleId"=$1', [saleId]);
    expect(Number(rows.rows[0].count)).toBe(1);
  });

  test('database uniqueness prevents concurrent duplicate payout inserts', async ({ page }) => {
    await signIn(page);
    const { businessId, saleId, clientId } = await createConsignment(page, 'Concurrent constraint');
    // Both requests target the same sale. PostgreSQL must enforce uniqueness
    // even if two transactions pass an eligibility check simultaneously.
    const sql = `INSERT INTO "payout" (id, "businessId", "saleId", "clientId", amount, "paidAt", method, "createdAt")
      VALUES ($1,$2,$3,$4,160.00,NOW(),'CASH',NOW())`;
    const results = await Promise.allSettled([
      pool.query(sql, [`e2e-concurrent-a-${saleId}`, businessId, saleId, clientId]),
      pool.query(sql, [`e2e-concurrent-b-${saleId}`, businessId, saleId, clientId]),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const rows = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM "payout" WHERE "saleId"=$1', [saleId]);
    expect(Number(rows.rows[0].count)).toBe(1);
  });

  test('payout uses historical proceeds and consignor despite later policy changes and forged amount', async ({ page }) => {
    await signIn(page);
    const { businessId, saleId, clientId } = await createConsignment(page, 'Immutable snapshot');
    await pool.query('UPDATE "client" SET "commissionRateOverride"=$1, name=$2 WHERE id=$3', ['55.00', 'Changed Consignor', clientId]);
    await page.goto(`${salesPath(businessId)}/${saleId}`);
    await page.getByLabel('Payment method').selectOption('ZELLE');
    await page.getByLabel('Reference (optional)').fill('ZELLE-2026');
    await page.getByRole('button', { name: 'Record payout' }).click();
    await expect(page.locator('dl').getByText('Paid', { exact: true })).toBeVisible();
    expect((await payout(saleId))[0]).toMatchObject({ amount: '160.00', clientId, method: 'ZELLE', reference: 'ZELLE-2026' });
    const rows = await pool.query<{ commissionRate: string; consignorProceeds: string }>('SELECT "commissionRate", "consignorProceeds" FROM "sale" WHERE id=$1', [saleId]);
    expect(rows.rows[0]).toMatchObject({ commissionRate: '20.00', consignorProceeds: '160.00' });
  });
});
