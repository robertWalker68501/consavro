import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// The Playwright configuration must reject all database endpoints except Neon dev.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Activity History E2E';
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


type Activity = {
  id: string; businessId: string; actorId: string | null; actorName: string;
  category: string; title: string; message: string; href: string | null; createdAt: Date;
};
const activityUrl = (id: string) => `/dashboard/businesses/${id}/activity`;
async function activities(id: string): Promise<Activity[]> {
  const result = await pool.query<Activity>(
    'SELECT * FROM "business_activity_event" WHERE "businessId"=$1 ORDER BY "createdAt" DESC,id DESC',
    [id],
  );
  return result.rows;
}
async function expectActivity(id: string, title: string, count = 1) {
  await expect.poll(async () => (await activities(id)).filter(event => event.title === title).length).toBe(count);
  const matching = (await activities(id)).filter(event => event.title === title);
  for (const event of matching) {
    expect(event.actorId).toBe(await actorId());
    expect(event.actorName).toBe(actorName);
    expect(event.createdAt).toBeInstanceOf(Date);
    expect(event.businessId).toBe(id);
  }
  return matching[0];
}
test.describe('notifications — layer 4 business activity history', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: actorName, email, password },
    });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
    for (let i = 0; i < recipients.length; i++) {
      await pool.query(
        'INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,NOW(),NOW())',
        [recipients[i], `Activity history ${roles[i]}`, `activity-history-${recipients[i]}@example.com`],
      );
    }
  });
  test.beforeEach(async () => {
    await cleanup();
    await pool.query('DELETE FROM "notification_preference" WHERE "userId" = ANY($1::text[])', [recipients]);
  });
  test.afterAll(async () => {
    try {
      await cleanup();
      await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [recipients]);
      await resetTestAccount();
    } finally { await pool.end(); }
  });

  test('empty state, workspace link, and actor/timestamp on a newly created item', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Core');
    await page.goto(`/dashboard/businesses/${business}`);
    await page.locator(`a[href="${activityUrl(business)}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${activityUrl(business)}/?$`));
    await expect(page.getByText('No activity yet')).toBeVisible();
    const itemId = await createItem(page, business, 'LEGO Activity Explorer');
    const event = await expectActivity(business, 'Inventory item added');
    expect(event.category).toBe('inventory');
    expect(event.message).toContain('LEGO Activity Explorer');
    expect(event.href).toBe(`${inventory(business)}/${itemId}`);
    await page.goto(activityUrl(business));
    const row = page.getByTestId('activity-event');
    await expect(row).toHaveCount(1);
    await expect(row.first()).toContainText(actorName);
    await expect(row.first().locator('time')).toHaveAttribute('datetime', /\d{4}-\d\d-\d\dT/);
    await expect(row.first().getByRole('link', { name: 'View details' })).toHaveAttribute('href', event.href!);
  });

  test('successful inventory updates and archives create distinct entries', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Lifecycle');
    const itemId = await createItem(page, business, 'LEGO Activity Before');
    await page.goto(`${inventory(business)}/${itemId}/edit`);
    await page.getByLabel('Item name').fill('LEGO Activity After');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventory(business)}/${itemId}/?$`), { timeout: 20_000 });
    await expectActivity(business, 'Inventory item updated');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Archive item' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventory(business)}/?$`), { timeout: 20_000 });
    await expectActivity(business, 'Inventory item archived');
    expect((await activities(business)).map(event => event.title).sort()).toEqual([
      'Inventory item added', 'Inventory item archived', 'Inventory item updated',
    ].sort());
    await page.goto(`${activityUrl(business)}?category=inventory`);
    await expect(page.getByTestId('activity-event')).toHaveCount(3);
  });

  test('sales and payouts appear in separate categories and links remain business scoped', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Sales Payouts');
    await page.goto(`/dashboard/businesses/${business}/clients/new`);
    await page.getByLabel('Client name').fill('Activity History Consignor');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/businesses/${business}/clients/?$`), { timeout: 20_000 });
    const clients = await pool.query<{ id: string }>(
      'SELECT id FROM "client" WHERE "businessId"=$1 AND name=$2', [business, 'Activity History Consignor'],
    );
    expect(clients.rows).toHaveLength(1);
    await createItem(page, business, 'LEGO Activity Castle', clients.rows[0].id);
    const saleId = await recordSale(page, business, 'LEGO Activity Castle');
    const recorded = await expectActivity(business, 'Sale recorded');
    expect(recorded.href).toBe(`${sales(business)}/${saleId}`);
    await page.getByLabel('Payment date').fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Record payout' }).click();
    await expect(page.getByText('Paid', { exact: true })).toBeVisible();
    const payout = await expectActivity(business, 'Payout recorded');
    expect(payout.href).toBe(`/dashboard/businesses/${business}/payouts`);
    await page.goto(`${activityUrl(business)}?category=sales`);
    await expect(page.getByTestId('activity-event')).toHaveCount(1);
    await expect(page.getByTestId('activity-event')).toContainText('Sale recorded');
    await page.goto(`${activityUrl(business)}?category=payouts`);
    await expect(page.getByTestId('activity-event')).toHaveCount(1);
    await expect(page.getByTestId('activity-event')).toContainText('Payout recorded');
  });

  test('activity is independent of notification opt-outs and missing recipients', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Opt Out');
    await pool.query(
      `INSERT INTO "notification_preference" ("userId",inventory,sales,payouts,"updatedAt")
       VALUES ($1,false,false,false,NOW())
       ON CONFLICT ("userId") DO UPDATE SET inventory=false,sales=false,payouts=false,"updatedAt"=NOW()`,
      [recipients[0]],
    );
    await pool.query(
      `INSERT INTO "notification_preference" ("userId",inventory,sales,payouts,"updatedAt")
       VALUES ($1,false,false,false,NOW())
       ON CONFLICT ("userId") DO UPDATE SET inventory=false,sales=false,payouts=false,"updatedAt"=NOW()`,
      [recipients[1]],
    );
    await createItem(page, business, 'LEGO Activity Without Alerts');
    await expectActivity(business, 'Inventory item added');
    expect(await notifications(business)).toHaveLength(0);
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=ANY($2::text[])',
      [business, recipients]);
    await createItem(page, business, 'LEGO Activity No Recipients');
    await expectActivity(business, 'Inventory item added', 2);
    expect(await notifications(business)).toHaveLength(0);
  });

  test('business isolation and filters do not expose unrelated records', async ({ page }) => {
    await signIn(page);
    const businessA = await createBusiness(page, 'Tenant A');
    const businessB = await createBusiness(page, 'Tenant B');
    await createItem(page, businessA, 'LEGO Private Alpha');
    await createItem(page, businessB, 'LEGO Private Beta');
    await page.goto(activityUrl(businessA));
    await expect(page.getByTestId('activity-event')).toHaveCount(1);
    await expect(page.getByTestId('activity-event')).toContainText('LEGO Private Alpha');
    await expect(page.getByText('LEGO Private Beta')).toHaveCount(0);
    await page.locator(`nav[aria-label="Activity filters"] a[href="${activityUrl(businessA)}?category=sales&page=1"]`).click();
    await expect(page.getByText('No activity yet')).toBeVisible();
    await page.locator(`nav[aria-label="Activity filters"] a[href="${activityUrl(businessA)}?category=all&page=1"]`).click();
    await expect(page.getByTestId('activity-event')).toHaveCount(1);
    await page.goto(activityUrl(businessB));
    await expect(page.getByTestId('activity-event')).toContainText('LEGO Private Beta');
    await expect(page.getByText('LEGO Private Alpha')).toHaveCount(0);
  });

  test('pagination shows 25 events per page without duplication', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Pagination');
    const actor = await actorId();
    for (let i = 0; i < 27; i++) {
      await pool.query(
        `INSERT INTO "business_activity_event"
          (id,"businessId","actorId","actorName",category,title,message,href,"createdAt")
         VALUES ($1,$2,$3,$4,'inventory','Inventory item updated',$5,NULL,$6)`,
        [randomUUID(), business, actor, actorName, `Page fixture ${i}`, new Date(Date.now() - i * 60_000)],
      );
    }
    await page.goto(activityUrl(business));
    await expect(page.getByTestId('activity-event')).toHaveCount(25);
    await expect(page.getByText('Page 1')).toBeVisible();
    await page.getByRole('link', { name: 'Next' }).click();
    await expect(page.getByTestId('activity-event')).toHaveCount(2);
    await expect(page.getByText('Page 2')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Previous' })).toBeVisible();
  });

  test('unauthenticated visitors cannot view activity history', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto('/dashboard/businesses/forged-business-id/activity');
      await expect(page).toHaveURL(/\/sign-in/, { timeout: 20_000 });
    } finally {
      await context.close();
    }
  });
});
