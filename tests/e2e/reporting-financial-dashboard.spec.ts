import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: run against a disposable E2E database only.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Reporting KPI E2E';
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

test.describe('reporting & analytics — layer 1 financial dashboard', () => {
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

  test('empty business shows zero KPIs and dashboard navigation', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Empty');
    await page.goto(`/dashboard/businesses/${id}`);
    await page.getByRole('link', { name: /Financial dashboard/i }).click();
    await expect(page).toHaveURL(new RegExp(`${reportPath(id)}/?$`));
    await expect(page.getByRole('heading', { name: 'Financial dashboard' })).toBeVisible();
    for (const label of ['Gross sales', 'Business commissions', 'Consignor proceeds', 'Outstanding payouts', 'Payouts recorded']) {
      await expect(kpi(page, label)).toContainText('$0.00');
    }
    await expect(page.getByText('No completed sales in this period.')).toBeVisible();
  });

  test('completed sales show immutable financial totals and linked recent activity', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Sales');
    const name = 'LEGO Reporting City';
    await item(page, id, name);
    const saleId = await sale(page, id, name, '125.00', '2026-01-15');
    const snapshot = await pool.query<{ salePrice: string; commissionAmount: string; consignorProceeds: string }>(
      'SELECT "salePrice", "commissionAmount", "consignorProceeds" FROM "sale" WHERE id=$1', [saleId]);
    await page.goto(reportPath(id));
    const format = (n: string) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    await expect(kpi(page, 'Gross sales')).toContainText(format(snapshot.rows[0].salePrice));
    await expect(kpi(page, 'Business commissions')).toContainText(format(snapshot.rows[0].commissionAmount));
    await expect(kpi(page, 'Consignor proceeds')).toContainText(format(snapshot.rows[0].consignorProceeds));
    await expect(kpi(page, 'Gross sales')).toContainText('1 completed sales');
    await expect(page.getByRole('link', { name })).toHaveAttribute('href', `${salesPath(id)}/${saleId}`);
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('2026-01-15');
  });

  test('inclusive UTC date filters affect sales KPIs but not all-time balances', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Dates');
    await item(page, id, 'LEGO January');
    await item(page, id, 'LEGO February');
    await sale(page, id, 'LEGO January', '100.00', '2026-01-31');
    await sale(page, id, 'LEGO February', '200.00', '2026-02-01');
    await page.goto(reportPath(id));
    await expect(kpi(page, 'Gross sales')).toContainText('$300.00');
    const outstandingBefore = await kpi(page, 'Outstanding payouts').innerText();
    const paidBefore = await kpi(page, 'Payouts recorded').innerText();
    await page.getByLabel('From').fill('2026-01-31');
    await page.getByLabel('To', { exact: true }).fill('2026-01-31');
    await page.getByRole('button', { name: 'Apply dates' }).click();
    await expect(kpi(page, 'Gross sales')).toContainText('$100.00');
    await expect(page.getByRole('link', { name: 'LEGO January' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'LEGO February' })).toHaveCount(0);
    expect(await kpi(page, 'Outstanding payouts').innerText()).toBe(outstandingBefore);
    expect(await kpi(page, 'Payouts recorded').innerText()).toBe(paidBefore);
    await page.getByRole('link', { name: 'Clear dates' }).click();
    await expect(kpi(page, 'Gross sales')).toContainText('$300.00');
  });

  test('future date range shows empty activity without losing all-time totals', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'No matches');
    await item(page, id, 'LEGO Earlier');
    await sale(page, id, 'LEGO Earlier', '80.00', '2026-01-10');
    await page.goto(`${reportPath(id)}?from=2026-06-01&to=2026-06-30`);
    await expect(kpi(page, 'Gross sales')).toContainText('$0.00');
    await expect(kpi(page, 'Gross sales')).toContainText('0 completed sales');
    await expect(page.getByText('No completed sales in this period.')).toBeVisible();
    await expect(kpi(page, 'Payouts recorded')).toContainText('$0.00');
    await expect(page.getByRole('link', { name: /Payout management/i })).toHaveAttribute('href', `/dashboard/businesses/${id}/payouts`);
  });
});
