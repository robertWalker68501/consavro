import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Destructive fixtures: the Playwright configuration must enforce the Neon dev endpoint.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const path = '/dashboard/notifications';
const prefix = 'Consavro Notification Center E2E';
const otherUserId = randomUUID();

async function userId() {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  if (!result.rows[0]) throw new Error('E2E user missing');
  return result.rows[0].id;
}
async function clearFixtures() {
  await pool.query('DELETE FROM "notification" WHERE title LIKE $1', [`${prefix}%`]);
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
async function seed(title: string, options: { user?: string; business?: string; read?: boolean; href?: string } = {}) {
  const id = randomUUID();
  await pool.query(`INSERT INTO "notification" (id, "userId", "businessId", title, message, href, "readAt", "createdAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
    [id, options.user ?? await userId(), options.business ?? null, `${prefix} ${title}`, `Message for ${title}`, options.href ?? null, options.read ? new Date() : null]);
  return id;
}
async function readAt(id: string) {
  const r = await pool.query<{ readAt: Date | null }>('SELECT "readAt" FROM "notification" WHERE id=$1', [id]);
  return r.rows[0]?.readAt ?? null;
}
async function open(page: Page) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
}
async function makeBusiness(name: string) {
  const r = await pool.query<{ id: string }>('INSERT INTO "business" (id,name,"createdAt","updatedAt") VALUES ($1,$2,NOW(),NOW()) RETURNING id', [randomUUID(), `${prefix} ${name}`]);
  return r.rows[0].id;
}

test.describe('notification center — layer 1', () => {
  test.beforeAll(async ({ request }) => {
    await clearFixtures();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', { data: { name: 'Consavro E2E User', email, password } });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
    await pool.query('INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,NOW(),NOW())',
      [otherUserId, 'Notification fixture other user', `notification-other-${otherUserId}@example.com`]);
  });
  test.beforeEach(clearFixtures);
  test.afterAll(async () => {
    try {
      await clearFixtures();
      await pool.query('DELETE FROM "user" WHERE id=$1', [otherUserId]);
      await resetTestAccount();
    } finally { await pool.end(); }
  });

  test('empty state and navigation from dashboard bell', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Notifications', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`${path}/?$`));
    await expect(page.getByRole('heading', { name: 'No notifications yet' })).toBeVisible();
    await page.getByRole('link', { name: 'Unread', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All caught up' })).toBeVisible();
  });

  test('unread count, filtering, and detail link are rendered from persisted records', async ({ page }) => {
    await seed('Unread one', { href: '/dashboard/notifications' });
    await seed('Already read', { read: true });
    await signIn(page);
    await expect(page.getByRole('link', { name: 'Notifications, 1 unread' })).toBeVisible();
    await open(page);
    await expect(page.getByRole('heading', { name: `${prefix} Unread one` })).toBeVisible();
    await expect(page.getByRole('heading', { name: `${prefix} Already read` })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/dashboard/notifications');
    await page.getByRole('link', { name: 'Unread', exact: true }).click();
    await expect(page.getByRole('heading', { name: `${prefix} Unread one` })).toBeVisible();
    await expect(page.getByRole('heading', { name: `${prefix} Already read` })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: `${prefix} Unread one` })).toBeVisible();
  });

  test('mark read and unread persist after reload and update unread count', async ({ page }) => {
    const id = await seed('Toggle');
    await signIn(page);
    await open(page);
    const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `${prefix} Toggle` }) });
    await row.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Mark unread' })).toBeVisible();
    expect(await readAt(id)).not.toBeNull();
    await page.reload();
    await expect(row.getByRole('button', { name: 'Mark unread' })).toBeVisible();
    await row.getByRole('button', { name: 'Mark unread' }).click();
    await expect(row.getByRole('button', { name: 'Mark read', exact: true })).toBeVisible();
    expect(await readAt(id)).toBeNull();
  });

  test('mark all read changes only unread notifications and survives reload', async ({ page }) => {
    const a = await seed('First');
    const b = await seed('Second');
    const c = await seed('Already read', { read: true });
    await signIn(page);
    await open(page);
    await page.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(page.getByRole('button', { name: 'Mark unread' })).toHaveCount(3);
    for (const id of [a, b, c]) expect(await readAt(id)).not.toBeNull();
    await page.getByRole('link', { name: 'Unread', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All caught up' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'All caught up' })).toBeVisible();
  });

  test('another recipient and revoked business membership cannot expose notifications', async ({ page }) => {
    const own = await seed('Own visible');
    const other = await seed('Other recipient', { user: otherUserId });
    const business = await makeBusiness('Private business');
    await pool.query('INSERT INTO "business_member" (id,"businessId","userId",role,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())',
      [randomUUID(), business, await userId(), 'OWNER']);
    const scoped = await seed('Business private', { business });
    await signIn(page);
    await open(page);
    await expect(page.getByRole('heading', { name: `${prefix} Own visible` })).toBeVisible();
    await expect(page.getByRole('heading', { name: `${prefix} Business private` })).toBeVisible();
    await expect(page.getByRole('heading', { name: `${prefix} Other recipient` })).toHaveCount(0);
    await pool.query('DELETE FROM "business_member" WHERE "businessId"=$1 AND "userId"=$2', [business, await userId()]);
    await page.reload();
    await expect(page.getByRole('heading', { name: `${prefix} Business private` })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: `${prefix} Own visible` })).toBeVisible();
    // A forged notification ID must not allow modifying a different recipient's record.
    await page.locator(`input[name="id"][value="${own}"]`).evaluate((input, forged) => {
      (input as HTMLInputElement).value = forged;
    }, other);
    await page.getByRole('button', { name: 'Mark read', exact: true }).click();
    expect(await readAt(other)).toBeNull();
    expect(await readAt(scoped)).toBeNull();
  });
});
