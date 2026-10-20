import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { requireDevelopmentDatabase } from './helpers/database-safety';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const prefix = 'Consavro Pickup Authorization E2E';
const root = (id: string) => `/dashboard/businesses/${id}/pickups`;
async function cleanup() { await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]); }
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
async function createPickup(page: Page, businessId: string, seller: string) {
  await page.goto(`/dashboard/businesses/${businessId}/clients/new`);
  await page.getByLabel('Client name').fill(seller);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`/businesses/${businessId}/clients/?$`), { timeout: 20_000 });
  await page.goto(`${root(businessId)}/new`);
  await expect(page.locator('form[data-hydrated]')).toHaveAttribute('data-hydrated', 'true');
  await page.getByLabel('Seller', { exact: true }).selectOption({ label: seller });
  await page.getByLabel('Pickup date').fill('2026-10-18');
  await page.getByRole('button', { name: 'Create pickup' }).click();
  await expect(page.getByRole('heading', { name: 'Pickup details' })).toBeVisible({ timeout: 20_000 });
  return page.url().split('/').filter(Boolean).at(-1)!;
}
async function createItem(page: Page, businessId: string, pickupId: string, name: string) {
  await page.getByRole('region', { name: 'Collected LEGO items' }).getByRole('link', { name: 'Add collected item' }).click();
  const form = page.getByRole('region', { name: 'Collected item form' }).locator('form');
  await form.getByLabel('Item type').selectOption({ label: 'Unidentified LEGO set' });
  await form.getByLabel('Item name').fill(name);
  await form.getByLabel('Condition').selectOption('USED');
  await form.getByLabel('Completeness').selectOption('COMPLETE');
  await form.getByLabel('Asking price (optional, USD)').fill('20.00');
  await form.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('heading', { name: 'Pickup details' })).toBeVisible({ timeout: 15_000 });
  const result = await pool.query<{id:string}>('SELECT id FROM "seller_pickup_item" WHERE "pickupId"=$1 AND "businessId"=$2 AND name=$3', [pickupId,businessId,name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
async function role(businessId: string, value: 'OWNER'|'MANAGER'|'STAFF') {
  const result = await pool.query('UPDATE "business_member" SET role=$1,"updatedAt"=NOW() WHERE "businessId"=$2 AND "userId"=(SELECT id FROM "user" WHERE email=$3)', [value,businessId,email]);
  expect(result.rowCount).toBe(1);
}
async function notFound(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
}

test.describe('seller pickups — Layer 5 authorization and integration', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup(); await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', { data: { name: 'Consavro E2E User', email, password } });
    expect(response.ok(), await response.text()).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => { try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); } });

  test('unauthenticated users cannot open pickup or item routes', async ({ page, browser }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Anonymous');
    const pickupId = await createPickup(page, businessId, 'Anonymous Seller');
    const itemId = await createItem(page, businessId, pickupId, 'Anonymous candidate');
    const context = await browser.newContext();
    try {
      const anonymous = await context.newPage();
      for (const url of [root(businessId), `${root(businessId)}/${pickupId}`, `${root(businessId)}/new`, `${root(businessId)}/${pickupId}/edit`, `${root(businessId)}/${pickupId}/items/new`, `${root(businessId)}/${pickupId}/items/${itemId}/edit`]) {
        await anonymous.goto(url);
        await expect(anonymous).toHaveURL(/\/sign-in(?:\?|$)/);
      }
    } finally { await context.close(); }
  });

  test('STAFF can read but not create, edit, process or transfer; MANAGER can manage', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Roles');
    const pickupId = await createPickup(page, businessId, 'Role Seller');
    const itemId = await createItem(page, businessId, pickupId, 'Role candidate');
    await role(businessId, 'STAFF');
    await page.goto(`${root(businessId)}/${pickupId}`);
    await expect(page.getByRole('heading', { name: 'Pickup details' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit pickup' })).toHaveCount(0);
    const region = page.getByRole('region', { name: 'Collected LEGO items' });
    await expect(region.getByRole('link', { name: 'Add collected item' })).toHaveCount(0);
    await expect(region.getByRole('link', { name: 'Edit item' })).toHaveCount(0);
    await expect(region.getByRole('button', { name: 'Transfer to inventory' })).toHaveCount(0);
    await expect(region.getByRole('combobox', { name: 'Processing status for Role candidate' })).toHaveCount(0);
    for (const url of [`${root(businessId)}/new`, `${root(businessId)}/${pickupId}/edit`, `${root(businessId)}/${pickupId}/items/new`, `${root(businessId)}/${pickupId}/items/${itemId}/edit`]) await notFound(page, url);
    await role(businessId, 'MANAGER');
    await page.goto(`${root(businessId)}/${pickupId}`);
    await expect(page.getByRole('link', { name: 'Edit pickup' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Collected LEGO items' }).getByRole('link', { name: 'Add collected item' })).toBeVisible();
  });

  test('cross-business pickup and item identifiers cannot be used in another business', async ({ page }) => {
    await signIn(page);
    const a = await createBusiness(page, 'Tenant A');
    const pickupId = await createPickup(page, a, 'Tenant A Seller');
    const itemId = await createItem(page, a, pickupId, 'Tenant A candidate');
    const b = await createBusiness(page, 'Tenant B');
    await notFound(page, `${root(b)}/${pickupId}`);
    await notFound(page, `${root(b)}/${pickupId}/edit`);
    await notFound(page, `${root(b)}/${pickupId}/items/new`);
    await notFound(page, `${root(b)}/${pickupId}/items/${itemId}/edit`);
    const rows = await pool.query('SELECT id FROM "seller_pickup_item" WHERE id=$1 AND "businessId"=$2', [itemId,a]);
    expect(rows.rows).toHaveLength(1);
    expect((await pool.query('SELECT id FROM "inventory_item" WHERE "businessId"=$1', [b])).rows).toHaveLength(0);
  });

  test('completed pickups are read-only and retain their collected items', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Completed');
    const pickupId = await createPickup(page, businessId, 'Completed Seller');
    const itemId = await createItem(page, businessId, pickupId, 'Completed candidate');
    for (const label of ['Mark picked up', 'Start processing', 'Complete pickup']) {
      await page.getByRole('button', { name: label }).click();
      await expect(page.getByRole('button', { name: label })).toHaveCount(0);
    }
    await page.reload();
    const region = page.getByRole('region', { name: 'Collected LEGO items' });
    await expect(region).toContainText('Completed candidate');
    await expect(region.getByRole('link', { name: 'Add collected item' })).toHaveCount(0);
    await expect(region.getByRole('link', { name: 'Edit item' })).toHaveCount(0);
    await expect(region.getByRole('combobox', { name: 'Processing status for Completed candidate' })).toHaveCount(0);
    await expect(region.getByRole('button', { name: 'Transfer to inventory' })).toHaveCount(0);
    await notFound(page, `${root(businessId)}/${pickupId}/items/${itemId}/edit`);
    const result = await pool.query<{status:string}>('SELECT status FROM "seller_pickup" WHERE id=$1', [pickupId]);
    expect(result.rows[0].status).toBe('COMPLETED');
  });
});
