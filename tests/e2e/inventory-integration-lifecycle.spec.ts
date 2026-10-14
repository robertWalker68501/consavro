import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive setup: run against a disposable development/test database only.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Inventory Lifecycle E2E';
const inventory = (businessId: string) => `/dashboard/businesses/${businessId}/inventory`;
const clients = (businessId: string) => `/dashboard/businesses/${businessId}/clients`;

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
async function createClient(page: Page, businessId: string, name: string) {
  await page.goto(`${clients(businessId)}/new`);
  await page.getByLabel('Client name').fill(name);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`${clients(businessId)}/?$`), { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "client" WHERE "businessId"=$1 AND name=$2', [businessId, name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
type Item = { id: string; clientId: string | null; archivedAt: Date | null; name: string; status: string; askingPrice: string | null; estimatedValue: string | null };
async function getItem(businessId: string, name: string): Promise<Item> {
  const rows = await pool.query<Item>('SELECT id, "clientId", "archivedAt", name, status, "askingPrice", "estimatedValue" FROM "inventory_item" WHERE "businessId"=$1 AND name=$2', [businessId, name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0];
}
async function createItem(page: Page, businessId: string, name: string, consignorId?: string) {
  await page.goto(`${inventory(businessId)}/new`);
  await page.getByLabel('Item name').fill(name);
  if (consignorId) await page.getByLabel('Consignor (client)').selectOption(consignorId);
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventory(businessId)}/?$`), { timeout: 20_000 });
  return getItem(businessId, name);
}
async function archiveClient(page: Page, businessId: string, clientId: string) {
  await page.goto(`${clients(businessId)}/${clientId}`);
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Archive client' }).click();
  await expect.poll(async () => {
    const rows = await pool.query<{ archivedAt: Date | null }>('SELECT "archivedAt" FROM "client" WHERE id=$1', [clientId]);
    return rows.rows[0]?.archivedAt ?? null;
  }).not.toBeNull();
}
async function archiveItem(page: Page, businessId: string, itemId: string, name: string) {
  await page.goto(`${inventory(businessId)}/${itemId}`);
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Archive item' }).click();
  await expect.poll(async () => (await getItem(businessId, name)).archivedAt).not.toBeNull();
}

test.describe('inventory management — layer 5 integration and lifecycle', () => {
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

  test('inventory assignment links to the correct consignor and survives reload', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Assignment');
    const clientId = await createClient(page, businessId, 'LEGO Consignor');
    const item = await createItem(page, businessId, 'Consigned LEGO Set', clientId);
    expect(item.clientId).toBe(clientId);
    await page.goto(`${inventory(businessId)}/${item.id}`);
    await expect(page.getByRole('link', { name: 'LEGO Consignor' })).toHaveAttribute('href', `${clients(businessId)}/${clientId}`);
    await page.reload();
    await expect(page.getByRole('link', { name: 'LEGO Consignor' })).toBeVisible();
  });

  test('archiving a client retains existing consignment and disables new assignment', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Client Archive');
    const clientId = await createClient(page, businessId, 'Archived LEGO Consignor');
    const item = await createItem(page, businessId, 'Existing Consignment', clientId);
    await archiveClient(page, businessId, clientId);
    expect((await getItem(businessId, item.name)).clientId).toBe(clientId);
    await page.goto(`${inventory(businessId)}/${item.id}`);
    await expect(page.getByRole('link', { name: 'Archived LEGO Consignor (archived)' })).toBeVisible();
    await page.goto(`${inventory(businessId)}/new`);
    await expect(page.getByRole('option', { name: 'Archived LEGO Consignor (archived)' })).toHaveAttribute('disabled', '');
  });

  test('consignors from another business cannot be assigned through inventory form', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'Tenant A');
    const second = await createBusiness(page, 'Tenant B');
    await createClient(page, second, 'Foreign Consignor');
    await page.goto(`${inventory(first)}/new`);
    await expect(page.getByRole('option', { name: 'Foreign Consignor' })).toHaveCount(0);
    await page.getByLabel('Item name').fill('Local Inventory');
    await page.getByRole('button', { name: 'Create item' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventory(first)}/?$`), { timeout: 20_000 });
    expect((await getItem(first, 'Local Inventory')).clientId).toBeNull();
  });

  test('archiving inventory retains its database record and blocks edits', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Inventory Archive');
    const item = await createItem(page, businessId, 'Retained LEGO Set');
    await archiveItem(page, businessId, item.id, item.name);
    await page.goto(`${inventory(businessId)}/${item.id}`);
    await expect(page.getByRole('heading', { name: item.name })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit item' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive item' })).toHaveCount(0);
    await page.goto(`${inventory(businessId)}/${item.id}/edit`);
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
    expect((await getItem(businessId, item.name)).archivedAt).not.toBeNull();
  });

  test('archived inventory is separated from active inventory while keeping consignor link', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Archive Lists');
    const clientId = await createClient(page, businessId, 'List Consignor');
    const item = await createItem(page, businessId, 'Archived List LEGO', clientId);
    await archiveItem(page, businessId, item.id, item.name);
    await page.goto(inventory(businessId));
    await expect(page.locator('main ul > li > a').filter({ hasText: item.name })).toHaveCount(0);
    await page.getByRole('link', { name: 'Archived items' }).click();
    await expect(page).toHaveURL(/archived=true/);
    await expect(page.locator('main ul > li > a').filter({ hasText: item.name })).toHaveCount(1);
    expect((await getItem(businessId, item.name)).clientId).toBe(clientId);
  });
});
