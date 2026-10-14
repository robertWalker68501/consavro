import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// The runner uses pg, not the generated Prisma client (which is ESM-only).
// Run against a disposable development/test database, never production.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const namePrefix = 'Consavro Business E2E';

async function getUserId(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM "user" WHERE email = $1', [email],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Business E2E test user not found');
  return id;
}

async function cleanupBusinesses() {
  // Remove only businesses created by this suite, not other users' data.
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${namePrefix}%`]);
}

async function createBusiness(page: Page, name: string) {
  await page.goto('/dashboard/businesses/new');
  await expect(page.getByRole('heading', { name: 'Create a business' })).toBeVisible();
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function memberships(name: string) {
  const result = await pool.query<{
    businessId: string; userId: string; role: string; businessName: string;
  }>(
    `SELECT b.id AS "businessId", m."userId", m.role::text AS role,
            b.name AS "businessName"
       FROM "business" b
       JOIN "business_member" m ON m."businessId" = b.id
      WHERE b.name = $1`,
    [name],
  );
  return result.rows;
}

test.describe('business creation and ownership', () => {
  test.beforeAll(async ({ request }) => {
    await resetTestAccount();
    // Remove leftover test businesses from a previous interrupted run.
    await cleanupBusinesses();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `Setup sign-up failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });

  test.beforeEach(cleanupBusinesses);

  test.afterAll(async () => {
    try {
      await cleanupBusinesses();
      await resetTestAccount();
    } finally {
      await pool.end();
    }
  });

  test('anonymous visitors cannot access business creation', async ({ page }) => {
    await page.goto('/dashboard/businesses/new');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    await expect(page.getByRole('button', { name: 'Create business' })).toHaveCount(0);
  });

  test('verified user creates a business with exactly one OWNER membership', async ({ page }) => {
    const businessName = `${namePrefix} Owner`;
    await signIn(page);
    await createBusiness(page, businessName);
    const rows = await memberships(businessName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: await getUserId(), role: 'OWNER', businessName });
    // A single membership means the nested write created the business and OWNER together.
    const count = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "business_member" WHERE "businessId" = $1',
      [rows[0].businessId],
    );
    expect(count.rows[0].count).toBe(1);
  });

  test('business and OWNER membership persist after navigation and reload', async ({ page }) => {
    const businessName = `${namePrefix} Persistent`;
    await signIn(page);
    await createBusiness(page, businessName);
    await page.reload();
    await expect(page.getByText(businessName, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`${businessName}\\s+OWNER`) })).toBeVisible();
    await page.goto('/dashboard/businesses/new');
    await page.goto('/dashboard');
    await expect(page.getByText(businessName, { exact: true })).toBeVisible();
    expect((await memberships(businessName))[0]?.role).toBe('OWNER');
  });

  test('invalid business names do not create businesses or memberships', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard/businesses/new');
    await page.getByRole('button', { name: 'Create business' }).click();
    await expect(page.getByText('Business name must be at least 2 characters')).toBeVisible();
    await page.getByLabel('Business name').fill('A'.repeat(101));
    await page.getByRole('button', { name: 'Create business' }).click();
    await expect(page.getByText('Business name must be at most 100 characters')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\/businesses\/new(?:\?|$)/);
    expect((await pool.query('SELECT id FROM "business" WHERE name LIKE $1', [`${namePrefix}%`])).rowCount).toBe(0);
  });

  test('creating two businesses produces independent OWNER memberships', async ({ page }) => {
    const first = `${namePrefix} First`;
    const second = `${namePrefix} Second`;
    await signIn(page);
    await createBusiness(page, first);
    await createBusiness(page, second);
    const firstRows = await memberships(first);
    const secondRows = await memberships(second);
    expect(firstRows).toHaveLength(1);
    expect(secondRows).toHaveLength(1);
    expect(firstRows[0].businessId).not.toBe(secondRows[0].businessId);
    expect(firstRows[0].userId).toBe(await getUserId());
    expect(secondRows[0].userId).toBe(await getUserId());
    expect(firstRows[0].role).toBe('OWNER');
    expect(secondRows[0].role).toBe('OWNER');
    await expect(page.getByText(first, { exact: true })).toBeVisible();
    await expect(page.getByText(second, { exact: true })).toBeVisible();
  });

  test('database prevents duplicate membership for the same user and business', async ({ page }) => {
    const businessName = `${namePrefix} Unique`;
    await signIn(page);
    await createBusiness(page, businessName);
    const [original] = await memberships(businessName);
    expect(original).toBeDefined();
    // Deliberately exercise the database constraint, not a UI that has no add-member flow yet.
    await expect(pool.query(
      `INSERT INTO "business_member" (id, "businessId", "userId", role, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'STAFF', NOW(), NOW())`,
      [`consavro-e2e-duplicate-${original.businessId}`, original.businessId, original.userId],
    )).rejects.toMatchObject({ code: '23505' });
    const rows = await memberships(businessName);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('OWNER');
  });
});
