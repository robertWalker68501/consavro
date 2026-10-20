import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { requireDevelopmentDatabase } from './helpers/database-safety';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const prefix = 'Consavro LEGO Inventory E2E';
const catalogIds: string[] = [];
const inventoryPath = (businessId: string) => `/dashboard/businesses/${businessId}/inventory`;

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
  for (const id of catalogIds.splice(0)) await pool.query('DELETE FROM "lego_set" WHERE id = $1', [id]);
}
async function business(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name = $1', [name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function catalogSet() {
  const id = randomUUID();
  const setNumber = `E2E-${randomUUID().slice(0, 10).toUpperCase()}`;
  const name = `${prefix} Test Spaceship`;
  await pool.query(`INSERT INTO "lego_set" (id, "setNumber", name, theme, "releaseYear", "pieceCount", source, "verificationStatus", "createdAt", "updatedAt") VALUES ($1,$2,$3,'Space',2025,123,'MANUAL','UNVERIFIED',NOW(),NOW())`, [id, setNumber, name]);
  catalogIds.push(id);
  return { id, setNumber, name };
}
async function inventoryRows(businessId: string) {
  return (await pool.query<{ id: string; legoSetId: string | null; name: string; setNumber: string | null; theme: string | null; quantity: number }>(
    'SELECT id, "legoSetId", name, "setNumber", theme, quantity FROM "inventory_item" WHERE "businessId" = $1 ORDER BY "createdAt"', [businessId],
  )).rows;
}
async function selectSet(page: Page, set: { name: string; setNumber: string }) {
  await expect(page.getByRole('region', { name: 'LEGO set catalog search' })).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('textbox', { name: 'Search LEGO sets' }).fill(set.setNumber);
  const result = page.getByRole('button', { name: new RegExp(set.name) });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByText(`Linked to ${set.name} (${set.setNumber})`, { exact: false })).toBeVisible();
  await expect(page.getByLabel('LEGO set name / item name')).toHaveValue(set.name);
  await expect(page.getByLabel('LEGO set number')).toHaveValue(set.setNumber);
}

test.describe('LEGO catalog — Layer 3 inventory integration', () => {
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

  test('selects a catalog set, populates details and persists the relationship', async ({ page }) => {
    const set = await catalogSet();
    await signIn(page);
    const id = await business(page, 'Create');
    await page.goto(`${inventoryPath(id)}/new`);
    await selectSet(page, set);
    await expect(page.getByLabel('LEGO set name / item name')).toHaveValue(set.name);
    await expect(page.getByLabel('LEGO set number')).toHaveValue(set.setNumber);
    await expect(page.getByLabel('LEGO theme')).toHaveValue('Space');
    await page.getByLabel('Quantity').fill('2');
    await page.getByRole('button', { name: 'Create item' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(id)}/?$`), { timeout: 20_000 });
    expect(await inventoryRows(id)).toMatchObject([{ legoSetId: set.id, name: set.name, setNumber: set.setNumber, theme: 'Space', quantity: 2 }]);
  });

  test('manual name and theme overrides do not change shared catalog metadata', async ({ page }) => {
    const set = await catalogSet();
    await signIn(page);
    const id = await business(page, 'Override');
    await page.goto(`${inventoryPath(id)}/new`);
    await selectSet(page, set);
    await page.getByLabel('LEGO set name / item name').fill('My custom spaceship');
    await page.getByLabel('LEGO theme').fill('Custom theme');
    await page.getByRole('button', { name: 'Create item' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(id)}/?$`), { timeout: 20_000 });
    expect(await inventoryRows(id)).toMatchObject([{ legoSetId: set.id, name: 'My custom spaceship', theme: 'Custom theme' }]);
    const shared = await pool.query<{ name: string; theme: string }>('SELECT name, theme FROM "lego_set" WHERE id = $1', [set.id]);
    expect(shared.rows[0]).toMatchObject({ name: set.name, theme: 'Space' });
  });

  test('editing and unlinking a catalog association retains the inventory item', async ({ page }) => {
    const set = await catalogSet();
    await signIn(page);
    const id = await business(page, 'Unlink');
    await page.goto(`${inventoryPath(id)}/new`);
    await selectSet(page, set);
    await page.getByRole('button', { name: 'Create item' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(id)}/?$`), { timeout: 20_000 });
    const [item] = await inventoryRows(id);
    await page.goto(`${inventoryPath(id)}/${item.id}/edit`);
    await expect(page.getByRole('button', { name: 'Unlink catalog set' })).toBeVisible();
    await page.getByRole('button', { name: 'Unlink catalog set' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(id)}/${item.id}/?$`), { timeout: 20_000 });
    expect(await inventoryRows(id)).toMatchObject([{ id: item.id, legoSetId: null, name: set.name }]);
  });

  test('manual inventory creation still works without a catalog selection', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Manual');
    await page.goto(`${inventoryPath(id)}/new`);
    await expect(page.getByRole('textbox', { name: 'Search LEGO sets' })).toHaveValue('');
    await page.getByLabel('LEGO set name / item name').fill('Manual inventory item');
    await page.getByLabel('LEGO set number').fill('CUSTOM-42');
    await page.getByRole('button', { name: 'Create item' }).click();
    await expect(page).toHaveURL(new RegExp(`${inventoryPath(id)}/?$`), { timeout: 20_000 });
    expect(await inventoryRows(id)).toMatchObject([{ legoSetId: null, name: 'Manual inventory item', setNumber: 'CUSTOM-42' }]);
    await page.goto(`${inventoryPath(id)}/new`);
    await expect(page.getByRole('textbox', { name: 'Search LEGO sets' })).toHaveValue('');
  });
});
