import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { requireDevelopmentDatabase } from './helpers/database-safety';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const prefix = 'Consavro Pickup Items E2E';
const businessPath = (id: string) => `/dashboard/businesses/${id}`;
const pickupPath = (id: string) => `${businessPath(id)}/pickups`;
const setIds: string[] = [];

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
  for (const id of setIds.splice(0)) await pool.query('DELETE FROM "lego_set" WHERE id=$1', [id]);
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
async function items(pickupId: string) {
  return (await pool.query<{ id: string; kind: string; name: string; quantity: number; legoSetId: string | null; description: string | null }>(
    'SELECT id,kind,name,quantity,"legoSetId",description FROM "seller_pickup_item" WHERE "pickupId"=$1 ORDER BY "createdAt"', [pickupId],
  )).rows;
}

test.describe('seller pickups — Layer 2 collected sets and bulk lots', () => {
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

  test('adds unidentified sets and bulk lots and persists them after reload', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Create');
    const pickupId = await pickup(page, id, 'Pickup Items Seller');
    let form = await openItemForm(page, 'Unidentified LEGO set');
    await form.getByLabel('Item name').fill('Unidentified LEGO box');
    await form.getByLabel('Set number (optional)').fill('UNKNOWN-12');
    await form.getByLabel('Quantity').fill('2');
    await form.getByLabel('Description (optional)').fill('Still needs identification');
    await saveItem(page);
    await expect(page.getByRole('region', { name: 'Collected LEGO items' })).toContainText('Unidentified LEGO box');
    form = await openItemForm(page, 'Bulk LEGO lot');
    await form.getByLabel('Item name').fill('Mixed brick containers');
    await form.getByLabel('Quantity').fill('3');
    await saveItem(page);
    await page.reload();
    const region = page.getByRole('region', { name: 'Collected LEGO items' });
    await expect(region).toContainText('Collected items (2)');
    await expect(region).toContainText('Mixed brick containers');
    expect(await items(pickupId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'UNIDENTIFIED_SET', name: 'Unidentified LEGO box', quantity: 2, legoSetId: null }),
      expect.objectContaining({ kind: 'BULK_LOT', name: 'Mixed brick containers', quantity: 3, legoSetId: null }),
    ]));
  });

  test('selects a shared catalog set and preserves its relationship', async ({ page }) => {
    const setId = randomUUID();
    const setNumber = `E2E-${randomUUID().slice(0, 10).toUpperCase()}`;
    const name = `${prefix} Catalog Explorer`;
    await pool.query(`INSERT INTO "lego_set" (id,"setNumber",name,theme,source,"verificationStatus","createdAt","updatedAt") VALUES ($1,$2,$3,'City','MANUAL','UNVERIFIED',NOW(),NOW())`, [setId, setNumber, name]);
    setIds.push(setId);
    await signIn(page);
    const id = await business(page, 'Catalog');
    const pickupId = await pickup(page, id, 'Catalog Pickup Seller');
    const form = await openItemForm(page, 'Identified catalog set');
    await expect(page.getByRole('region', { name: 'LEGO set catalog search' })).toHaveAttribute('data-hydrated', 'true');
    await page.getByRole('textbox', { name: 'Search LEGO sets' }).fill(setNumber);
    const result = page.getByRole('button', { name: new RegExp(name) });
    await expect(result).toBeVisible();
    await result.click();
    await expect(form.getByRole('status').filter({ hasText: `Selected: ${name}` })).toBeVisible();
    await form.getByLabel('Quantity').fill('2');
    await saveItem(page);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Collected LEGO items' })).toContainText(name);
    expect(await items(pickupId)).toEqual([expect.objectContaining({ kind: 'CATALOG_SET', name, quantity: 2, legoSetId: setId })]);
  });

  test('edits and removes collected items without deleting the pickup', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Edit Remove');
    const pickupId = await pickup(page, id, 'Edit Pickup Seller');
    const form = await openItemForm(page, 'Bulk LEGO lot');
    await form.getByLabel('Item name').fill('Unsorted bricks');
    await saveItem(page);
    const region = page.getByRole('region', { name: 'Collected LEGO items' });
    await region.getByRole('link', { name: 'Edit item' }).click();
    const edit = page.getByRole('region', { name: 'Collected item form' }).locator('form');
    await edit.getByLabel('Item name').fill('Sorted mixed bricks');
    await edit.getByLabel('Quantity').fill('4');
    await saveItem(page);
    await page.reload();
    await expect(region).toContainText('Sorted mixed bricks');
    expect(await items(pickupId)).toEqual([expect.objectContaining({ name: 'Sorted mixed bricks', quantity: 4 })]);
    page.once('dialog', dialog => dialog.accept());
    await region.getByRole('button', { name: 'Remove item' }).click();
    await expect(region).toContainText('No items recorded yet.');
    expect(await items(pickupId)).toHaveLength(0);
    expect((await pool.query('SELECT id FROM "seller_pickup" WHERE id=$1', [pickupId])).rows).toHaveLength(1);
  });

  test('blocks editing completed pickups and isolates items across businesses', async ({ page }) => {
    await signIn(page);
    const a = await business(page, 'Tenant A');
    const pickupA = await pickup(page, a, 'Seller A');
    const form = await openItemForm(page, 'Unidentified LEGO set');
    await form.getByLabel('Item name').fill('Tenant A LEGO');
    await saveItem(page);
    const b = await business(page, 'Tenant B');
    const pickupB = await pickup(page, b, 'Seller B');
    await expect(page.getByRole('region', { name: 'Collected LEGO items' })).not.toContainText('Tenant A LEGO');
    expect(await items(pickupB)).toHaveLength(0);
    await page.goto(`${pickupPath(b)}/${pickupA}`);
    await expect(page.getByRole('heading', { name: 'Pickup details' })).toHaveCount(0);
    await page.goto(`${pickupPath(a)}/${pickupA}`);
    for (const label of ['Mark picked up', 'Start processing', 'Complete pickup']) {
      await page.getByRole('button', { name: label }).click();
      await expect(page.getByRole('button', { name: label })).toHaveCount(0);
    }
    await page.reload();
    const region = page.getByRole('region', { name: 'Collected LEGO items' });
    await expect(region).toContainText('Tenant A LEGO');
    await expect(region.getByRole('link', { name: 'Add collected item' })).toHaveCount(0);
    await expect(region.getByRole('link', { name: 'Edit item' })).toHaveCount(0);
    await expect(region.getByRole('button', { name: 'Remove item' })).toHaveCount(0);
  });
});
