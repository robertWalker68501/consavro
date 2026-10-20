import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { requireDevelopmentDatabase } from './helpers/database-safety';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const prefix = 'Consavro Pickup Valuation E2E';
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
async function record(pickupId: string) {
  const result = await pool.query<{ condition: string; completeness: string; inspectionNotes: string | null; estimatedValue: string | null; askingPrice: string | null }>(
    'SELECT condition,completeness,"inspectionNotes","estimatedValue","askingPrice" FROM "seller_pickup_item" WHERE "pickupId"=$1', [pickupId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

test.describe('seller pickups — Layer 3 condition and valuation', () => {
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

  test('persists condition, completeness, notes and USD valuation through a separate edit page', async ({ page }) => {
    await signIn(page);
    const businessId = await business(page, 'Full Inspection');
    const pickupId = await pickup(page, businessId, 'Valuation Seller');
    let form = await addItem(page);
    await form.getByLabel('Condition').selectOption('USED');
    await form.getByLabel('Completeness').selectOption('INCOMPLETE');
    await form.getByLabel('Inspection notes (optional)').fill('Missing two pieces; box worn');
    await form.getByLabel('Estimated value (optional, USD)').fill('48.25');
    await form.getByLabel('Asking price (optional, USD)').fill('59.99');
    await saveItem(page);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Collected LEGO items' })).toContainText('Missing two pieces; box worn');
    expect(await record(pickupId)).toEqual(expect.objectContaining({ condition: 'USED', completeness: 'INCOMPLETE', inspectionNotes: 'Missing two pieces; box worn', estimatedValue: '48.25', askingPrice: '59.99' }));
    form = await editItem(page);
    await expect(form.getByLabel('Condition')).toHaveValue('USED');
    await expect(form.getByLabel('Completeness')).toHaveValue('INCOMPLETE');
    await expect(form.getByLabel('Estimated value (optional, USD)')).toHaveValue('48.25');
    await form.getByLabel('Condition').selectOption('NEW');
    await form.getByLabel('Completeness').selectOption('COMPLETE');
    await form.getByLabel('Inspection notes (optional)').fill('Sealed replacement');
    await form.getByLabel('Estimated value (optional, USD)').fill('120.00');
    await form.getByLabel('Asking price (optional, USD)').fill('135.50');
    await saveItem(page);
    await page.reload();
    expect(await record(pickupId)).toEqual(expect.objectContaining({ condition: 'NEW', completeness: 'COMPLETE', inspectionNotes: 'Sealed replacement', estimatedValue: '120.00', askingPrice: '135.50' }));
  });

  test('allows uninspected and unpriced bulk lots, and clears previously entered details', async ({ page }) => {
    await signIn(page);
    const businessId = await business(page, 'Optional Details');
    const pickupId = await pickup(page, businessId, 'Bulk Seller');
    let form = await addItem(page, 'Bulk LEGO lot');
    await saveItem(page);
    expect(await record(pickupId)).toEqual(expect.objectContaining({ condition: 'UNKNOWN', completeness: 'UNKNOWN', inspectionNotes: null, estimatedValue: null, askingPrice: null }));
    form = await editItem(page);
    await form.getByLabel('Condition').selectOption('USED');
    await form.getByLabel('Completeness').selectOption('INCOMPLETE');
    await form.getByLabel('Inspection notes (optional)').fill('Unsorted');
    await form.getByLabel('Estimated value (optional, USD)').fill('10.00');
    await form.getByLabel('Asking price (optional, USD)').fill('20.00');
    await saveItem(page);
    form = await editItem(page);
    await form.getByLabel('Condition').selectOption('UNKNOWN');
    await form.getByLabel('Completeness').selectOption('UNKNOWN');
    await form.getByLabel('Inspection notes (optional)').fill('');
    await form.getByLabel('Estimated value (optional, USD)').fill('');
    await form.getByLabel('Asking price (optional, USD)').fill('');
    await saveItem(page);
    await page.reload();
    expect(await record(pickupId)).toEqual(expect.objectContaining({ condition: 'UNKNOWN', completeness: 'UNKNOWN', inspectionNotes: null, estimatedValue: null, askingPrice: null }));
  });

  test('rejects malformed, negative, and over-precision amounts without modifying stored values', async ({ page }) => {
    await signIn(page);
    const businessId = await business(page, 'Validation');
    const pickupId = await pickup(page, businessId, 'Validation Seller');
    let form = await addItem(page);
    await form.getByLabel('Estimated value (optional, USD)').fill('12.345');
    await form.getByLabel('Asking price (optional, USD)').fill('19.99');
    await form.getByRole('button', { name: 'Save item' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    expect((await pool.query('SELECT id FROM "seller_pickup_item" WHERE "pickupId"=$1', [pickupId])).rows).toHaveLength(0);
    await form.getByLabel('Estimated value (optional, USD)').fill('-1');
    await form.getByRole('button', { name: 'Save item' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    await form.getByLabel('Estimated value (optional, USD)').fill('12.34');
    await saveItem(page);
    expect(await record(pickupId)).toEqual(expect.objectContaining({ estimatedValue: '12.34', askingPrice: '19.99' }));
    form = await editItem(page);
    await form.getByLabel('Asking price (optional, USD)').fill('100.999');
    await form.getByRole('button', { name: 'Save item' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    expect(await record(pickupId)).toEqual(expect.objectContaining({ estimatedValue: '12.34', askingPrice: '19.99' }));
  });

  test('cancel on the dedicated edit page leaves inspection data unchanged', async ({ page }) => {
    await signIn(page);
    const businessId = await business(page, 'Cancel');
    const pickupId = await pickup(page, businessId, 'Cancel Seller');
    let form = await addItem(page);
    await form.getByLabel('Condition').selectOption('USED');
    await form.getByLabel('Estimated value (optional, USD)').fill('15.00');
    await saveItem(page);
    form = await editItem(page);
    await form.getByLabel('Condition').selectOption('NEW');
    await form.getByLabel('Estimated value (optional, USD)').fill('99.00');
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Pickup details' })).toBeVisible();
    expect(await record(pickupId)).toEqual(expect.objectContaining({ condition: 'USED', estimatedValue: '15.00' }));
  });
});
