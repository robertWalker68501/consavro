import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: run against a disposable E2E database only.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Sales Reporting E2E';
const reportPath = (id: string) => `/dashboard/businesses/${id}/reports`;
const salesPath = (id: string) => `/dashboard/businesses/${id}/sales`;

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
async function business(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function item(page: Page, id: string, name: string) {
  await page.goto(`/dashboard/businesses/${id}/inventory/new`);
  await page.getByLabel('Item name').fill(name);
  await page.getByLabel('Quantity').fill('3');
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/businesses/${id}/inventory/?$`), { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [id, name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function sale(page: Page, id: string, name: string, price: string, date: string) {
  await page.goto(`${salesPath(id)}/new`);
  await page.getByRole('combobox', { name: 'Inventory item' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await page.getByLabel('Sale price (USD)').fill(price);
  await page.getByLabel('Sale date').fill(date);
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${salesPath(id)}/(?!new(?:/|$))[^/?]+/?$`), { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "sale" WHERE "businessId"=$1 AND "itemName"=$2 ORDER BY "createdAt" DESC LIMIT 1', [id, name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
function kpi(page: Page, label: string) {
  return page.getByRole('region', { name: 'Financial KPIs' }).locator('div.app-panel').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
}


const reportingPath = (id: string) => `${reportPath(id)}/sales`;
const money = (n: string) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
function metric(page: Page, label: string) {
  return page.getByRole('region', { name: 'Sales report KPIs' }).locator('div.app-panel').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
}
function section(page: Page, heading: string) {
  return page.locator('section.app-panel').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
}
async function client(page: Page, id: string, name: string) {
  await page.goto(`/dashboard/businesses/${id}/clients/new`);
  await page.getByLabel('Client name').fill(name);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/businesses/${id}/clients/?$`), { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "client" WHERE "businessId"=$1 AND name=$2', [id, name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function assignConsignor(id: string, itemId: string, clientId: string) {
  // Fixture setup through the database; reporting itself is exercised through the UI.
  await pool.query('UPDATE "inventory_item" SET "clientId"=$1 WHERE id=$2 AND "businessId"=$3', [clientId, itemId, id]);
}

test.describe('reporting & analytics — layer 2 sales reporting', () => {
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

  test('empty report shows zero KPIs, empty breakdowns, and breadcrumb navigation', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Empty');
    await page.goto(reportPath(id));
    await page.locator(`a[href="${reportingPath(id)}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${reportingPath(id)}/?$`));
    await expect(page.getByRole('heading', { name: 'Sales reporting' })).toBeVisible();
    await expect(metric(page, 'Completed sales')).toContainText('0');
    for (const label of ['Gross revenue', 'Business commissions', 'Consignor proceeds']) {
      await expect(metric(page, label)).toContainText('$0.00');
    }
    for (const heading of ['Sales by inventory item', 'Sales by consignor', 'Sales detail']) {
      await expect(section(page, heading)).toContainText('No completed sales match these filters.');
    }
    await page.getByRole('link', { name: 'Financial dashboard' }).click();
    await expect(page).toHaveURL(new RegExp(`${reportPath(id)}/?$`));
  });

  test('completed sales produce accurate snapshot totals, breakdowns and detail links', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Totals');
    await item(page, id, 'LEGO Castle');
    await item(page, id, 'LEGO Train');
    const first = await sale(page, id, 'LEGO Castle', '120.00', '2026-02-10');
    const second = await sale(page, id, 'LEGO Train', '80.00', '2026-02-11');
    const rows = await pool.query<{ salePrice: string; commissionAmount: string; consignorProceeds: string }>(
      'SELECT "salePrice", "commissionAmount", "consignorProceeds" FROM "sale" WHERE id=ANY($1::text[])', [[first, second]]);
    expect(rows.rows).toHaveLength(2);
    await page.goto(reportingPath(id));
    await expect(metric(page, 'Completed sales')).toContainText('2');
    await expect(metric(page, 'Gross revenue')).toContainText('$200.00');
    await expect(metric(page, 'Business commissions')).toContainText(money(String(rows.rows.reduce((a, r) => a + Number(r.commissionAmount), 0))));
    await expect(metric(page, 'Consignor proceeds')).toContainText(money(String(rows.rows.reduce((a, r) => a + Number(r.consignorProceeds), 0))));
    const byItem = section(page, 'Sales by inventory item');
    await expect(byItem.getByRole('row', { name: /LEGO Castle/ })).toContainText('$120.00');
    await expect(byItem.getByRole('row', { name: /LEGO Train/ })).toContainText('$80.00');
    const detail = section(page, 'Sales detail');
    await expect(detail.getByRole('link', { name: 'LEGO Castle' })).toHaveAttribute('href', `${salesPath(id)}/${first}`);
    await expect(detail.getByRole('link', { name: 'LEGO Train' })).toHaveAttribute('href', `${salesPath(id)}/${second}`);
    await expect(detail.getByRole('row', { name: /LEGO Castle/ })).toContainText('2026-02-10');
  });

  test('inclusive UTC date filtering narrows totals and detail and can be cleared', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Dates');
    await item(page, id, 'LEGO January');
    await item(page, id, 'LEGO February');
    await sale(page, id, 'LEGO January', '100.00', '2026-01-31');
    await sale(page, id, 'LEGO February', '200.00', '2026-02-01');
    await page.goto(reportingPath(id));
    await expect(metric(page, 'Gross revenue')).toContainText('$300.00');
    await page.getByLabel('From', { exact: true }).fill('2026-01-31');
    await page.getByLabel('To', { exact: true }).fill('2026-01-31');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(metric(page, 'Gross revenue')).toContainText('$100.00');
    await expect(metric(page, 'Completed sales')).toContainText('1');
    await expect(section(page, 'Sales detail').getByRole('link', { name: 'LEGO January' })).toBeVisible();
    await expect(section(page, 'Sales detail').getByRole('link', { name: 'LEGO February' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(metric(page, 'Gross revenue')).toContainText('$300.00');
  });

  test('inventory item filter isolates sales and future date range produces empty results', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Items');
    const selected = await item(page, id, 'LEGO Spaceship');
    await item(page, id, 'LEGO Pirate Ship');
    await sale(page, id, 'LEGO Spaceship', '175.00', '2026-03-05');
    await sale(page, id, 'LEGO Pirate Ship', '65.00', '2026-03-06');
    await page.goto(reportingPath(id));
    await page.getByLabel('Inventory item').selectOption(selected);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(metric(page, 'Gross revenue')).toContainText('$175.00');
    await expect(section(page, 'Sales detail').getByRole('link', { name: 'LEGO Pirate Ship' })).toHaveCount(0);
    await page.getByLabel('From', { exact: true }).fill('2099-01-01');
    await page.getByLabel('To', { exact: true }).fill('2099-01-31');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(metric(page, 'Completed sales')).toContainText('0');
    await expect(section(page, 'Sales detail')).toContainText('No completed sales match these filters.');
  });

  test('consignor filter limits the report to sales for the selected client', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Consignors');
    const firstClient = await client(page, id, 'Consignor Alice');
    const secondClient = await client(page, id, 'Consignor Bob');
    const firstItem = await item(page, id, 'LEGO Alice Set');
    const secondItem = await item(page, id, 'LEGO Bob Set');
    await assignConsignor(id, firstItem, firstClient);
    await assignConsignor(id, secondItem, secondClient);
    await sale(page, id, 'LEGO Alice Set', '90.00', '2026-04-10');
    await sale(page, id, 'LEGO Bob Set', '150.00', '2026-04-11');
    await page.goto(reportingPath(id));
    await expect(metric(page, 'Gross revenue')).toContainText('$240.00');
    await page.getByLabel('Consignor').selectOption(firstClient);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(metric(page, 'Gross revenue')).toContainText('$90.00');
    await expect(section(page, 'Sales by consignor').getByRole('row', { name: /Consignor Alice/ })).toBeVisible();
    await expect(section(page, 'Sales detail').getByRole('link', { name: 'LEGO Bob Set' })).toHaveCount(0);
  });
});
