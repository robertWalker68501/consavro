import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Run only against a disposable development/test database.
// Use pg here to avoid importing Next.js's ESM-only generated Prisma client.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Membership E2E';
type Role = 'OWNER' | 'MANAGER' | 'STAFF';

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}

async function userId(): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Membership E2E user not found');
  return id;
}

async function createBusiness(page: Page, suffix: string): Promise<string> {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name = $1', [name]);
  const id = result.rows[0]?.id;
  expect(id, `Business ${name} was not created`).toBeTruthy();
  return id;
}

async function setRole(businessId: string, role: Role) {
  const result = await pool.query(
    'UPDATE "business_member" SET role = $1, "updatedAt" = NOW() WHERE "businessId" = $2 AND "userId" = $3',
    [role, businessId, await userId()],
  );
  expect(result.rowCount).toBe(1);
}

async function openWorkspace(page: Page, businessId: string, name: string, role: Role) {
  await page.goto(`/dashboard/businesses/${businessId}`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText(`Your role: ${role}`)).toBeVisible();
}

async function expectAccess(page: Page, access: { write: boolean; team: boolean; manage: boolean; settings: boolean }) {
  await expect(page.getByTestId('operations-write-access')).toHaveCount(access.write ? 1 : 0);
  await expect(page.getByTestId('members-read-access')).toHaveCount(access.team ? 1 : 0);
  await expect(page.getByTestId('members-manage-access')).toHaveCount(access.manage ? 1 : 0);
  await expect(page.getByTestId('business-settings-access')).toHaveCount(access.settings ? 1 : 0);
}

test.describe('business membership and role authorization', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `Setup sign-up failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });

  test.beforeEach(cleanup);
  test.afterAll(async () => {
    try {
      await cleanup();
      await resetTestAccount();
    } finally {
      await pool.end();
    }
  });

  test('anonymous visitors cannot open a business workspace', async ({ page }) => {
    await page.goto('/dashboard/businesses/not-a-real-business-id');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    await expect(page.getByTestId('business-settings-access')).toHaveCount(0);
  });

  test('OWNER receives all business permissions', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Owner');
    await openWorkspace(page, id, `${prefix} Owner`, 'OWNER');
    await expectAccess(page, { write: true, team: true, manage: true, settings: true });
  });

  test('MANAGER can operate and view team but cannot administer business', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Manager');
    await setRole(id, 'MANAGER');
    await openWorkspace(page, id, `${prefix} Manager`, 'MANAGER');
    await expectAccess(page, { write: true, team: true, manage: false, settings: false });
  });

  test('STAFF has read-only workspace access without administrative permissions', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Staff');
    await setRole(id, 'STAFF');
    await openWorkspace(page, id, `${prefix} Staff`, 'STAFF');
    await expectAccess(page, { write: false, team: false, manage: false, settings: false });
  });

  test('one user has independent roles in two businesses', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'First');
    const second = await createBusiness(page, 'Second');
    await setRole(second, 'STAFF');
    await openWorkspace(page, first, `${prefix} First`, 'OWNER');
    await expectAccess(page, { write: true, team: true, manage: true, settings: true });
    await openWorkspace(page, second, `${prefix} Second`, 'STAFF');
    await expectAccess(page, { write: false, team: false, manage: false, settings: false });
    // A role change in one business must not change the other membership.
    const rows = await pool.query<{ businessId: string; role: Role }>(
      'SELECT "businessId", role::text AS role FROM "business_member" WHERE "userId" = $1 AND "businessId" IN ($2, $3)',
      [await userId(), first, second],
    );
    expect(Object.fromEntries(rows.rows.map(row => [row.businessId, row.role]))).toEqual({
      [first]: 'OWNER', [second]: 'STAFF',
    });
  });

  test('removing membership denies access even when the user knows the business ID', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Removed');
    await pool.query('DELETE FROM "business_member" WHERE "businessId" = $1 AND "userId" = $2', [id, await userId()]);
    await page.goto(`/dashboard/businesses/${id}`);
    await expect(page.getByRole('heading', { name: `${prefix} Removed`, exact: true })).toHaveCount(0);
    await expect(page.getByTestId('operations-write-access')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
  });

  test('membership in one business does not grant access to another business', async ({ page }) => {
    await signIn(page);
    const allowed = await createBusiness(page, 'Allowed');
    const denied = await createBusiness(page, 'Denied');
    await pool.query('DELETE FROM "business_member" WHERE "businessId" = $1 AND "userId" = $2', [denied, await userId()]);
    await openWorkspace(page, allowed, `${prefix} Allowed`, 'OWNER');
    await page.goto(`/dashboard/businesses/${denied}`);
    await expect(page.getByRole('heading', { name: `${prefix} Denied`, exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
  });
});
