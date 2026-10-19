import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// The Playwright configuration must reject all database endpoints except Neon dev.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Business Events E2E';
const actorName = 'Consavro E2E User';
const inventory = (id: string) => `/dashboard/businesses/${id}/inventory`;
const sales = (id: string) => `/dashboard/businesses/${id}/sales`;
const recipients = [randomUUID(), randomUUID(), randomUUID()];
const roles = ['OWNER', 'MANAGER', 'STAFF'] as const;

type Notification = { userId: string; businessId: string | null; title: string; message: string; href: string | null; readAt: Date | null };
async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
async function actorId() {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [email]);
  if (!result.rows[0]) throw new Error('Missing E2E actor');
  return result.rows[0].id;
}
async function createBusiness(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(result.rows).toHaveLength(1);
  const id = result.rows[0].id;
  for (let i = 0; i < recipients.length; i++) {
    await pool.query('INSERT INTO "business_member" (id,"businessId","userId",role,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())',
      [randomUUID(), id, recipients[i], roles[i]]);
  }
  return id;
}
async function notifications(id: string): Promise<Notification[]> {
  const result = await pool.query<Notification>('SELECT "userId", "businessId", title, message, href, "readAt" FROM "notification" WHERE "businessId"=$1 ORDER BY "createdAt",id', [id]);
  return result.rows;
}
async function expectEvent(id: string, title: string, item: string, href: string) {
  await expect.poll(async () => (await notifications(id)).filter(n => n.title === title).length).toBe(2);
  const rows = (await notifications(id)).filter(n => n.title === title);
  expect(rows.map(n => n.userId).sort()).toEqual(recipients.slice(0, 2).sort());
  for (const row of rows) {
    expect(row.businessId).toBe(id);
    expect(row.message).toContain(actorName);
    expect(row.message).toContain(item);
    expect(row.href).toBe(href);
    expect(row.readAt).toBeNull();
  }
  const currentActorId = await actorId();
  const allNotifications = await notifications(id);
  expect(allNotifications.some(n => n.userId === currentActorId)).toBe(false);
  expect(allNotifications.some(n => n.userId === recipients[2])).toBe(false);
}
async function createItem(page: Page, id: string, name: string, client?: string) {
  await page.goto(`${inventory(id)}/new`);
  await page.getByLabel('Item name').fill(name);
  if (client) await page.getByLabel('Consignor (client)').selectOption(client);
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventory(id)}/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [id, name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function recordSale(page: Page, id: string, item: string) {
  await page.goto(`${sales(id)}/new`);
  await page.getByRole('combobox', { name: 'Inventory item' }).click();
  await page.getByRole('option', { name: new RegExp(item) }).click();
  await page.getByLabel('Sale price (USD)').fill('100');
  await page.getByLabel('Sale date').fill(new Date().toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  // `/sales/new` also matches a generic `/sales/<segment>` pattern.
  // Require navigation away from the creation form before reading the sale ID.
  await expect(page).toHaveURL(
    new RegExp(`${sales(id)}/(?!new(?:/|$))[^/?]+/?$`),
    { timeout: 20_000 },
  );
  await expect(page.getByRole('heading', { name: item, exact: true })).toBeVisible();
  const saleId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  expect(saleId, 'Sale detail URL should contain the new sale ID').toBeTruthy();
  await expect.poll(async () => {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM "sale" WHERE id=$1 AND "businessId"=$2',
      [saleId, id],
    );
    return result.rows.length;
  }).toBe(1);
  return saleId!;
}

test.describe('notifications — layer 2 business events', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', { data: { name: actorName, email, password } });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
    for (let i = 0; i < recipients.length; i++) {
      await pool.query('INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,NOW(),NOW())',
        [recipients[i], `Business events ${roles[i]}`, `business-events-${recipients[i]}@example.com`]);
    }
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => {
    try {
      await cleanup();
      await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [recipients]);
      await resetTestAccount();
    } finally { await pool.end(); }
  });

  test('inventory creation notifies other owners/managers, names actor, excludes staff and actor', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Create');
    const item = await createItem(page, business, 'LEGO Galaxy Explorer');
    await expectEvent(business, 'Inventory item added', 'LEGO Galaxy Explorer', `${inventory(business)}/${item}`);
  });

  test('inventory updates and archives emit distinct notifications only after successful operations', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Lifecycle');
    const item = await createItem(page, business, 'LEGO Space Shuttle');
    await page.goto(`${inventory(business)}/${item}/edit`);
    await page.getByLabel('Item name').fill('LEGO Space Shuttle Updated');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventory(business)}/${item}/?$`), { timeout: 20_000 });
    await expectEvent(business, 'Inventory item updated', 'LEGO Space Shuttle Updated', `${inventory(business)}/${item}`);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Archive item' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventory(business)}/?$`), { timeout: 20_000 });
    await expectEvent(business, 'Inventory item archived', 'LEGO Space Shuttle Updated', inventory(business));
    expect(await notifications(business)).toHaveLength(6);
  });

  test('recorded and cancelled sales notify only eligible recipients with matching detail link', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Sales');
    await createItem(page, business, 'LEGO Medieval Castle');
    const sale = await recordSale(page, business, 'LEGO Medieval Castle');
    await expectEvent(business, 'Sale recorded', 'LEGO Medieval Castle', `${sales(business)}/${sale}`);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Cancel sale' }).click();
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
    await expectEvent(business, 'Sale cancelled', 'LEGO Medieval Castle', `${sales(business)}/${sale}`);
    expect(await notifications(business)).toHaveLength(6);
  });

  test('recorded consignor payout creates exactly one event; repeat action does not duplicate', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Payout');
    await page.goto(`/dashboard/businesses/${business}/clients/new`);
    await page.getByLabel('Client name').fill('Business Events Consignor');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/businesses/${business}/clients/?$`), { timeout: 20_000 });
    const client = await pool.query<{ id: string }>('SELECT id FROM "client" WHERE "businessId"=$1 AND name=$2', [business, 'Business Events Consignor']);
    expect(client.rows).toHaveLength(1);
    await createItem(page, business, 'LEGO Pirate Ship', client.rows[0].id);
    const sale = await recordSale(page, business, 'LEGO Pirate Ship');
    await page.getByLabel('Payment date').fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Record payout' }).click();
    await expect(page.getByText('Paid', { exact: true })).toBeVisible();
    await expectEvent(business, 'Payout recorded', 'consignor payout', `/dashboard/businesses/${business}/payouts`);
    const payout = await pool.query('SELECT id FROM "payout" WHERE "saleId"=$1', [sale]);
    expect(payout.rows).toHaveLength(1);
    expect((await notifications(business)).filter(n => n.title === 'Payout recorded')).toHaveLength(2);
  });
});
