import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Destructive setup/cleanup: run only against a disposable Neon development/test database.
// This suite owns only businesses whose names start with the prefix below.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Inventory Core E2E';

type InventoryRow = {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  quantity: number;
  description: string | null;
  archivedAt: Date | null;
};

const inventoryPath = (businessId: string) => `/dashboard/businesses/${businessId}/inventory`;

async function cleanup() {
  // Inventory items cascade when their test business is removed.
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}

async function createBusiness(page: Page, suffix: string): Promise<string> {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name = $1', [name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}

async function rows(businessId: string): Promise<InventoryRow[]> {
  const result = await pool.query<InventoryRow>(
    'SELECT id, "businessId", name, sku, quantity, description, "archivedAt" FROM "inventory_item" WHERE "businessId" = $1 ORDER BY "createdAt", id',
    [businessId],
  );
  return result.rows;
}

async function createItem(
  page: Page, businessId: string, name: string,
  options: { sku?: string; quantity?: string; description?: string } = {},
) {
  await page.goto(`${inventoryPath(businessId)}/new`);
  await expect(page.getByRole('heading', { name: 'Add inventory item' })).toBeVisible();
  await page.getByLabel('Item name').fill(name);
  if (options.sku !== undefined) await page.getByLabel('Internal SKU').fill(options.sku);
  if (options.quantity !== undefined) await page.getByLabel('Quantity').fill(options.quantity);
  if (options.description !== undefined) await page.getByLabel('Description').fill(options.description);
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/?$`), { timeout: 20_000 });
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
}

test.describe('inventory management — layer 1 core CRUD', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `E2E registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });

  test.beforeEach(cleanup);

  test.afterAll(async () => {
    try {
      await cleanup();
      await resetTestAccount();
    } finally {
      await pool.end();
    }
  });

  test('OWNER can open an empty inventory list from the business workspace', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Empty');
    await page.goto(`/dashboard/businesses/${businessId}`);
    await page.getByRole('link', { name: /View inventory/ }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/?$`));
    await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
    await expect(page.getByText('No active inventory items yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add item' })).toBeVisible();
    expect(await rows(businessId)).toHaveLength(0);
  });

  test('OWNER creates an item with SKU, quantity, and description scoped to their business', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Create');
    await createItem(page, businessId, 'LEGO Creator Expert Bookshop', {
      sku: 'LEGO-10270', quantity: '2', description: 'Sealed box, excellent condition',
    });
    const items = await rows(businessId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      businessId, name: 'LEGO Creator Expert Bookshop', sku: 'LEGO-10270',
      quantity: 2, description: 'Sealed box, excellent condition', archivedAt: null,
    });
  });

  test('active list and item details remain visible after reload', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Details');
    await createItem(page, businessId, 'LEGO Botanical Orchid', { sku: '10311', quantity: '3' });
    const [item] = await rows(businessId);
    await page.reload();
    await expect(page.getByRole('link', { name: /LEGO Botanical Orchid/ })).toBeVisible();
    await page.goto(`${inventoryPath(businessId)}/${item.id}`);
    await expect(page.getByRole('heading', { name: 'LEGO Botanical Orchid' })).toBeVisible();
    await expect(page.locator('p.app-subtitle')).toHaveText('In stock');
    await expect(page.getByText('10311', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'LEGO Botanical Orchid' })).toBeVisible();
  });

  test('OWNER edits an item and changes persist in the database and after reload', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Edit');
    await createItem(page, businessId, 'Original LEGO Item', { sku: 'OLD', quantity: '1' });
    const [item] = await rows(businessId);
    await page.goto(`${inventoryPath(businessId)}/${item.id}`);
    await page.getByRole('link', { name: 'Edit item' }).click();
    await page.getByLabel('Item name').fill('Updated LEGO Item');
    await page.getByLabel('Internal SKU').fill('NEW-123');
    await page.getByLabel('Quantity').fill('4');
    await page.getByLabel('Description').fill('Updated internal notes');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/${item.id}/?$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Updated LEGO Item' })).toBeVisible();
    await expect.poll(async () => (await rows(businessId))[0]?.name).toBe('Updated LEGO Item');
    expect((await rows(businessId))[0]).toMatchObject({
      id: item.id, sku: 'NEW-123', quantity: 4, description: 'Updated internal notes',
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Updated LEGO Item' })).toBeVisible();
  });

  test('optional SKU and description can be omitted and later cleared', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Optional');
    await createItem(page, businessId, 'LEGO Simple Item');
    const [item] = await rows(businessId);
    expect(item).toMatchObject({ sku: null, description: null, quantity: 1 });
    await page.goto(`${inventoryPath(businessId)}/${item.id}/edit`);
    await page.getByLabel('Internal SKU').fill('TEMP-SKU');
    await page.getByLabel('Description').fill('Temporary notes');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/${item.id}/?$`), { timeout: 20_000 });
    await page.goto(`${inventoryPath(businessId)}/${item.id}/edit`);
    await page.getByLabel('Internal SKU').fill('');
    await page.getByLabel('Description').fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/${item.id}/?$`), { timeout: 20_000 });
    expect((await rows(businessId))[0]).toMatchObject({ sku: null, description: null });
  });

  test('archiving removes an item from the active list without deleting its record', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Archive');
    await createItem(page, businessId, 'LEGO Archive Candidate');
    const [item] = await rows(businessId);
    await page.goto(`${inventoryPath(businessId)}/${item.id}`);
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Archive item' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/?$`), { timeout: 20_000 });
    await expect(page.getByRole('link', { name: /LEGO Archive Candidate/ })).toHaveCount(0);
    await expect.poll(async () => Boolean((await rows(businessId))[0]?.archivedAt)).toBe(true);
    expect((await rows(businessId))[0].id).toBe(item.id);
  });

  test('archived items retain their details and cannot be edited through normal navigation', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Archived');
    await createItem(page, businessId, 'LEGO Retained Item', { sku: 'RETAIN', description: 'Keep this record' });
    const [item] = await rows(businessId);
    await page.goto(`${inventoryPath(businessId)}/${item.id}`);
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Archive item' }).click();
    await page.getByRole('link', { name: 'Archived items' }).click();
    await expect(page.getByRole('link', { name: /LEGO Retained Item/ })).toBeVisible();
    await page.goto(`${inventoryPath(businessId)}/${item.id}`);
    await expect(page.getByText('Archived item', { exact: true })).toBeVisible();
    await expect(page.getByText('Keep this record')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit item' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive item' })).toHaveCount(0);
    await page.goto(`${inventoryPath(businessId)}/${item.id}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit inventory item' })).toHaveCount(0);
  });

  test('invalid names and quantities cannot create inventory records', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Validation');
    await page.goto(`${inventoryPath(businessId)}/new`);
    await page.getByRole('button', { name: 'Create item' }).click();
    await expect(page.getByText('Item name must be at least 2 characters')).toBeVisible();
    await page.getByLabel('Item name').fill('  ');
    await page.getByRole('button', { name: 'Create item' }).click();
    await expect(page.getByText('Item name must be at least 2 characters')).toBeVisible();
    await page.getByLabel('Item name').fill('LEGO Invalid Quantity');
    await page.getByLabel('Quantity').fill('-1');
    await page.getByRole('button', { name: 'Create item' }).click();
    await expect(page.getByText('Quantity cannot be negative')).toBeVisible();
    await page.getByLabel('Quantity').fill('1.5');
    await page.getByRole('button', { name: 'Create item' }).click();
    await expect(page.getByText('Quantity must be a whole number')).toBeVisible();
    expect(await rows(businessId)).toHaveLength(0);
  });

  test('two businesses maintain independent inventory records', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'First Business');
    const second = await createBusiness(page, 'Second Business');
    await createItem(page, first, 'LEGO First Business Set');
    await createItem(page, second, 'LEGO Second Business Set');
    expect((await rows(first)).map(item => item.name)).toEqual(['LEGO First Business Set']);
    expect((await rows(second)).map(item => item.name)).toEqual(['LEGO Second Business Set']);
    await page.goto(inventoryPath(first));
    await expect(page.getByRole('link', { name: /LEGO First Business Set/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /LEGO Second Business Set/ })).toHaveCount(0);
    await page.goto(inventoryPath(second));
    await expect(page.getByRole('link', { name: /LEGO Second Business Set/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /LEGO First Business Set/ })).toHaveCount(0);
  });

  test('anonymous visitors cannot access inventory routes', async ({ page }) => {
    await page.goto('/dashboard/businesses/forged-business/inventory');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    await page.goto('/dashboard/businesses/forged-business/inventory/new');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  });
});
