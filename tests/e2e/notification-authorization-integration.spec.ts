import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Uses the existing Playwright Neon development-database guard.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Notifications Integration E2E';
const otherUserId = randomUUID();
const activity = (id: string) => `/dashboard/businesses/${id}/activity`;

async function userId() {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [email]);
  if (!result.rows[0]) throw new Error('Missing authenticated test account');
  return result.rows[0].id;
}
async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
  await pool.query('DELETE FROM "notification" WHERE title LIKE $1', [`${prefix}%`]);
  await pool.query('DELETE FROM "notification_preference" WHERE "userId" = ANY($1::text[])',
    [[await userId(), otherUserId]]);
}
async function business(label: string, role: 'OWNER' | 'MANAGER' | 'STAFF' = 'OWNER') {
  const id = randomUUID();
  await pool.query('INSERT INTO "business" (id,name,"createdAt","updatedAt") VALUES ($1,$2,NOW(),NOW())',
    [id, `${prefix} ${label}`]);
  await pool.query(
    'INSERT INTO "business_member" (id,"businessId","userId",role,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())',
    [randomUUID(), id, await userId(), role],
  );
  return id;
}
async function membership(id: string, role: 'OWNER' | 'MANAGER' | 'STAFF') {
  await pool.query('UPDATE "business_member" SET role=$1 WHERE "businessId"=$2 AND "userId"=$3',
    [role, id, await userId()]);
}
async function notification(label: string, options: { owner?: string; businessId?: string; read?: boolean } = {}) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "notification" (id,"userId","businessId",title,message,"readAt","createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
    [id, options.owner ?? await userId(), options.businessId ?? null,
      `${prefix} ${label}`, `Notification integration fixture ${label}`,
      options.read ? new Date() : null],
  );
  return id;
}
async function readAt(id: string) {
  const result = await pool.query<{ readAt: Date | null }>(
    'SELECT "readAt" FROM "notification" WHERE id=$1', [id],
  );
  return result.rows[0]?.readAt ?? null;
}
async function event(id: string, label: string) {
  const eventId = randomUUID();
  await pool.query(
    `INSERT INTO "business_activity_event"
      (id,"businessId","actorId","actorName",category,title,message,href,"createdAt")
     VALUES ($1,$2,$3,$4,'inventory',$5,$6,$7,NOW())`,
    [eventId, id, await userId(), 'Consavro Integration Actor',
      `Inventory ${label}`, `${prefix} ${label}`, `/dashboard/businesses/${id}/inventory`],
  );
  return eventId;
}
async function openNotifications(page: Page) {
  await page.goto('/dashboard/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
}
async function openActivity(page: Page, id: string) {
  await page.goto(activity(id));
  await expect(page.getByRole('heading', { name: 'Activity history' })).toBeVisible();
}

test.describe('notifications — layer 5 authorization and integration', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro Integration Actor', email, password },
    });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verify = await request.get(await waitForVerificationUrl());
    expect(verify.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
    await pool.query(
      'INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,NOW(),NOW())',
      [otherUserId, 'Integration Other User', `integration-${otherUserId}@example.com`],
    );
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => {
    try {
      await cleanup();
      await pool.query('DELETE FROM "user" WHERE id=$1', [otherUserId]);
      await resetTestAccount();
    } finally {
      await pool.end();
    }
  });

  test('unauthenticated requests cannot open notification, preference, or activity pages', async ({ browser }) => {
    const id = await business('Guest');
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      for (const url of ['/dashboard/notifications', '/dashboard/notifications/preferences', activity(id)]) {
        await page.goto(url);
        await expect(page).toHaveURL(/\/sign-in/, { timeout: 20_000 });
      }
    } finally {
      await context.close();
    }
  });

  test('activity access follows OWNER/MANAGER/STAFF role changes and membership revocation', async ({ page }) => {
    await signIn(page);
    const id = await business('Role changes');
    await event(id, 'Role event');
    await openActivity(page, id);
    await expect(page.getByTestId('activity-event')).toHaveCount(1);
    await membership(id, 'MANAGER');
    await page.reload();
    await expect(page.getByTestId('activity-event')).toHaveCount(1);
    await membership(id, 'STAFF');
    await page.goto(activity(id));
    await expect(page.getByRole('heading', { name: 'Activity history' })).toHaveCount(0);
    await expect(page.getByText(`${prefix} Role event`)).toHaveCount(0);
    await membership(id, 'OWNER');
    await openActivity(page, id);
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=$2',
      [id, await userId()]);
    await page.goto(activity(id));
    await expect(page.getByRole('heading', { name: 'Activity history' })).toHaveCount(0);
    await expect(page.getByText(`${prefix} Role event`)).toHaveCount(0);
  });

  test('business activity cannot be read by a member of a different business', async ({ page }) => {
    await signIn(page);
    const accessible = await business('Accessible');
    const foreign = randomUUID();
    await pool.query('INSERT INTO "business" (id,name,"createdAt","updatedAt") VALUES ($1,$2,NOW(),NOW())',
      [foreign, `${prefix} Foreign`]);
    await pool.query(
      'INSERT INTO "business_member" (id,"businessId","userId",role,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())',
      [randomUUID(), foreign, otherUserId, 'OWNER'],
    );
    await event(accessible, 'Allowed event');
    await event(foreign, 'Hidden event');
    await openActivity(page, accessible);
    await expect(page.getByTestId('activity-event')).toHaveCount(1);
    await expect(page.getByText(`${prefix} Hidden event`)).toHaveCount(0);
    await page.goto(activity(foreign));
    await expect(page.getByRole('heading', { name: 'Activity history' })).toHaveCount(0);
    await expect(page.getByText(`${prefix} Hidden event`)).toHaveCount(0);
  });

  test('notification ownership and membership revocation restrict reads and unread counts', async ({ page }) => {
    const id = await business('Notification isolation');
    await notification('Own personal');
    await notification('Foreign recipient', { owner: otherUserId });
    await notification('Business assigned', { businessId: id });
    await signIn(page);
    await openNotifications(page);
    await expect(page.getByRole('heading', { name: `${prefix} Own personal` })).toBeVisible();
    await expect(page.getByRole('heading', { name: `${prefix} Business assigned` })).toBeVisible();
    await expect(page.getByRole('heading', { name: `${prefix} Foreign recipient` })).toHaveCount(0);
    await page.getByRole('link', { name: 'Unread', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: new RegExp(`^${prefix}`) }) })).toHaveCount(2);
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=$2',
      [id, await userId()]);
    await page.reload();
    await expect(page.getByRole('heading', { name: `${prefix} Business assigned` })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: `${prefix} Own personal` })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: new RegExp(`^${prefix}`) }) })).toHaveCount(1);
  });

  test('forged notification ID cannot modify another user or a revoked business notification', async ({ page }) => {
    const id = await business('Mutation scope');
    const own = await notification('Mutable');
    const foreign = await notification('Other owner', { owner: otherUserId });
    const revoked = await notification('Revoked', { businessId: id });
    await signIn(page);
    await openNotifications(page);
    const row = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: `${prefix} Mutable` }),
    });
    await page.locator(`input[name="id"][value="${own}"]`).evaluate((input, forgedId) => {
      (input as HTMLInputElement).value = forgedId;
    }, foreign);
    await row.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Mark read', exact: true })).toBeVisible();
    expect(await readAt(foreign)).toBeNull();
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=$2',
      [id, await userId()]);
    await openNotifications(page);
    await page.locator(`input[name="id"][value="${own}"]`).evaluate((input, forgedId) => {
      (input as HTMLInputElement).value = forgedId;
    }, revoked);
    await row.getByRole('button', { name: 'Mark read', exact: true }).click();
    expect(await readAt(revoked)).toBeNull();
    expect(await readAt(own)).toBeNull();
  });

  test('mark all as read leaves foreign and revoked notifications unchanged', async ({ page }) => {
    const id = await business('Bulk scope');
    const own = await notification('Own bulk');
    const foreign = await notification('Other bulk', { owner: otherUserId });
    const revoked = await notification('Revoked bulk', { businessId: id });
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=$2',
      [id, await userId()]);
    await signIn(page);
    await openNotifications(page);
    await page.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(page.getByRole('listitem').getByRole('button', { name: 'Mark unread' })).toHaveCount(1);
    expect(await readAt(own)).not.toBeNull();
    expect(await readAt(foreign)).toBeNull();
    expect(await readAt(revoked)).toBeNull();
  });

  test('notification preferences persist per user and do not alter existing activity history', async ({ page }) => {
    await signIn(page);
    const id = await business('Preference integration');
    await event(id, 'Retained');
    await page.goto('/dashboard/notifications/preferences');
    await page.locator('input[name="inventory"]').uncheck();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect.poll(async () => {
      const result = await pool.query<{ inventory: boolean }>(
        'SELECT inventory FROM "notification_preference" WHERE "userId"=$1', [await userId()],
      );
      return result.rows[0]?.inventory;
    }).toBe(false);
    await openActivity(page, id);
    await expect(page.getByTestId('activity-event')).toHaveCount(1);
    await expect(page.getByTestId('activity-event')).toContainText(`${prefix} Retained`);
    const otherPreference = await pool.query(
      'SELECT * FROM "notification_preference" WHERE "userId"=$1', [otherUserId],
    );
    expect(otherPreference.rows).toHaveLength(0);
  });
});
