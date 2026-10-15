import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: use only against a disposable E2E database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Reporting Security E2E';
const base = (id: string) => `/dashboard/businesses/${id}`;
const statement = (id: string) => `${base(id)}/reports/statements`;
const exportsPath = (id: string, kind: string) => `${base(id)}/reports/export/${kind}`;
async function exportCsv(page: Page, path: string) {
  const result = await page.request.get(path, { maxRedirects: 0 });
  expect(result.status(), `${path}: ${result.status()}`).toBe(200);
  expect(result.headers()['content-type']).toContain('text/csv');
  expect(result.headers()['content-disposition']).toContain('attachment;');
  expect(result.headers()['cache-control']).toContain('no-store');
  return (await result.text()).replace(/^\uFEFF/, '');
}
async function role(id: string, value: 'OWNER' | 'MANAGER' | 'STAFF') {
  await pool.query('UPDATE "business_member" SET role=$1 WHERE "businessId"=$2 AND "userId"=(SELECT id FROM "user" WHERE email=$3)', [value,id,email]);
}


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


test.describe('reporting & analytics — layer 5 authorization, integration and exports', () => {
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

  test('anonymous requests cannot download any of the four exports', async ({ request, page }) => {
    await signIn(page);
    const id = await business(page, 'Anonymous');
    for (const kind of ['sales', 'inventory', 'statements', 'payouts']) {
      const response = await request.get(exportsPath(id, kind), { maxRedirects: 0 });
      expect(response.status(), `${kind}: unauthenticated access`).not.toBe(200);
      expect(response.headers()['content-type'] ?? '').not.toContain('text/csv');
    }
  });

  test('OWNER, MANAGER and STAFF can read reports and export, without granting STAFF write permissions', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Roles');
    for (const current of ['OWNER', 'MANAGER', 'STAFF'] as const) {
      await role(id, current);
      for (const kind of ['sales', 'inventory', 'payouts']) {
        const text = await exportCsv(page, exportsPath(id, kind));
        expect(text).toContain(kind === 'sales' ? 'Sale ID' : kind === 'inventory' ? 'Inventory ID' : 'Payout ID');
      }
      await page.goto(`${base(id)}/reports`);
      await expect(page.getByRole('heading', { name: /Financial dashboard/i })).toBeVisible();
      await page.goto(`${base(id)}/reports/inventory`);
      await expect(page.getByRole('heading', { name: /Inventory reporting/i })).toBeVisible();
      await page.goto(`${base(id)}/reports/sales`);
      await expect(page.getByRole('heading', { name: /Sales reporting/i })).toBeVisible();
    }
    // The protected content is streamed within Suspense: an initial 200 does not
    // prove access. Wait for the loading boundary to settle, then inspect the UI.
    await page.goto(`${base(id)}/inventory/new`);
    await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Add inventory item' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create item' })).toHaveCount(0);
    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
  });

  test('another business and a forged consignor ID cannot expose financial exports', async ({ page }) => {
    await signIn(page);
    const own = await business(page, 'Owned');
    const other = await business(page, 'Other');
    const clientId = await client(page, other, 'Other Business Consignor');
    await item(page, other, 'LEGO Secret Export', clientId);
    await sale(page, other, 'LEGO Secret Export', '275.00', '2026-02-15');
    // Revoke membership in the second business, retaining ownership of the first.
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=(SELECT id FROM "user" WHERE email=$2)', [other,email]);
    for (const kind of ['sales', 'inventory', 'statements', 'payouts']) {
      const res = await page.request.get(exportsPath(other, kind) + (kind === 'statements' ? `?client=${clientId}` : ''), { maxRedirects: 0 });
      expect(res.status(), `${kind}: cross-business export`).not.toBe(200);
      expect((await res.text())).not.toContain('LEGO Secret Export');
    }
    const forged = await page.request.get(`${exportsPath(own, 'statements')}?client=${clientId}`, { maxRedirects: 0 });
    expect(forged.status()).toBe(404);
    const invalid = await page.request.get(exportsPath(own, 'statements'), { maxRedirects: 0 });
    expect(invalid.status()).toBe(400);
  });

  test('sales and inventory CSVs preserve business filters and exclude cancelled or archived records', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Filters');
    const alice = await client(page, id, 'Alice Export');
    const bob = await client(page, id, 'Bob Export');
    await item(page, id, 'LEGO Alice January', alice);
    await item(page, id, 'LEGO Bob February', bob);
    const january = await sale(page, id, 'LEGO Alice January', '100.00', '2026-01-31');
    const february = await sale(page, id, 'LEGO Bob February', '200.00', '2026-02-01');
    const filtered = await exportCsv(page, `${exportsPath(id, 'sales')}?from=2026-01-31&to=2026-01-31&consignor=${alice}`);
    expect(filtered).toContain(january.id);
    expect(filtered).toContain('100.00');
    expect(filtered).not.toContain(february.id);
    const itemRows = await exportCsv(page, `${exportsPath(id, 'inventory')}?consignor=${bob}`);
    expect(itemRows).toContain('LEGO Bob February');
    expect(itemRows).not.toContain('LEGO Alice January');
    await page.goto(`${base(id)}/sales/${february.id}`);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Cancel sale' }).click();
    await expect(page.locator('dl').getByText('Cancelled', { exact: true })).toBeVisible();
    const afterCancellation = await exportCsv(page, exportsPath(id, 'sales'));
    expect(afterCancellation).toContain(january.id);
    expect(afterCancellation).not.toContain(february.id);
    const row = await pool.query<{ id: string }>('SELECT id FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [id,'LEGO Bob February']);
    await pool.query('UPDATE "inventory_item" SET "archivedAt"=NOW() WHERE id=$1', [row.rows[0].id]);
    const inventoryCsv = await exportCsv(page, exportsPath(id, 'inventory'));
    expect(inventoryCsv).toContain('LEGO Alice January');
    expect(inventoryCsv).not.toContain('LEGO Bob February');
  });

  test('statement and payout CSVs agree with immutable sale snapshots and payout history', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Payout');
    const alice = await client(page, id, 'Alice Payout Export');
    const bob = await client(page, id, 'Bob Payout Export');
    await item(page, id, 'LEGO Alice Payout', alice);
    await item(page, id, 'LEGO Bob Unpaid', bob);
    const paid = await sale(page, id, 'LEGO Alice Payout', '150.00', '2026-03-10');
    const unpaid = await sale(page, id, 'LEGO Bob Unpaid', '60.00', '2026-03-11');
    await pay(page, id, paid.id, 'ZELLE', 'CSV-TEST-001');
    const statementCsv = await exportCsv(page, `${exportsPath(id, 'statements')}?client=${alice}`);
    expect(statementCsv).toContain(paid.id);
    expect(statementCsv).toContain('150.00');
    expect(statementCsv).toContain(Number(paid.commissionAmount).toFixed(2));
    expect(statementCsv).toContain(Number(paid.consignorProceeds).toFixed(2));
    expect(statementCsv).toContain('CSV-TEST-001');
    expect(statementCsv).not.toContain(unpaid.id);
    const payoutCsv = await exportCsv(page, `${exportsPath(id, 'payouts')}?client=${alice}&method=ZELLE`);
    expect(payoutCsv).toContain(paid.id);
    expect(payoutCsv).toContain('CSV-TEST-001');
    expect(payoutCsv).toContain(Number(paid.consignorProceeds).toFixed(2));
    expect(payoutCsv).not.toContain(unpaid.id);
    const noMatches = await exportCsv(page, `${exportsPath(id, 'payouts')}?client=${alice}&method=CASH`);
    expect(noMatches).toContain('Payout ID');
    expect(noMatches).not.toContain(paid.id);
    await page.goto(`${base(id)}/payouts`);
    await expect(page.getByRole('link', { name: /Export|Download CSV/i })).toBeVisible();
  });
});
