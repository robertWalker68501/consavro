import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: use only with a disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Payout Authorization E2E';
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
test.describe('payout management — layer 4 authorization and isolation', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup(); await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {data:{name:'Consavro E2E User',email,password}});
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified,{timeout:20000}).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => { try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); } });

  test('unauthenticated visitors are redirected away from payout history and sale details', async ({ page }) => {
    await page.goto(payoutPath('unassigned-business'));
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    await page.goto(`${salesPath('unassigned-business')}/unassigned-sale`);
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  });

  test('STAFF can view history but cannot record a payout', async ({ page }) => {
    await signIn(page);
    const {businessId,saleId,itemName} = await createConsignment(page,'Staff read-only');
    await role(businessId,'STAFF');
    await page.goto(payoutPath(businessId));
    await expect(page.getByRole('heading',{name:'Payouts'})).toBeVisible();
    await expect(page.getByRole('link',{name:itemName})).toBeVisible();
    await page.goto(`${salesPath(businessId)}/${saleId}`);
    await expect(page.getByRole('button',{name:'Record payout'})).toHaveCount(0);
    expect(await payoutCount(saleId)).toBe(0);
  });

  test('MANAGER can record a payout', async ({ page }) => {
    await signIn(page);
    const {businessId,saleId} = await createConsignment(page,'Manager allowed');
    await role(businessId,'MANAGER');
    await submitPayout(page,businessId,saleId,'CASH','MANAGER-OK');
    expect(await payoutCount(saleId)).toBe(1);
  });

  test('business membership is required for payout history, even with guessed IDs', async ({ page }) => {
    await signIn(page);
    const {businessId,saleId} = await createConsignment(page,'Membership');
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=(SELECT id FROM "user" WHERE email=$2)',[businessId,email]);
    await page.goto(payoutPath(businessId));
    await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible();
    await page.goto(`${salesPath(businessId)}/${saleId}`);
    await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible();
    expect(await payoutCount(saleId)).toBe(0);
  });

  test('a forged business ID cannot disclose another tenant payout history', async ({ page }) => {
    await signIn(page);
    const first = await createConsignment(page,'Tenant A');
    const second = await createConsignment(page,'Tenant B');
    await submitPayout(page,second.businessId,second.saleId,'VENMO','TENANT-B-SECRET');
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=(SELECT id FROM "user" WHERE email=$2)',[second.businessId,email]);
    await page.goto(`${payoutPath(second.businessId)}?client=${first.clientId}&method=VENMO`);
    await expect(page.getByRole('heading', { name: /404|not found/i })).toBeVisible();
    await page.goto(payoutPath(first.businessId));
    await expect(page.getByText('TENANT-B-SECRET')).toHaveCount(0);
  });
});
