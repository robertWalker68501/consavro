import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Destructive setup: run only against a disposable Neon development/test database.
// This suite removes only businesses with its unique prefix.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Inventory Organization E2E';
const inventoryPath = (id: string) => `/dashboard/businesses/${id}/inventory`;

type InventoryRow = { id: string; name: string; status: string; archivedAt: Date | null };
async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
async function createBusiness(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function getItem(businessId: string, name: string) {
  const result = await pool.query<InventoryRow>(
    'SELECT id, name, status, "archivedAt" FROM "inventory_item" WHERE "businessId"=$1 AND name=$2',
    [businessId, name],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}
async function createItem(page: Page, businessId: string, name: string, opts: {
  sku?: string; setNumber?: string; theme?: string; quantity?: string; status?: string;
} = {}) {
  await page.goto(`${inventoryPath(businessId)}/new`);
  await expect(page.getByRole('heading', { name: 'Add inventory item' })).toBeVisible();
  await page.getByLabel('Item name').fill(name);
  if (opts.sku) await page.getByLabel('Internal SKU').fill(opts.sku);
  if (opts.setNumber) await page.getByLabel('LEGO set number').fill(opts.setNumber);
  if (opts.theme) await page.getByLabel('LEGO theme').fill(opts.theme);
  if (opts.quantity) await page.getByLabel('Quantity').fill(opts.quantity);
  if (opts.status) await page.getByLabel('Inventory status').selectOption(opts.status);
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryPath(businessId)}/?$`), { timeout: 20_000 });
  return getItem(businessId, name);
}
async function selectFilter(page: Page, label: 'Status' | 'Sort by', option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function applyFilters(page: Page, opts: { q?: string; status?: string; sort?: string }) {
  if (opts.q !== undefined) await page.getByRole('searchbox', { name: 'Search inventory' }).fill(opts.q);
  if (opts.status !== undefined) await selectFilter(page, 'Status', opts.status);
  if (opts.sort !== undefined) await selectFilter(page, 'Sort by', opts.sort);
  await page.getByRole('button', { name: 'Apply' }).click();
}
function itemLinks(page: Page) {
  return page.locator('main ul > li > a');
}
async function expectNames(page: Page, names: string[]) {
  await expect(itemLinks(page)).toHaveCount(names.length);
  for (const name of names) await expect(itemLinks(page).filter({ hasText: name })).toHaveCount(1);
}

test.describe('inventory management — layer 3 status and organization', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => {
    try { await cleanup(); await resetTestAccount(); }
    finally { await pool.end(); }
  });

  test('new items default to In stock and persist their status in PostgreSQL', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Default');
    const item = await createItem(page, id, 'LEGO Default Status');
    expect(item.status).toBe('IN_STOCK');
    await page.reload();
    await expect(itemLinks(page).filter({ hasText: 'LEGO Default Status' })).toContainText('In stock');
  });

  test('OWNER transitions In stock to Reserved to Sold and persists each edit', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Transitions');
    const item = await createItem(page, id, 'LEGO Status Journey');
    for (const [value, label] of [['RESERVED', 'Reserved'], ['SOLD', 'Sold']] as const) {
      await page.goto(`${inventoryPath(id)}/${item.id}/edit`);
      await page.getByLabel('Inventory status').selectOption(value);
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page).toHaveURL(new RegExp(`${inventoryPath(id)}/${item.id}/?$`), { timeout: 20_000 });
      await expect.poll(async () => (await getItem(id, 'LEGO Status Journey')).status, { timeout: 15_000 }).toBe(value);
      await page.goto(inventoryPath(id));
      await expect(itemLinks(page).filter({ hasText: 'LEGO Status Journey' })).toContainText(label);
    }
  });

  test('search matches name, SKU, LEGO set number, and theme case-insensitively', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Search');
    await createItem(page, id, 'Botanical Garden', { sku: 'BG-2026', setNumber: '21353', theme: 'Ideas' });
    await createItem(page, id, 'City Fire Station', { sku: 'FIRE-22', setNumber: '60320', theme: 'City' });
    for (const term of ['botanical', 'bg-2026', '21353', 'ideas']) {
      await page.goto(inventoryPath(id));
      await applyFilters(page, { q: term });
      await expect(page).toHaveURL(/\?q=/);
      await expectNames(page, ['Botanical Garden']);
    }
    await page.goto(inventoryPath(id));
    await applyFilters(page, { q: 'not-a-real-lego-set' });
    await expect(itemLinks(page)).toHaveCount(0);
  });

  test('status filters return only matching inventory records', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'StatusFilter');
    await createItem(page, id, 'Stock Item');
    await createItem(page, id, 'Reserved Item', { status: 'RESERVED' });
    await createItem(page, id, 'Sold Item', { status: 'SOLD' });
    for (const [filter, expected] of [
      ['In stock', 'Stock Item'], ['Reserved', 'Reserved Item'], ['Sold', 'Sold Item'],
    ] as const) {
      await page.goto(inventoryPath(id));
      await applyFilters(page, { status: filter });
      await expectNames(page, [expected]);
    }
  });

  test('sorting by name and quantity changes visible order', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Sort');
    await createItem(page, id, 'Zebra LEGO', { quantity: '2' });
    await createItem(page, id, 'Alpha LEGO', { quantity: '9' });
    await createItem(page, id, 'Middle LEGO', { quantity: '5' });
    const cases = [
      ['Name A–Z', ['Alpha LEGO', 'Middle LEGO', 'Zebra LEGO']],
      ['Name Z–A', ['Zebra LEGO', 'Middle LEGO', 'Alpha LEGO']],
      ['Quantity: high to low', ['Alpha LEGO', 'Middle LEGO', 'Zebra LEGO']],
      ['Quantity: low to high', ['Zebra LEGO', 'Middle LEGO', 'Alpha LEGO']],
    ] as const;
    for (const [sort, expected] of cases) {
      await page.goto(inventoryPath(id));
      await applyFilters(page, { sort });
      // router.push is asynchronous: wait for the requested sort to reach the URL
      // and for the server-rendered inventory order to match before asserting.
      const sortValues: Record<string, string> = {
        'Name A–Z': 'name_asc',
        'Name Z–A': 'name_desc',
        'Quantity: high to low': 'quantity_desc',
        'Quantity: low to high': 'quantity_asc',
      };
      await expect(page).toHaveURL(new RegExp(`[?&]sort=${sortValues[sort]}(?:&|$)`));
      await expect(itemLinks(page)).toHaveCount(3);
      await expect.poll(async () => {
        const text = await itemLinks(page).allTextContents();
        return text.map(t => expected.find(n => t.includes(n)));
      }).toEqual([...expected]);
    }
  });

  test('combined search, status, and sort filters persist across reload', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Combined');
    await createItem(page, id, 'City Small', { theme: 'City', status: 'RESERVED', quantity: '1' });
    await createItem(page, id, 'City Large', { theme: 'City', status: 'RESERVED', quantity: '8' });
    await createItem(page, id, 'City Sold', { theme: 'City', status: 'SOLD' });
    await createItem(page, id, 'Space Reserved', { theme: 'Space', status: 'RESERVED' });
    await page.goto(inventoryPath(id));
    await applyFilters(page, { q: 'city', status: 'Reserved', sort: 'Quantity: high to low' });
    await expect(itemLinks(page)).toHaveCount(2);
    await expect(page.getByRole('searchbox', { name: 'Search inventory' })).toHaveValue('city');
    const text = await itemLinks(page).allTextContents();
    expect(text[0]).toContain('City Large');
    expect(text[1]).toContain('City Small');
    await page.reload();
    await expectNames(page, ['City Small', 'City Large']);
    await expect(page.getByRole('searchbox', { name: 'Search inventory' })).toHaveValue('city');
  });

  test('Clear resets controlled search and filters and URL remains authoritative', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Clear');
    await createItem(page, id, 'LEGO Clear Search');
    await page.goto(inventoryPath(id));
    await applyFilters(page, { q: 'no-match', status: 'Sold' });
    await expect(itemLinks(page)).toHaveCount(0);
    await page.getByRole('link', { name: 'Clear', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(id)}/?$`));
    await expect(page.getByRole('searchbox', { name: 'Search inventory' })).toHaveValue('');
    await expectNames(page, ['LEGO Clear Search']);
    await page.goto(`${inventoryPath(id)}?q=clear`);
    await expect(page.getByRole('searchbox', { name: 'Search inventory' })).toHaveValue('clear');
    await page.goto(inventoryPath(id));
    await expect(page.getByRole('searchbox', { name: 'Search inventory' })).toHaveValue('');
  });

  test('Active and Archived tabs preserve applied filters without leaking archived records', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Archive');
    await createItem(page, id, 'City Active', { theme: 'City', status: 'RESERVED' });
    const archived = await createItem(page, id, 'City Archived', { theme: 'City', status: 'RESERVED' });
    // Archive via UI, not direct database manipulation.
    await page.goto(`${inventoryPath(id)}/${archived.id}`);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: /Archive item/ }).click();
    await expect.poll(async () => (await getItem(id, 'City Archived')).archivedAt).not.toBeNull();
    await page.goto(inventoryPath(id));
    await applyFilters(page, { q: 'city', status: 'Reserved' });
    await expect(page).toHaveURL(/[?&]q=city(?:&|$)/);
    await expect(page).toHaveURL(/[?&]status=RESERVED(?:&|$)/);
    await expectNames(page, ['City Active']);
    await page.getByRole('link', { name: 'Archived items' }).click();
    await expect(page).toHaveURL(/archived=true/);
    await expect(page).toHaveURL(/q=city/);
    await expect(page).toHaveURL(/status=RESERVED/);
    await expectNames(page, ['City Archived']);
    await expect(page.getByRole('searchbox', { name: 'Search inventory' })).toHaveValue('city');
    await page.getByRole('link', { name: 'Active items' }).click();
    await expectNames(page, ['City Active']);
  });
});
