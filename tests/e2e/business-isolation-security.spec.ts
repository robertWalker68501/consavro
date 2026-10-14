import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// SECURITY: Run only against an isolated development/test database.
// The suite creates and deletes its own businesses and the standard E2E auth account.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Isolation Security E2E';
type Role = 'OWNER' | 'MANAGER' | 'STAFF';

async function cleanupBusinesses() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}

async function currentUserId() {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  if (!result.rows[0]) throw new Error('E2E user not found');
  return result.rows[0].id;
}

async function createBusiness(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name = $1', [name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}

async function changeRole(businessId: string, role: Role) {
  const result = await pool.query(
    'UPDATE "business_member" SET role = $1, "updatedAt" = NOW() WHERE "businessId" = $2 AND "userId" = $3',
    [role, businessId, await currentUserId()],
  );
  expect(result.rowCount).toBe(1);
}

async function revokeMembership(businessId: string) {
  const result = await pool.query(
    'DELETE FROM "business_member" WHERE "businessId" = $1 AND "userId" = $2',
    [businessId, await currentUserId()],
  );
  expect(result.rowCount).toBe(1);
}

async function expectNotFound(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
}

async function expectRole(page: Page, businessId: string, role: Role) {
  await page.goto(`/dashboard/businesses/${businessId}`);
  await expect(page.getByText(`Your role: ${role}`)).toBeVisible();
}

test.describe('business isolation and security', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupBusinesses();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `E2E sign-up failed: ${response.status()} ${await response.text()}`).toBe(true);
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

  test('anonymous visitors cannot view a business or its team even with a known ID', async ({ page, browser }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Anonymous');
    const anonymous = await browser.newContext();
    try {
      const outsider = await anonymous.newPage();
      await outsider.goto(`/dashboard/businesses/${businessId}`);
      await expect(outsider).toHaveURL(/\/sign-in(?:\?|$)/);
      await outsider.goto(`/dashboard/businesses/${businessId}/team`);
      await expect(outsider).toHaveURL(/\/sign-in(?:\?|$)/);
    } finally {
      await anonymous.close();
    }
  });

  test('forged and nonexistent business IDs reveal no workspace or member data', async ({ page }) => {
    await signIn(page);
    await createBusiness(page, 'Known');
    await expectNotFound(page, '/dashboard/businesses/forged-business-id');
    await expectNotFound(page, '/dashboard/businesses/forged-business-id/team');
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  });

  test('revoked membership blocks both workspace and team despite an existing session', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Revoked');
    await page.goto(`/dashboard/businesses/${id}/team`);
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await revokeMembership(id);
    await expectNotFound(page, `/dashboard/businesses/${id}`);
    await expectNotFound(page, `/dashboard/businesses/${id}/team`);
  });

  test('revocation in one business does not remove access to another business', async ({ page }) => {
    await signIn(page);
    const allowed = await createBusiness(page, 'Still Allowed');
    const revoked = await createBusiness(page, 'Revoked Only');
    await revokeMembership(revoked);
    await expectRole(page, allowed, 'OWNER');
    await expectNotFound(page, `/dashboard/businesses/${revoked}`);
    await expectNotFound(page, `/dashboard/businesses/${revoked}/team`);
    await expectRole(page, allowed, 'OWNER');
  });

  test('STAFF cannot reach team page by direct URL while retaining workspace read access', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Staff Route');
    await changeRole(id, 'STAFF');
    await expectRole(page, id, 'STAFF');
    await expect(page.getByTestId('members-read-access')).toHaveCount(0);
    await expect(page.getByTestId('members-manage-access')).toHaveCount(0);
    await expectNotFound(page, `/dashboard/businesses/${id}/team`);
  });

  test('MANAGER has team read access but cannot manage membership controls', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Manager Route');
    await changeRole(id, 'MANAGER');
    await expectRole(page, id, 'MANAGER');
    await expect(page.getByTestId('members-read-access')).toBeVisible();
    await expect(page.getByTestId('members-manage-access')).toHaveCount(0);
    await page.goto(`/dashboard/businesses/${id}/team`);
    await expect(page.getByRole('heading', { name: /Team members/ })).toBeVisible();
    await expect(page.getByLabel('Member email')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add member' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  });

  test('roles are evaluated separately for each business and never inherited', async ({ page }) => {
    await signIn(page);
    const ownerBusiness = await createBusiness(page, 'Owner Scope');
    const staffBusiness = await createBusiness(page, 'Staff Scope');
    await changeRole(staffBusiness, 'STAFF');
    await expectRole(page, ownerBusiness, 'OWNER');
    await expect(page.getByTestId('members-manage-access')).toBeVisible();
    await expectRole(page, staffBusiness, 'STAFF');
    await expect(page.getByTestId('members-manage-access')).toHaveCount(0);
    await expectNotFound(page, `/dashboard/businesses/${staffBusiness}/team`);
    await page.goto(`/dashboard/businesses/${ownerBusiness}/team`);
    await expect(page.getByLabel('Member email')).toBeVisible();
  });

  test('role changes are enforced on the next request without a new sign-in', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Live Role');
    await page.goto(`/dashboard/businesses/${id}/team`);
    await expect(page.getByLabel('Member email')).toBeVisible();
    await changeRole(id, 'STAFF');
    await expectNotFound(page, `/dashboard/businesses/${id}/team`);
    await expectRole(page, id, 'STAFF');
    await changeRole(id, 'MANAGER');
    await page.goto(`/dashboard/businesses/${id}/team`);
    await expect(page.getByRole('heading', { name: /Team members/ })).toBeVisible();
    await expect(page.getByLabel('Member email')).toHaveCount(0);
    await changeRole(id, 'OWNER');
    await page.goto(`/dashboard/businesses/${id}/team`);
    await expect(page.getByLabel('Member email')).toBeVisible();
  });
});
