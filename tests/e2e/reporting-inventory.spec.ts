import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: run only against the disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Inventory Reporting E2E';
const base = (id: string) => `/dashboard/businesses/${id}`;
const report = (id: string) => `${base(id)}/reports/inventory`;
const section = (page: Page, title: string) => page.locator('section, div.app-panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).filter({ has: page.getByRole('heading', { name: title, exact: true }) }).last();
const metric = (page: Page, title: string) => page.getByRole('region', { name: 'Inventory report KPIs' }).locator('div.app-panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
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
async function inventory(page: Page, businessId: string, name: string, quantity = 1, asking = '', estimated = '') {
  await page.goto(`${base(businessId)}/inventory/new`);
  await page.getByLabel('Item name').fill(name);
  await page.getByLabel('Quantity').fill(String(quantity));
  if (asking) await page.getByLabel('Asking price (USD)').fill(asking);
  if (estimated) await page.getByLabel('Estimated value (USD)').fill(estimated);
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${base(businessId)}/inventory/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [businessId, name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function client(page: Page, id: string, name: string) {
  await page.goto(`${base(id)}/clients/new`);
  await page.getByLabel('Client name').fill(name);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`${base(id)}/clients/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "client" WHERE "businessId"=$1 AND name=$2', [id, name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function updateItem(businessId: string, itemId: string, fields: Record<string, unknown>) {
  const allowed = ['clientId', 'status', 'archivedAt', 'createdAt', 'quantity'];
  const entries = Object.entries(fields);
  for (const [field] of entries) if (!allowed.includes(field)) throw new Error(`Invalid fixture field ${field}`);
  if (!entries.length) return;
  await pool.query(`UPDATE "inventory_item" SET ${entries.map(([key], i) => `"${key}"=$${i + 1}`).join(', ')} WHERE id=$${entries.length + 1} AND "businessId"=$${entries.length + 2}`, [...entries.map(([, value]) => value), itemId, businessId]);
}

test.describe('reporting & analytics — layer 3 inventory reporting', () => {
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

  test('empty report shows zero valuations, sell-through, aging, and navigation', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Empty');
    await page.goto(`${base(id)}/reports`);
    await page.locator(`a[href="${report(id)}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${report(id)}/?$`));
    await expect(page.getByRole('heading', { name: 'Inventory reporting' })).toBeVisible();
    await expect(metric(page, 'Unsold listings')).toContainText('0');
    await expect(metric(page, 'Unsold units')).toContainText('0');
    await expect(metric(page, 'Asking value')).toContainText('$0.00');
    await expect(metric(page, 'Estimated value')).toContainText('$0.00');
    await expect(section(page, 'Sell-through · all active listings')).toContainText('0.0%');
    await expect(section(page, 'Unsold inventory by consignor')).toContainText('No unsold inventory matches these filters.');
    await expect(section(page, 'Inventory detail')).toContainText('No inventory matches these filters.');
    await page.getByRole('link', { name: 'Financial dashboard' }).click();
    await expect(page).toHaveURL(new RegExp(`${base(id)}/reports/?$`));
  });

  test('quantities and prices determine valuation; missing prices count as zero', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Valuation');
    const first = await inventory(page, id, 'LEGO Castle Valuation', 3, '125.50', '100.00');
    await inventory(page, id, 'LEGO Space Valuation', 2, '40.00', '30.00');
    await inventory(page, id, 'LEGO No Price', 1);
    await page.goto(report(id));
    await expect(metric(page, 'Unsold listings')).toContainText('3');
    await expect(metric(page, 'Unsold units')).toContainText('6');
    await expect(metric(page, 'Asking value')).toContainText('$456.50');
    await expect(metric(page, 'Estimated value')).toContainText('$360.00');
    await expect(section(page, 'Unsold inventory by consignor').getByRole('row', { name: /Unassigned/ })).toContainText('$456.50');
    await expect(section(page, 'Inventory detail').getByRole('link', { name: 'LEGO Castle Valuation' })).toHaveAttribute('href', `${base(id)}/inventory/${first}`);
    await expect(section(page, 'Inventory detail').getByRole('row', { name: /LEGO No Price/ })).toContainText('—');
  });

  test('status and consignor filters narrow inventory without altering global aging', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Filters');
    const alice = await client(page, id, 'Consignor Alice');
    const bob = await client(page, id, 'Consignor Bob');
    const aliceItem = await inventory(page, id, 'LEGO Alice Stock', 2, '75', '60');
    const bobItem = await inventory(page, id, 'LEGO Bob Reserved', 1, '200', '150');
    await updateItem(id, aliceItem, { clientId: alice });
    await updateItem(id, bobItem, { clientId: bob, status: 'RESERVED' });
    await page.goto(report(id));
    await expect(metric(page, 'Asking value')).toContainText('$350.00');
    await page.locator('select[name="consignor"]').selectOption(alice);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(metric(page, 'Asking value')).toContainText('$150.00');
    await expect(section(page, 'Inventory detail').getByRole('link', { name: 'LEGO Bob Reserved' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(new RegExp(`${report(id)}/?$`));
    await page.locator('select[name="consignor"]').selectOption('');
    await page.locator('select[name="status"]').selectOption('RESERVED');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(metric(page, 'Unsold listings')).toContainText('1');
    await expect(metric(page, 'Asking value')).toContainText('$200.00');
    await expect(section(page, 'Inventory detail').getByRole('link', { name: 'LEGO Alice Stock' })).toHaveCount(0);
    await expect(section(page, 'Unsold inventory aging · all active listings')).toContainText('2');
  });

  test('age buckets use creation date and age filter selects corresponding items', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Aging');
    const fresh = await inventory(page, id, 'LEGO Fresh');
    const middle = await inventory(page, id, 'LEGO Middle');
    const old = await inventory(page, id, 'LEGO Old');
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
    await updateItem(id, fresh, { createdAt: daysAgo(10) });
    await updateItem(id, middle, { createdAt: daysAgo(45) });
    await updateItem(id, old, { createdAt: daysAgo(110) });
    await page.goto(report(id));
    const aging = section(page, 'Unsold inventory aging · all active listings');
    for (const bucket of ['0–30 days', '31–60 days', '91+ days']) {
      await expect(aging.locator('dl > div').filter({ has: page.getByText(bucket, { exact: true }) })).toContainText('1');
    }
    await page.locator('select[name="age"]').selectOption('91+');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(metric(page, 'Unsold listings')).toContainText('1');
    await expect(section(page, 'Inventory detail').getByRole('link', { name: 'LEGO Old' })).toBeVisible();
    await expect(section(page, 'Inventory detail').getByRole('link', { name: 'LEGO Fresh' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(metric(page, 'Unsold listings')).toContainText('3');
  });

  test('sold and archived listings are excluded from unsold value and sell-through denominator', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Lifecycle');
    const available = await inventory(page, id, 'LEGO Available', 2, '100', '80');
    const sold = await inventory(page, id, 'LEGO Sold', 1, '90', '70');
    const archived = await inventory(page, id, 'LEGO Archived', 1, '500', '450');
    await updateItem(id, sold, { status: 'SOLD', quantity: 0 });
    await updateItem(id, archived, { archivedAt: new Date() });
    await page.goto(report(id));
    await expect(metric(page, 'Unsold listings')).toContainText('1');
    await expect(metric(page, 'Unsold units')).toContainText('2');
    await expect(metric(page, 'Asking value')).toContainText('$200.00');
    await expect(section(page, 'Inventory detail').getByRole('link', { name: 'LEGO Archived' })).toHaveCount(0);
    await expect(section(page, 'Inventory detail').getByRole('link', { name: 'LEGO Available' })).toHaveAttribute('href', `${base(id)}/inventory/${available}`);
    await expect(section(page, 'Sell-through · all active listings')).toContainText('0.0%');
    await expect(section(page, 'Sell-through · all active listings')).toContainText('0 sold of 2');
  });
});
