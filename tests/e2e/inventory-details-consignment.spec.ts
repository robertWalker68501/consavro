import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Destructive setup/cleanup: run only against a disposable Neon development/test database.
// This suite owns only businesses whose names start with the prefix below.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Inventory Details E2E';

type InventoryRow = {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  quantity: number;
  description: string | null;
  archivedAt: Date | null;
  setNumber: string | null;
  theme: string | null;
  condition: string | null;
  completeness: string | null;
  askingPrice: string | null;
  estimatedValue: string | null;
  clientId: string | null;
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
    'SELECT id, "businessId", name, sku, quantity, description, "archivedAt", "setNumber", theme, condition, completeness, "askingPrice", "estimatedValue", "clientId" FROM "inventory_item" WHERE "businessId" = $1 ORDER BY "createdAt", id',
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


type Details = {
  setNumber?: string; theme?: string; condition?: string; completeness?: string;
  askingPrice?: string; estimatedValue?: string; client?: string;
};
async function fillDetails(page: Page, details: Details) {
  if (details.setNumber !== undefined) await page.getByLabel('LEGO set number').fill(details.setNumber);
  if (details.theme !== undefined) await page.getByLabel('LEGO theme').fill(details.theme);
  if (details.condition !== undefined) await page.locator('select[name="condition"]').selectOption(details.condition);
  if (details.completeness !== undefined) await page.locator('select[name="completeness"]').selectOption(details.completeness);
  if (details.askingPrice !== undefined) await page.getByLabel('Asking price (USD)').fill(details.askingPrice);
  if (details.estimatedValue !== undefined) await page.getByLabel('Estimated value (USD)').fill(details.estimatedValue);
  if (details.client !== undefined) await page.getByLabel('Consignor (client)').selectOption({ label: details.client });
}
async function addItem(page: Page, businessId: string, name: string, details: Details = {}) {
  await page.goto(`${inventoryPath(businessId)}/new`);
  await page.getByLabel('Item name').fill(name);
  await fillDetails(page, details);
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/?$`), { timeout: 20_000 });
  const found = (await rows(businessId)).find(row => row.name === name);
  expect(found).toBeTruthy();
  return found!;
}
async function addClient(page: Page, businessId: string, name: string) {
  await page.goto(`/dashboard/businesses/${businessId}/clients/new`);
  await page.getByLabel('Client name').fill(name);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/businesses/${businessId}/clients/?$`), { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "client" WHERE "businessId"=$1 AND name=$2', [businessId, name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}

test.describe('inventory management — layer 2 LEGO details and consignment', () => {
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
    try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); }
  });

  test('creates LEGO set details, condition, completeness, and exact prices', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Complete');
    const item = await addItem(page, businessId, 'LEGO Bookshop', {
      setNumber: '10270', theme: 'Creator Expert', condition: 'NEW_SEALED',
      completeness: 'COMPLETE', askingPrice: '149.99', estimatedValue: '125.50',
    });
    expect(item).toMatchObject({ setNumber: '10270', theme: 'Creator Expert', condition: 'NEW_SEALED', completeness: 'COMPLETE' });
    expect(item.askingPrice).toBe('149.99');
    expect(item.estimatedValue).toBe('125.50');
    await page.goto(`${inventoryPath(businessId)}/${item.id}`);
    await expect(page.getByText('10270')).toBeVisible();
    await expect(page.getByText('Creator Expert')).toBeVisible();
    await expect(page.getByText('New / sealed')).toBeVisible();
    await expect(page.getByText('$149.99')).toBeVisible();
    await expect(page.getByText('$125.50')).toBeVisible();
  });

  test('edits set details and prices and persists values after reload', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Edit');
    const item = await addItem(page, businessId, 'LEGO City', { setNumber: '60300', askingPrice: '45.00' });
    await page.goto(`${inventoryPath(businessId)}/${item.id}/edit`);
    await expect(page.getByLabel('Asking price (USD)')).toHaveValue(/^45(?:\.00?)?$/);
    expect((await rows(businessId)).find(row => row.id === item.id)?.askingPrice).toBe('45.00');
    await fillDetails(page, { setNumber: '60301', theme: 'City', condition: 'USED', completeness: 'INCOMPLETE', askingPrice: '39.95', estimatedValue: '31.25' });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/${item.id}/?$`), { timeout: 20_000 });
    await page.reload();
    const updated = (await rows(businessId)).find(row => row.id === item.id)!;
    expect(updated).toMatchObject({ setNumber: '60301', theme: 'City', condition: 'USED', completeness: 'INCOMPLETE', askingPrice: '39.95', estimatedValue: '31.25' });
    await expect(page.getByText('$39.95')).toBeVisible();
    await page.getByRole('link', { name: 'Edit item' }).click();
    await expect(page.getByLabel('LEGO set number')).toHaveValue('60301');
    await expect(page.getByLabel('Estimated value (USD)')).toHaveValue('31.25');
  });

  test('optional fields can be empty and cleared', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Optional');
    const item = await addItem(page, businessId, 'Loose LEGO bricks');
    expect(item).toMatchObject({ setNumber: null, theme: null, condition: null, completeness: null, askingPrice: null, estimatedValue: null, clientId: null });
    await page.goto(`${inventoryPath(businessId)}/${item.id}/edit`);
    await fillDetails(page, { setNumber: '1234', theme: 'Classic', condition: 'USED', completeness: 'UNKNOWN', askingPrice: '10.50', estimatedValue: '8.00' });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/${item.id}/?$`));
    await page.goto(`${inventoryPath(businessId)}/${item.id}/edit`);
    await fillDetails(page, { setNumber: '', theme: '', condition: '', completeness: '', askingPrice: '', estimatedValue: '' });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/${item.id}/?$`));
    const updated = (await rows(businessId)).find(row => row.id === item.id)!;
    expect(updated).toMatchObject({ setNumber: null, theme: null, condition: null, completeness: null, askingPrice: null, estimatedValue: null });
  });

  test('assigns an existing business client as consignor and persists link', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Consignor');
    const clientId = await addClient(page, businessId, 'Alex Consignor');
    const item = await addItem(page, businessId, 'LEGO Train', { client: 'Alex Consignor', askingPrice: '199.99' });
    expect(item.clientId).toBe(clientId);
    await page.goto(`${inventoryPath(businessId)}/${item.id}`);
    await expect(page.getByRole('link', { name: 'Alex Consignor' })).toHaveAttribute('href', `/dashboard/businesses/${businessId}/clients/${clientId}`);
    await page.reload();
    await expect(page.getByRole('link', { name: 'Alex Consignor' })).toBeVisible();
  });

  test('reassigns and unassigns consignor on edit', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Reassign');
    await addClient(page, businessId, 'First Consignor');
    const secondId = await addClient(page, businessId, 'Second Consignor');
    const item = await addItem(page, businessId, 'LEGO Spaceship', { client: 'First Consignor' });
    await page.goto(`${inventoryPath(businessId)}/${item.id}/edit`);
    await fillDetails(page, { client: 'Second Consignor' });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/${item.id}/?$`));
    expect((await rows(businessId)).find(row => row.id === item.id)?.clientId).toBe(secondId);
    await page.goto(`${inventoryPath(businessId)}/${item.id}/edit`);
    await page.getByLabel('Consignor (client)').selectOption('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/${item.id}/?$`));
    expect((await rows(businessId)).find(row => row.id === item.id)?.clientId).toBeNull();
  });

  test('invalid prices are rejected and do not create a record', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Price validation');
    const invalid = ['-1', '12.345', 'abc', '10000000000'];
    for (const [index, price] of invalid.entries()) {
      await page.goto(`${inventoryPath(businessId)}/new`);
      await page.getByLabel('Item name').fill(`Invalid price item ${index}`);
      await page.getByLabel('Asking price (USD)').fill(price);
      await page.getByRole('button', { name: 'Create item' }).click();
      await expect(page.locator('#askingPrice-error')).toBeVisible();
      expect((await rows(businessId)).some(row => row.name === `Invalid price item ${index}`)).toBe(false);
    }
  });

  test('archived consignors cannot be newly assigned', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Archived client');
    const clientId = await addClient(page, businessId, 'Retired Consignor');
    await pool.query('UPDATE "client" SET "archivedAt"=NOW() WHERE id=$1', [clientId]);
    await page.goto(`${inventoryPath(businessId)}/new`);
    await expect(page.locator('select[name="clientId"] option', { hasText: 'Retired Consignor (archived)' })).toHaveAttribute('disabled', '');
    await expect(page.locator('select[name="clientId"]')).not.toHaveValue(clientId);
  });

  test('business B clients are never offered as consignors in business A', async ({ page }) => {
    await signIn(page);
    const firstId = await createBusiness(page, 'Business A');
    const secondId = await createBusiness(page, 'Business B');
    await addClient(page, secondId, 'Other Business Consignor');
    await page.goto(`${inventoryPath(firstId)}/new`);
    await expect(page.getByRole('option', { name: 'Other Business Consignor' })).toHaveCount(0);
  });
});
