import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: use only against a disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Statements E2E';
const base = (id: string) => `/dashboard/businesses/${id}`;
const statement = (id: string) => `${base(id)}/reports/statements`;

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
async function client(page: Page, id: string, name: string) {
  await page.goto(`${base(id)}/clients/new`);
  await page.getByLabel('Client name').fill(name);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`${base(id)}/clients/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "client" WHERE "businessId"=$1 AND name=$2', [id, name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function item(page: Page, id: string, name: string, consignorId: string) {
  await page.goto(`${base(id)}/inventory/new`);
  await page.getByLabel('Item name').fill(name);
  await page.getByLabel('Quantity').fill('3');
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${base(id)}/inventory/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [id, name]);
  expect(result.rows).toHaveLength(1);
  await pool.query('UPDATE "inventory_item" SET "clientId"=$1 WHERE id=$2 AND "businessId"=$3', [consignorId, result.rows[0].id, id]);
}
async function sale(page: Page, id: string, name: string, price: string, soldDate: string) {
  await page.goto(`${base(id)}/sales/new`);
  await page.getByRole('combobox', { name: 'Inventory item' }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await page.getByLabel('Sale price (USD)').fill(price);
  await page.getByLabel('Sale date').fill(soldDate);
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${base(id)}/sales/(?!new(?:/|$))[^/?]+/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string; commissionAmount: string; consignorProceeds: string }>(
    'SELECT id, "commissionAmount", "consignorProceeds" FROM "sale" WHERE "businessId"=$1 AND "itemName"=$2 ORDER BY "createdAt" DESC LIMIT 1', [id, name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}
async function pay(page: Page, id: string, saleId: string, method = 'ZELLE', reference = 'STATEMENT-001') {
  await page.goto(`${base(id)}/sales/${saleId}`);
  await page.getByLabel('Payment method').selectOption(method);
  await page.getByLabel('Reference (optional)').fill(reference);
  await page.getByRole('button', { name: 'Record payout' }).click();
  await expect(page.locator('dl').getByText('Paid', { exact: true })).toBeVisible();
}
async function choose(page: Page, id: string, consignorId: string) {
  await page.goto(statement(id));
  await page.locator('select[name="client"]').selectOption(consignorId);
  await page.getByRole('button', { name: 'View statement' }).click();
  await expect(page).toHaveURL(new RegExp(`${statement(id)}\\?`));
}
function metric(page: Page, label: string) {
  return page.getByRole('region', { name: 'Consignor statement KPIs' })
    .locator('div.app-panel').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
}
function section(page: Page, heading: RegExp) {
  return page.locator('section.app-panel').filter({ has: page.getByRole('heading', { name: heading }) });
}
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

test.describe('reporting & analytics — layer 4 consignor statements', () => {
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

  test('requires a consignor and displays zero balances for a new consignor', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Empty');
    const consignorId = await client(page, id, 'Empty Consignor');
    await page.goto(`${base(id)}/reports`);
    await page.locator(`a[href="${statement(id)}"]`).click();
    await expect(page.getByRole('heading', { name: 'Consignor statements', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Select a consignor to view a statement' })).toBeVisible();
    await choose(page, id, consignorId);
    await expect(page.getByRole('heading', { name: 'Statement for Empty Consignor' })).toBeVisible();
    for (const label of ['Gross sales', 'Business commissions', 'Consignor proceeds', 'Payouts in period', 'Outstanding balance', 'Total paid']) {
      await expect(metric(page, label)).toContainText('$0.00');
    }
    await expect(section(page, /^Completed sales \(0\)$/)).toContainText('No completed sales in this period.');
    await expect(section(page, /^Recorded payouts \(0\)$/)).toContainText('No payouts recorded in this period.');
    await page.getByRole('link', { name: 'Financial dashboard' }).click();
    await expect(page).toHaveURL(new RegExp(`${base(id)}/reports/?$`));
  });

  test('sale snapshots and recorded payouts yield accurate KPIs and linked history', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Totals');
    const consignorId = await client(page, id, 'Totals Consignor');
    await item(page, id, 'LEGO Paid Castle', consignorId);
    await item(page, id, 'LEGO Unpaid Train', consignorId);
    const paid = await sale(page, id, 'LEGO Paid Castle', '120.00', '2026-02-10');
    const unpaid = await sale(page, id, 'LEGO Unpaid Train', '80.00', '2026-02-11');
    await pay(page, id, paid.id, 'ZELLE', 'STATEMENT-001');
    await choose(page, id, consignorId);
    const commissions = Number(paid.commissionAmount) + Number(unpaid.commissionAmount);
    const proceeds = Number(paid.consignorProceeds) + Number(unpaid.consignorProceeds);
    await expect(metric(page, 'Gross sales')).toContainText('$200.00');
    await expect(metric(page, 'Business commissions')).toContainText(usd(commissions));
    await expect(metric(page, 'Consignor proceeds')).toContainText(usd(proceeds));
    await expect(metric(page, 'Payouts in period')).toContainText(usd(Number(paid.consignorProceeds)));
    await expect(metric(page, 'Outstanding balance')).toContainText(usd(Number(unpaid.consignorProceeds)));
    await expect(metric(page, 'Total paid')).toContainText(usd(Number(paid.consignorProceeds)));
    const sales = section(page, /^Completed sales \(2\)$/);
    await expect(sales.getByRole('link', { name: 'LEGO Paid Castle' })).toHaveAttribute('href', `${base(id)}/sales/${paid.id}`);
    await expect(sales.getByRole('row', { name: /LEGO Paid Castle/ })).toContainText('Paid');
    await expect(sales.getByRole('row', { name: /LEGO Unpaid Train/ })).toContainText('Unpaid');
    const payouts = section(page, /^Recorded payouts \(1\)$/);
    await expect(payouts).toContainText('ZELLE');
    await expect(payouts).toContainText('STATEMENT-001');
  });

  test('inclusive UTC filters use sale date and payout date independently, preserving all-time balances', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Dates');
    const consignorId = await client(page, id, 'Date Consignor');
    await item(page, id, 'LEGO January Statement', consignorId);
    await item(page, id, 'LEGO February Statement', consignorId);
    const january = await sale(page, id, 'LEGO January Statement', '100.00', '2026-01-31');
    const february = await sale(page, id, 'LEGO February Statement', '200.00', '2026-02-01');
    await pay(page, id, january.id);
    // Deterministic payout date for a historical reporting fixture.
    await pool.query('UPDATE "payout" SET "paidAt"=$1 WHERE "saleId"=$2', ['2026-02-01T12:00:00Z', january.id]);
    await choose(page, id, consignorId);
    await page.getByLabel('From', { exact: true }).fill('2026-01-31');
    await page.getByLabel('To', { exact: true }).fill('2026-01-31');
    await page.getByRole('button', { name: 'View statement' }).click();
    await expect(metric(page, 'Gross sales')).toContainText('$100.00');
    await expect(metric(page, 'Payouts in period')).toContainText('$0.00');
    await expect(metric(page, 'Outstanding balance')).toContainText(usd(Number(february.consignorProceeds)));
    await expect(metric(page, 'Total paid')).toContainText(usd(Number(january.consignorProceeds)));
    await expect(section(page, /^Completed sales \(1\)$/)).toContainText('LEGO January Statement');
    await expect(section(page, /^Recorded payouts \(0\)$/)).toContainText('No payouts recorded in this period.');
    await page.getByLabel('From', { exact: true }).fill('2026-02-01');
    await page.getByLabel('To', { exact: true }).fill('2026-02-01');
    await page.getByRole('button', { name: 'View statement' }).click();
    await expect(metric(page, 'Gross sales')).toContainText('$200.00');
    await expect(metric(page, 'Payouts in period')).toContainText(usd(Number(january.consignorProceeds)));
    await expect(section(page, /^Recorded payouts \(1\)$/)).toContainText('LEGO January Statement');
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page.getByRole('heading', { name: 'Select a consignor to view a statement' })).toBeVisible();
  });

  test('switching consignors never mixes financial activity', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Isolation');
    const alice = await client(page, id, 'Alice Statement');
    const bob = await client(page, id, 'Bob Statement');
    await item(page, id, 'LEGO Alice Statement', alice);
    await item(page, id, 'LEGO Bob Statement', bob);
    await sale(page, id, 'LEGO Alice Statement', '90.00', '2026-03-01');
    await sale(page, id, 'LEGO Bob Statement', '160.00', '2026-03-02');
    await choose(page, id, alice);
    await expect(metric(page, 'Gross sales')).toContainText('$90.00');
    await expect(section(page, /^Completed sales \(1\)$/)).toContainText('LEGO Alice Statement');
    await expect(section(page, /^Completed sales \(1\)$/)).not.toContainText('LEGO Bob Statement');
    await page.locator('select[name="client"]').selectOption(bob);
    await page.getByRole('button', { name: 'View statement' }).click();
    await expect(metric(page, 'Gross sales')).toContainText('$160.00');
    await expect(section(page, /^Completed sales \(1\)$/)).toContainText('LEGO Bob Statement');
    await expect(section(page, /^Completed sales \(1\)$/)).not.toContainText('LEGO Alice Statement');
  });

  test('archived consignors remain available and cancelled sales are excluded', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Lifecycle');
    const consignorId = await client(page, id, 'Archived Statement Consignor');
    await item(page, id, 'LEGO Active Statement', consignorId);
    await item(page, id, 'LEGO Cancelled Statement', consignorId);
    const active = await sale(page, id, 'LEGO Active Statement', '75.00', '2026-04-10');
    const cancelled = await sale(page, id, 'LEGO Cancelled Statement', '125.00', '2026-04-11');
    await page.goto(`${base(id)}/sales/${cancelled.id}`);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Cancel sale' }).click();
    await expect(page.locator('dl').getByText('Cancelled', { exact: true })).toBeVisible();
    // Historical archived-client fixture; no changes to financial records.
    await pool.query('UPDATE "client" SET "archivedAt"=NOW() WHERE id=$1 AND "businessId"=$2', [consignorId, id]);
    await page.goto(statement(id));
    await expect(page.locator('select[name="client"] option').filter({ hasText: 'Archived Statement Consignor (archived)' })).toHaveCount(1);
    await page.locator('select[name="client"]').selectOption(consignorId);
    await page.getByRole('button', { name: 'View statement' }).click();
    await expect(page.getByRole('heading', { name: 'Statement for Archived Statement Consignor' })).toBeVisible();
    await expect(page.getByText('Archived consignor', { exact: false })).toBeVisible();
    await expect(metric(page, 'Gross sales')).toContainText('$75.00');
    await expect(metric(page, 'Outstanding balance')).toContainText(usd(Number(active.consignorProceeds)));
    await expect(section(page, /^Completed sales \(1\)$/)).toContainText('LEGO Active Statement');
    await expect(section(page, /^Completed sales \(1\)$/)).not.toContainText('LEGO Cancelled Statement');
  });
});
