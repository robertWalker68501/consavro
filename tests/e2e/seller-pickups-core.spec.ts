import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Pickup E2E';
const path = (id: string) => `/dashboard/businesses/${id}/pickups`;

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
async function business(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const rows = await pool.query<{id:string}>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function seller(page: Page, id: string, name: string) {
  await page.goto(`/dashboard/businesses/${id}/clients/new`);
  await page.getByLabel('Client name').fill(name);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`/businesses/${id}/clients/?$`), { timeout: 20_000 });
  const rows = await pool.query<{id:string}>('SELECT id FROM "client" WHERE "businessId"=$1 AND name=$2', [id, name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function createPickup(page: Page, id: string, sellerName: string) {
  await page.goto(`${path(id)}/new`);
  await expect(page.locator('form[data-hydrated]')).toHaveAttribute('data-hydrated', 'true');
  await page.getByLabel('Seller', { exact: true }).selectOption({ label: sellerName });
  await page.getByLabel('Pickup date').fill('2026-10-18');
  await page.getByLabel('Pickup location (optional)').fill('Seller pickup location');
  await page.getByLabel('Notes (optional)').fill('Two LEGO boxes collected');
  await page.getByRole('button', { name: 'Create pickup' }).click();
  await expect(page.getByRole('heading', { name: 'Pickup details' })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`${path(id)}/(?!new(?:/|$))[^/?]+/?$`), { timeout: 20_000 });
  const pickupId = page.url().split('/').filter(Boolean).at(-1)!;
  const saved = await pool.query('SELECT id FROM "seller_pickup" WHERE id=$1 AND "businessId"=$2', [pickupId, id]);
  expect(saved.rows, 'Pickup should exist in the database after submission').toHaveLength(1);
  return pickupId;
}

test.describe('seller pickups — Layer 1 core records', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const res = await request.post('/api/auth/sign-up/email', { data: { name: 'Consavro E2E User', email, password } });
    expect(res.ok(), await res.text()).toBe(true);
    const verify = await request.get(await waitForVerificationUrl());
    expect(verify.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => { try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); } });

  test('creates a pickup for an existing seller with persistent metadata', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Create');
    const clientId = await seller(page, id, 'Pickup Seller A');
    const pickupId = await createPickup(page, id, 'Pickup Seller A');
    await expect(page.locator('dd').filter({ hasText: 'Two LEGO boxes collected' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Seller pickup location')).toBeVisible();
    const rows = await pool.query<{clientId:string;status:string;reference:string;location:string}>(
      'SELECT "clientId",status,reference,location FROM "seller_pickup" WHERE id=$1 AND "businessId"=$2', [pickupId,id]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ clientId, status: 'SCHEDULED', location: 'Seller pickup location' });
    expect(rows.rows[0].reference).toBeTruthy();
  });

  test('edits pickup details and retains changes after reload', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Edit');
    await seller(page, id, 'Pickup Seller B');
    const pickupId = await createPickup(page, id, 'Pickup Seller B');
    await page.getByRole('link', { name: 'Edit pickup' }).click();
    await expect(page.getByRole('heading', { name: 'Edit seller pickup' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path(id)}/${pickupId}/edit/?$`), { timeout: 20_000 });
    const editForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save pickup' }) }).last();
    await expect(editForm).toHaveAttribute('data-hydrated', 'true');
    await editForm.getByLabel('Notes (optional)').fill('Updated pickup notes');
    await page.getByRole('button', { name: 'Save pickup' }).click();
    await expect(page).toHaveURL(new RegExp(`${path(id)}/${pickupId}/?$`), { timeout: 20_000 });
    await page.reload();
    await expect(page.getByText('Updated pickup notes')).toBeVisible();
  });

  test('advances through pickup lifecycle and locks completed records', async ({ page }) => {
    await signIn(page);
    const id = await business(page, 'Lifecycle');
    await seller(page, id, 'Pickup Seller C');
    const pickupId = await createPickup(page, id, 'Pickup Seller C');
    for (const label of ['Mark picked up', 'Start processing', 'Complete pickup']) {
      await page.getByRole('button', { name: label }).click();
      await expect(page.getByRole('button', { name: label })).toHaveCount(0);
    }
    await expect(page.getByRole('link', { name: 'Edit pickup' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('COMPLETED')).toBeVisible();
    const rows = await pool.query<{status:string;pickedUpAt:Date|null}>('SELECT status,"pickedUpAt" FROM "seller_pickup" WHERE id=$1',[pickupId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe('COMPLETED');
    expect(rows.rows[0].pickedUpAt).not.toBeNull();
  });

  test('lists pickups within their own business and rejects foreign pickup IDs', async ({ page }) => {
    await signIn(page);
    const a = await business(page, 'Tenant A');
    await seller(page, a, 'Seller Tenant A');
    const pickupId = await createPickup(page, a, 'Seller Tenant A');
    const b = await business(page, 'Tenant B');
    await page.goto(path(b));
    await expect(page.getByText('No seller pickups yet.')).toBeVisible();
    await page.goto(`${path(b)}/${pickupId}`);
    await expect(page.getByRole('heading', { name: 'Pickup details' })).toHaveCount(0);
  });
});
