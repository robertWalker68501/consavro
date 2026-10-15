import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: use only with a disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Payout Action Security E2E';
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

const payoutPath = (id: string) => `/dashboard/businesses/${id}/payouts`;
async function role(businessId: string, value: 'OWNER' | 'MANAGER' | 'STAFF') {
  await pool.query('UPDATE "business_member" SET role=$1 WHERE "businessId"=$2 AND "userId"=(SELECT id FROM "user" WHERE email=$3)', [value, businessId, email]);
}
async function payoutCount(saleId: string) { return (await payout(saleId)).length; }
async function captureAction(page: Page, businessId: string, saleId: string) {
  await page.goto(`${salesPath(businessId)}/${saleId}`);
  let action: { url: string; headers: Record<string,string>; body: string } | undefined;
  const listener = (request: import('@playwright/test').Request) => {
    if (request.method() !== 'POST' || !request.headers()['next-action']) return;
    const headers: Record<string,string> = {};
    for (const key of ['next-action','next-router-state-tree','content-type','accept']) {
      const value = request.headers()[key]; if (value) headers[key] = value;
    }
    if (request.postData()) action = { url: request.url(), headers, body: request.postData()! };
  };
  page.on('request', listener);
  try {
    await page.getByRole('button', { name: 'Record payout' }).click();
    await expect(page.locator('dl').getByText('Paid', { exact: true })).toBeVisible();
    expect(action).toBeDefined();
    return action!;
  } finally { page.off('request', listener); }
}
async function replay(page: Page, action: {url:string;headers:Record<string,string>;body:string}, body = action.body) {
  return page.evaluate(async ({url,headers,body}) => {
    const res = await fetch(url, {method:'POST',headers,body,credentials:'same-origin'});
    return { status: res.status, text: await res.text() };
  }, {...action,body});
}

type CapturedAction = Awaited<ReturnType<typeof captureAction>>;

// Capture a real Next.js Server Action POST while the account is authorized.
// The original payout is committed; all forged attempts target *other* unpaid sales.
async function forgedRequest(page: Page, action: CapturedAction, from: { businessId: string; saleId: string }, to: { businessId: string; saleId: string }) {
  expect(action.body, 'Action payload must expose the source business ID so the forged request is meaningful').toContain(from.businessId);
  expect(action.body, 'Action payload must expose the source sale ID so the forged request is meaningful').toContain(from.saleId);
  const forgedBody = action.body.replaceAll(from.businessId, to.businessId).replaceAll(from.saleId, to.saleId);
  expect(forgedBody, 'The request must be changed before replay').not.toBe(action.body);
  return replay(page, action, forgedBody);
}

async function fixtureWithCapturedAction(page: Page) {
  const source = await createConsignment(page, 'Captured source');
  const action = await captureAction(page, source.businessId, source.saleId);
  expect(await payoutCount(source.saleId)).toBe(1);
  return { source, action };
}

test.describe('payout management — layer 4 forged Server Action security', () => {
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

  test('positive control: a forged request for another eligible sale works while authorized', async ({ page }) => {
    await signIn(page);
    const { source, action } = await fixtureWithCapturedAction(page);
    const target = await createConsignment(page, 'Authorized target');
    const response = await forgedRequest(page, action, source, target);
    expect(await payoutCount(target.saleId), `Captured action replay did not execute (HTTP ${response.status}): ${response.text.slice(0, 250)}`).toBe(1);
    expect((await payout(target.saleId))[0]).toMatchObject({ businessId: target.businessId, clientId: target.clientId, amount: '160.00' });
  });

  test('STAFF cannot bypass read-only permission using a captured payout action', async ({ page }) => {
    await signIn(page);
    const { source, action } = await fixtureWithCapturedAction(page);
    // A different sale in the same business, created while still OWNER.
    const itemName = 'LEGO Staff forged payout';
    const itemId = await createItem(page, source.businessId, itemName);
    const clientId = `e2e-${itemId}`;
    await pool.query('INSERT INTO "client" (id, "businessId", name, "commissionRateOverride", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())', [clientId, source.businessId, 'Staff consignor', '20.00']);
    await pool.query('UPDATE "inventory_item" SET "clientId"=$1 WHERE id=$2', [clientId, itemId]);
    const saleId = await record(page, source.businessId, itemName);
    await role(source.businessId, 'STAFF');
    const response = await forgedRequest(page, action, source, { businessId: source.businessId, saleId });
    expect(await payoutCount(saleId), `STAFF action must not create payout (HTTP ${response.status})`).toBe(0);
    expect(await payoutCount(source.saleId)).toBe(1);
  });

  test('revoked membership blocks a captured payout action', async ({ page }) => {
    await signIn(page);
    const { source, action } = await fixtureWithCapturedAction(page);
    const target = await createConsignment(page, 'Revoked target');
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=(SELECT id FROM "user" WHERE email=$2)', [target.businessId, email]);
    const response = await forgedRequest(page, action, source, target);
    expect(await payoutCount(target.saleId), `Revoked membership must block action (HTTP ${response.status})`).toBe(0);
  });

  test('a forged business and sale ID cannot create a payout in an unassigned tenant', async ({ page }) => {
    await signIn(page);
    const { source, action } = await fixtureWithCapturedAction(page);
    const foreign = await createConsignment(page, 'Foreign tenant');
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=(SELECT id FROM "user" WHERE email=$2)', [foreign.businessId, email]);
    const response = await forgedRequest(page, action, source, foreign);
    expect(await payoutCount(foreign.saleId), `Cross-business payout must be rejected (HTTP ${response.status})`).toBe(0);
    expect(await payoutCount(source.saleId)).toBe(1);
  });

  test('authorized business ID paired with another business sale ID cannot create a payout', async ({ page }) => {
    await signIn(page);
    const { source, action } = await fixtureWithCapturedAction(page);
    const foreign = await createConsignment(page, 'Mismatched sale');
    // Both businesses are accessible, but the sale must belong to the claimed business.
    const response = await forgedRequest(page, action, source, { businessId: source.businessId, saleId: foreign.saleId });
    expect(await payoutCount(foreign.saleId), `Mismatched tenant/sale IDs must be rejected (HTTP ${response.status})`).toBe(0);
    expect(await payoutCount(source.saleId)).toBe(1);
  });
});
