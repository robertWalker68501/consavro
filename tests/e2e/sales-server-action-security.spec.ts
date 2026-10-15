import { expect, test, type Page, type Request } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive setup: disposable E2E database only. Replays actual Next.js Server Action requests.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Sales Action E2E';
const salesPath = (id: string) => `/dashboard/businesses/${id}/sales`;
const inventoryPath = (id: string) => `/dashboard/businesses/${id}/inventory`;
type Captured = { url: string; body: string; headers: Record<string, string> };

async function cleanup() { await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]); }
async function business(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function item(page: Page, id: string, name: string) {
  await page.goto(`${inventoryPath(id)}/new`);
  await page.getByLabel('Item name').fill(name);
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryPath(id)}/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [id, name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function count(id: string) {
  const result = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM "sale" WHERE "businessId"=$1', [id]);
  return Number(result.rows[0].count);
}
async function state(itemId: string) {
  const result = await pool.query<{ quantity: number; status: string }>('SELECT quantity, status FROM "inventory_item" WHERE id=$1', [itemId]);
  return result.rows[0];
}
async function sale(id: string) {
  const result = await pool.query<{ id: string; cancelledAt: Date | null }>('SELECT id, "cancelledAt" FROM "sale" WHERE "businessId"=$1 ORDER BY "createdAt" DESC LIMIT 1', [id]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}
async function setRole(id: string, role: 'OWNER' | 'MANAGER' | 'STAFF') {
  const result = await pool.query('UPDATE "business_member" SET role=$1, "updatedAt"=NOW() WHERE "businessId"=$2 AND "userId"=(SELECT id FROM "user" WHERE email=$3)', [role, id, email]);
  expect(result.rowCount).toBe(1);
}
async function capture(page: Page, action: () => Promise<void>): Promise<Captured> {
  const requests: Request[] = [];
  const listener = (request: Request) => {
    if (request.method() === 'POST' && request.headers()['next-action']) requests.push(request);
  };
  page.on('request', listener);
  try {
    await action();
    await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const request = requests[0];
    const original = request.headers();
    const headers: Record<string, string> = {};
    for (const key of ['next-action', 'next-router-state-tree', 'content-type', 'accept']) {
      if (original[key]) headers[key] = original[key];
    }
    const body = request.postData();
    expect(body).toBeTruthy();
    return { url: request.url(), body: body!, headers };
  } finally { page.off('request', listener); }
}
async function replay(page: Page, action: Captured, body: string) {
  return page.evaluate(async ({ url, headers, body }) => {
    const response = await fetch(url, { method: 'POST', headers, body, credentials: 'same-origin' });
    return { status: response.status, text: await response.text() };
  }, { ...action, body });
}
function swap(body: string, from: string, to: string) {
  expect(body, `Expected captured Server Action body to contain ${from}`).toContain(from);
  return body.replace(from, to);
}
async function record(page: Page, id: string, name: string, captureRequest = false) {
  await page.goto(`${salesPath(id)}/new`);
  const submit = async () => {
    await page.getByRole('combobox', { name: 'Inventory item' }).click();
    await page.getByRole('option', { name: new RegExp(name) }).click();
    await page.getByLabel('Sale price (USD)').fill('89.50');
    await page.getByRole('button', { name: 'Record sale', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${salesPath(id)}/(?!new(?:/|$))[^/?]+/?$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect.poll(() => count(id)).toBeGreaterThan(0);
  };
  return captureRequest ? await capture(page, submit) : (await submit(), null);
}
async function cancel(page: Page, id: string, saleId: string) {
  await page.goto(`${salesPath(id)}/${saleId}`);
  return capture(page, async () => {
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Cancel sale' }).click();
    await expect(page.locator('dl').getByText('Cancelled', { exact: true })).toBeVisible();
  });
}

test.describe('sales — direct Server Action authorization', () => {
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

  test('STAFF cannot replay an OWNER sale-creation action using another available item', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Staff create');
    const used = await item(page, id, 'LEGO Action Captured');
    const available = await item(page, id, 'LEGO Action Target');
    const original = await record(page, id, 'LEGO Action Captured', true);
    expect(original).not.toBeNull();
    await setRole(id, 'STAFF');
    const response = await replay(page, original!, swap(original!.body, used, available));
    expect(await count(id), `Unexpected sale creation (HTTP ${response.status})`).toBe(1);
    expect(await state(available)).toEqual({ quantity: 2, status: 'IN_STOCK' });
  });

  test('a forged cross-business inventory ID cannot create a sale or change inventory', async ({ page }) => {
    await signIn(page);
    const a = await business(page, 'Inventory A');
    const b = await business(page, 'Inventory B');
    const used = await item(page, a, 'LEGO Captured A');
    const foreign = await item(page, b, 'LEGO Foreign B');
    const original = await record(page, a, 'LEGO Captured A', true);
    const response = await replay(page, original!, swap(original!.body, used, foreign));
    expect(await count(a), `Cross-business sale (HTTP ${response.status})`).toBe(1);
    expect(await count(b)).toBe(0);
    expect(await state(foreign)).toEqual({ quantity: 2, status: 'IN_STOCK' });
  });

  test('STAFF cannot replay an OWNER cancellation action', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Staff cancel');
    await item(page, id, 'LEGO First Cancel');
    const protectedItem = await item(page, id, 'LEGO Protected Sale');
    await record(page, id, 'LEGO First Cancel');
    const firstSale = (await sale(id)).id;
    await record(page, id, 'LEGO Protected Sale');
    const secondSale = (await sale(id)).id;
    const original = await cancel(page, id, firstSale);
    await setRole(id, 'STAFF');
    const response = await replay(page, original, swap(original.body, firstSale, secondSale));
    const target = await pool.query<{ cancelledAt: Date | null }>('SELECT "cancelledAt" FROM "sale" WHERE id=$1', [secondSale]);
    expect(target.rows[0].cancelledAt, `Unexpected cancellation (HTTP ${response.status})`).toBeNull();
    expect(await state(protectedItem)).toEqual({ quantity: 0, status: 'SOLD' });
  });

  test('a forged sale ID from another business cannot be cancelled', async ({ page }) => {
    await signIn(page);
    const a = await business(page, 'Cancel A');
    const b = await business(page, 'Cancel B');
    await item(page, a, 'LEGO Cancel Source');
    const protectedItem = await item(page, b, 'LEGO Cancel Target');
    await record(page, a, 'LEGO Cancel Source');
    const sourceSale = (await sale(a)).id;
    await record(page, b, 'LEGO Cancel Target');
    const targetSale = (await sale(b)).id;
    const original = await cancel(page, a, sourceSale);
    const response = await replay(page, original, swap(original.body, sourceSale, targetSale));
    const target = await pool.query<{ cancelledAt: Date | null }>('SELECT "cancelledAt" FROM "sale" WHERE id=$1', [targetSale]);
    expect(target.rows[0].cancelledAt, `Cross-business cancellation (HTTP ${response.status})`).toBeNull();
    expect(await state(protectedItem)).toEqual({ quantity: 0, status: 'SOLD' });
  });

  test('revoking membership blocks a previously captured sale-creation action', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Revoked create');
    const used = await item(page, id, 'LEGO Revoked Source');
    const available = await item(page, id, 'LEGO Revoked Target');
    const original = await record(page, id, 'LEGO Revoked Source', true);
    const result = await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=(SELECT id FROM "user" WHERE email=$2)', [id, email]);
    expect(result.rowCount).toBe(1);
    const response = await replay(page, original!, swap(original!.body, used, available));
    expect(await count(id), `Unexpected sale after revocation (HTTP ${response.status})`).toBe(1);
    expect(await state(available)).toEqual({ quantity: 2, status: 'IN_STOCK' });
  });
});
