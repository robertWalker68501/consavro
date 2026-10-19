import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Destructive fixtures require the Neon dev-only Playwright database guard.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Notification Preferences E2E';
const preferencesUrl = '/dashboard/notifications/preferences';
const recipients = [randomUUID(), randomUUID()];

async function actorId() {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [email]);
  if (!result.rows[0]) throw new Error('E2E actor missing');
  return result.rows[0].id;
}

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
  await pool.query('DELETE FROM "notification_preference" WHERE "userId" = ANY($1::text[])', [
    [await actorId(), ...recipients],
  ]);
}

async function preference(userId: string) {
  const result = await pool.query<{ inventory: boolean; sales: boolean; payouts: boolean }>(
    'SELECT inventory,sales,payouts FROM "notification_preference" WHERE "userId"=$1', [userId],
  );
  return result.rows[0] ?? null;
}

async function openPreferences(page: Page) {
  await page.goto(preferencesUrl);
  await expect(page.getByRole('heading', { name: 'Notification preferences' })).toBeVisible();
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page).toHaveURL(/\/dashboard\/notifications\/preferences\?saved=1$/, { timeout: 20_000 });
  await expect(page.getByRole('status')).toHaveText('Preferences saved.');
}

async function createBusiness(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name=$1', [name]);
  expect(result.rows).toHaveLength(1);
  const id = result.rows[0].id;
  for (const userId of recipients) {
    await pool.query(
      'INSERT INTO "business_member" (id,"businessId","userId",role,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())',
      [randomUUID(), id, userId, 'MANAGER'],
    );
  }
  return id;
}

async function createItem(page: Page, businessId: string, name: string) {
  const inventoryUrl = `/dashboard/businesses/${businessId}/inventory`;
  await page.goto(`${inventoryUrl}/new`);
  await page.getByLabel('Item name').fill(name);
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(new RegExp(`${inventoryUrl}/?$`), { timeout: 20_000 });
}

async function eventCount(businessId: string, userId: string, title: string) {
  const result = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM "notification" WHERE "businessId"=$1 AND "userId"=$2 AND title=$3',
    [businessId, userId, title],
  );
  return Number(result.rows[0].count);
}

async function setRecipientPreference(userId: string, inventory: boolean, sales = true, payouts = true) {
  await pool.query(
    `INSERT INTO "notification_preference" ("userId",inventory,sales,payouts,"updatedAt")
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT ("userId") DO UPDATE
     SET inventory=EXCLUDED.inventory,sales=EXCLUDED.sales,payouts=EXCLUDED.payouts,"updatedAt"=NOW()`,
    [userId, inventory, sales, payouts],
  );
}

test.describe('notifications — layer 3 preferences', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro Preferences E2E Actor', email, password },
    });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
    for (const userId of recipients) {
      await pool.query(
        'INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,NOW(),NOW())',
        [userId, 'Preferences fixture recipient', `notification-prefs-${userId}@example.com`],
      );
    }
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => {
    try {
      await cleanup();
      await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [recipients]);
      await resetTestAccount();
    } finally {
      await pool.end();
    }
  });

  test('defaults to all categories enabled and links from notification center', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard/notifications');
    await page.getByRole('link', { name: 'Preferences' }).click();
    await expect(page).toHaveURL(new RegExp(`${preferencesUrl}/?$`));
    for (const category of ['inventory', 'sales', 'payouts']) {
      await expect(page.locator(`input[name="${category}"]`)).toBeChecked();
    }
    expect(await preference(await actorId())).toBeNull();
  });

  test('saving individual categories persists after reload and leaves others enabled', async ({ page }) => {
    await signIn(page);
    const actorUserId = await actorId();
    await openPreferences(page);
    await page.locator('input[name="inventory"]').uncheck();
    await save(page);
    await expect.poll(() => preference(actorUserId)).toEqual({ inventory: false, sales: true, payouts: true });
    await page.reload();
    await expect(page.locator('input[name="inventory"]')).not.toBeChecked();
    await expect(page.locator('input[name="sales"]')).toBeChecked();
    await expect(page.locator('input[name="payouts"]')).toBeChecked();
    await page.locator('input[name="inventory"]').check();
    await page.locator('input[name="payouts"]').uncheck();
    await save(page);
    await expect.poll(() => preference(actorUserId)).toEqual({ inventory: true, sales: true, payouts: false });
  });

  test('all categories can be disabled and restored', async ({ page }) => {
    await signIn(page);
    const actorUserId = await actorId();
    await openPreferences(page);
    for (const category of ['inventory', 'sales', 'payouts']) {
      await page.locator(`input[name="${category}"]`).uncheck();
    }
    await save(page);
    await expect.poll(() => preference(actorUserId)).toEqual({ inventory: false, sales: false, payouts: false });
    await page.reload();
    for (const category of ['inventory', 'sales', 'payouts']) {
      await expect(page.locator(`input[name="${category}"]`)).not.toBeChecked();
      await page.locator(`input[name="${category}"]`).check();
    }
    await save(page);
    await expect.poll(() => preference(actorUserId)).toEqual({ inventory: true, sales: true, payouts: true });
  });

  test('inventory opt-out suppresses new events; opt-in resumes without backfilling', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Opt out');
    await setRecipientPreference(recipients[0], false);
    await createItem(page, business, 'LEGO Preferences Before');
    await expect.poll(() => eventCount(business, recipients[1], 'Inventory item added')).toBe(1);
    expect(await eventCount(business, recipients[0], 'Inventory item added')).toBe(0);
    await setRecipientPreference(recipients[0], true);
    await createItem(page, business, 'LEGO Preferences After');
    await expect.poll(() => eventCount(business, recipients[0], 'Inventory item added')).toBe(1);
    expect(await eventCount(business, recipients[1], 'Inventory item added')).toBe(2);
  });

  test('one recipient’s preferences do not affect another recipient or other categories', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Isolation');
    await setRecipientPreference(recipients[0], false, true, false);
    await setRecipientPreference(recipients[1], true, false, true);
    await createItem(page, business, 'LEGO Preferences Isolation');
    await expect.poll(() => eventCount(business, recipients[1], 'Inventory item added')).toBe(1);
    expect(await eventCount(business, recipients[0], 'Inventory item added')).toBe(0);
    expect(await preference(recipients[0])).toEqual({ inventory: false, sales: true, payouts: false });
    expect(await preference(recipients[1])).toEqual({ inventory: true, sales: false, payouts: true });
    expect(await preference(await actorId())).toBeNull();
  });
});
