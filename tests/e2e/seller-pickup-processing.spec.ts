import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { requireDevelopmentDatabase } from './helpers/database-safety';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const prefix = 'Consavro Pickup Processing E2E';
const businessPath = (id: string) => `/dashboard/businesses/${id}`;
const pickupPath = (id: string) => `${businessPath(id)}/pickups`;

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
async function pickup(page: Page, id: string, sellerName: string) {
  await page.goto(`${businessPath(id)}/clients/new`);
  await page.getByLabel('Client name').fill(sellerName);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`${businessPath(id)}/clients/?$`), { timeout: 20_000 });
  await page.goto(`${pickupPath(id)}/new`);
  await expect(page.locator('form[data-hydrated]')).toHaveAttribute('data-hydrated', 'true');
  await page.getByLabel('Seller', { exact: true }).selectOption({ label: sellerName });
  await page.getByLabel('Pickup date').fill('2026-10-18');
  await page.getByRole('button', { name: 'Create pickup' }).click();
  await expect(page.getByRole('heading', { name: 'Pickup details' })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`${pickupPath(id)}/(?!new(?:/|$))[^/?]+/?$`), { timeout: 20_000 });
  const pickupId = page.url().split('/').filter(Boolean).at(-1)!;
  const rows = await pool.query('SELECT id FROM "seller_pickup" WHERE id=$1 AND "businessId"=$2', [pickupId, id]);
  expect(rows.rows).toHaveLength(1);
  return pickupId;
}
async function openItemForm(page: Page, kind: 'Unidentified LEGO set' | 'Identified catalog set' | 'Bulk LEGO lot') {
  const region = page.getByRole('region', { name: 'Collected LEGO items' });
  await region.getByRole('link', { name: 'Add collected item' }).click();
  await expect(page).toHaveURL(/\/items\/new\/?$/);
  const form = page.getByRole('region', { name: 'Collected item form' }).locator('form');
  await expect(form).toBeVisible();
  await form.getByLabel('Item type').selectOption({ label: kind });
  return form;
}
async function saveItem(page: Page) {
  await page.getByRole('region', { name: 'Collected item form' }).getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('heading', { name: 'Pickup details' })).toBeVisible({ timeout: 15_000 });
}

async function addItem(page: Page, kind: 'Unidentified LEGO set' | 'Bulk LEGO lot' = 'Unidentified LEGO set') {
  const form = await openItemForm(page, kind);
  await form.getByLabel('Item name').fill('Inspection candidate');
  return form;
}
async function editItem(page: Page) {
  await page.getByRole('region', { name: 'Collected LEGO items' }).getByRole('link', { name: 'Edit item' }).click();
  const form = page.getByRole('region', { name: 'Collected item form' }).locator('form');
  await expect(form).toBeVisible();
  return form;
}

async function createCollectedItem(page: Page, name: string, ready = true) {
  const form = await openItemForm(page, 'Unidentified LEGO set');
  await form.getByLabel('Item name').fill(name);
  await form.getByLabel('Quantity').fill('2');
  await form.getByLabel('Description (optional)').fill('Original collection notes');
  if (ready) {
    await form.getByLabel('Condition').selectOption('USED');
    await form.getByLabel('Completeness').selectOption('INCOMPLETE');
    await form.getByLabel('Inspection notes (optional)').fill('Missing one minifigure');
    await form.getByLabel('Estimated value (optional, USD)').fill('40.25');
    await form.getByLabel('Asking price (optional, USD)').fill('54.99');
  }
  await saveItem(page);
}
async function itemRow(pickupId: string) {
  const result = await pool.query<{id:string;businessId:string;inventoryItemId:string|null;processingStatus:string;name:string}>(
    'SELECT id,"businessId","inventoryItemId","processingStatus",name FROM "seller_pickup_item" WHERE "pickupId"=$1', [pickupId]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}
async function changeStatus(page: Page, name: string, value: string) {
  await page.getByRole('combobox', { name: `Processing status for ${name}` }).selectOption(value);
  await expect.poll(async () => {
    const text = await page.getByRole('region', { name: 'Collected LEGO items' }).innerText();
    return text.includes(`Processing: ${value.replaceAll('_', ' ')}`);
  }).toBe(true);
}
async function transfer(page: Page) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Transfer to inventory' }).click();
}
test.describe('seller pickups — Layer 4 inventory processing', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const res = await request.post('/api/auth/sign-up/email', { data: { name: 'Consavro E2E User', email, password } });
    expect(res.ok(), await res.text()).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => { try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); } });

  test('persists processing statuses through reload without creating inventory', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Statuses');
    const pickupId = await pickup(page, id, 'Status Seller');
    const name = 'Status candidate';
    await createCollectedItem(page, name);
    for (const status of ['IN_PROGRESS', 'ON_HOLD', 'READY', 'PENDING']) {
      await changeStatus(page, name, status);
      await expect.poll(async () => (await itemRow(pickupId)).processingStatus).toBe(status);
      await page.reload();
      await expect(page.getByRole('combobox', { name: `Processing status for ${name}` })).toHaveValue(status);
      expect((await itemRow(pickupId)).inventoryItemId).toBeNull();
    }
    expect((await pool.query('SELECT id FROM "inventory_item" WHERE "businessId"=$1', [id])).rows).toHaveLength(0);
  });

  test('requires known condition, completeness and asking price before transfer', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Prerequisites');
    const pickupId = await pickup(page, id, 'Prerequisite Seller');
    const name = 'Needs inspection';
    await createCollectedItem(page, name, false);
    await changeStatus(page, name, 'READY');
    await transfer(page);
    await expect(page.getByRole('alert').filter({ hasText: 'Condition, completeness and asking price are required' })).toBeVisible();
    expect((await itemRow(pickupId)).inventoryItemId).toBeNull();
    expect((await pool.query('SELECT id FROM "inventory_item" WHERE "businessId"=$1', [id])).rows).toHaveLength(0);
    await page.getByRole('link', { name: 'Edit item' }).click();
    const form = page.getByRole('region', { name: 'Collected item form' }).locator('form');
    await form.getByLabel('Condition').selectOption('USED');
    await form.getByLabel('Completeness').selectOption('COMPLETE');
    await form.getByLabel('Asking price (optional, USD)').fill('25.00');
    await saveItem(page);
    await expect(page.getByRole('combobox', { name: `Processing status for ${name}` })).toHaveValue('READY');
    await transfer(page);
    await expect(page.getByRole('link', { name: 'View inventory item' })).toBeVisible();
    expect((await itemRow(pickupId)).inventoryItemId).not.toBeNull();
  });

  test('creates inventory with seller, business, quantity, inspection and pricing preserved', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Transfer');
    const pickupId = await pickup(page, id, 'Transfer Seller');
    const name = 'Inventory candidate';
    await createCollectedItem(page, name);
    await changeStatus(page, name, 'READY');
    await transfer(page);
    await expect(page.getByRole('link', { name: 'View inventory item' })).toBeVisible();
    const item = await itemRow(pickupId);
    expect(item.inventoryItemId).toBeTruthy();
    const result = await pool.query<{id:string;businessId:string;clientId:string|null;name:string;quantity:number;condition:string;completeness:string;askingPrice:string;estimatedValue:string;status:string;description:string|null}>(
      'SELECT id,"businessId","clientId",name,quantity,condition,completeness,"askingPrice","estimatedValue",status,description FROM "inventory_item" WHERE id=$1', [item.inventoryItemId]);
    expect(result.rows).toHaveLength(1);
    const seller = await pool.query<{clientId:string}>('SELECT "clientId" FROM "seller_pickup" WHERE id=$1', [pickupId]);
    expect(result.rows[0]).toEqual(expect.objectContaining({businessId:id,clientId:seller.rows[0].clientId,name,quantity:2,condition:'USED',completeness:'INCOMPLETE',askingPrice:'54.99',estimatedValue:'40.25',status:'IN_STOCK'}));
    expect(result.rows[0].description).toContain('Original collection notes');
    expect(result.rows[0].description).toContain('Missing one minifigure');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Collected LEGO items' })).toContainText('Transferred to inventory');
    await expect(page.getByRole('link', { name: 'View inventory item' })).toHaveAttribute('href', `${businessPath(id)}/inventory/${item.inventoryItemId}`);
  });

  test('does not offer a second transfer or edits after inventory is linked', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'No Duplicates');
    const pickupId = await pickup(page, id, 'Duplicate Seller');
    const name = 'One transfer only';
    await createCollectedItem(page, name);
    await changeStatus(page, name, 'READY');
    await transfer(page);
    await expect(page.getByRole('link', { name: 'View inventory item' })).toBeVisible();
    const linkedId = (await itemRow(pickupId)).inventoryItemId;
    await page.reload();
    const region = page.getByRole('region', { name: 'Collected LEGO items' });
    await expect(region.getByRole('button', { name: 'Transfer to inventory' })).toHaveCount(0);
    await expect(region.getByRole('link', { name: 'Edit item' })).toHaveCount(0);
    await expect(region.getByRole('button', { name: 'Remove item' })).toHaveCount(0);
    await expect(region.getByRole('combobox', { name: `Processing status for ${name}` })).toHaveCount(0);
    expect((await itemRow(pickupId)).inventoryItemId).toBe(linkedId);
    expect((await pool.query('SELECT id FROM "inventory_item" WHERE "businessId"=$1', [id])).rows).toHaveLength(1);
  });
});
