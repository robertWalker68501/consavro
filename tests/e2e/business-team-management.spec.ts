import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// These tests modify membership rows. Run only against a disposable development/test database.
// The secondary account is seeded directly so no additional allowlisted email is required.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Team Management E2E';
const teammateEmail = 'consavro-e2e-team-member@example.com';
const teammateName = 'Consavro Team Teammate';
const teammateId = 'consavro-e2e-team-member-id';
const unverifiedEmail = 'consavro-e2e-unverified-team@example.com';
const unverifiedId = 'consavro-e2e-unverified-team-id';

async function cleanupBusinesses() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
async function cleanupTeammates() {
  await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [[teammateId, unverifiedId]]);
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
async function openTeam(page: Page, businessId: string) {
  await page.goto(`/dashboard/businesses/${businessId}/team`);
  await expect(page.getByRole('heading', { name: `${prefix}`, exact: false })).toBeVisible();
}
async function addMember(page: Page, role: 'STAFF' | 'MANAGER' = 'STAFF', memberEmail = teammateEmail) {
  await page.getByLabel('Member email').fill(memberEmail);
  await page.getByLabel('Business role').click();
  await page.getByRole('option', { name: role === 'STAFF' ? 'Staff' : 'Manager' }).click();
  await page.getByRole('button', { name: 'Add member' }).click();
}
async function memberRows(businessId: string, userId = teammateId) {
  return (await pool.query<{ id: string; role: string }>(
    'SELECT id, role::text AS role FROM "business_member" WHERE "businessId" = $1 AND "userId" = $2',
    [businessId, userId],
  )).rows;
}
async function ownerId() {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  if (!result.rows[0]) throw new Error('Missing E2E owner account');
  return result.rows[0].id;
}

// Separate account setup from each test's business data to keep the suite deterministic.
test.describe('business team management', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupBusinesses();
    await resetTestAccount();
    // Only delete our own fixed-ID fixtures; never delete a real user by email.
    await cleanupTeammates();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `Setup registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,NOW(),NOW()),($4,$5,$6,false,NOW(),NOW())',
      [teammateId, teammateName, teammateEmail, unverifiedId, 'Consavro Unverified E2E', unverifiedEmail],
    );
  });
  test.beforeEach(cleanupBusinesses);
  test.afterAll(async () => {
    try {
      await cleanupBusinesses();
      await cleanupTeammates();
      await resetTestAccount();
    } finally {
      await pool.end();
    }
  });

  test('OWNER sees their team and can add a verified STAFF member', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Add Staff');
    await openTeam(page, businessId);
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await addMember(page);
    await expect(page.getByRole('status')).toContainText('Team member added.');
    await expect.poll(async () => (await memberRows(businessId))[0]?.role).toBe('STAFF');
    await expect(page.getByText(teammateEmail, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(teammateEmail, { exact: true })).toBeVisible();
  });

  test('OWNER can add an existing verified MANAGER', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Add Manager');
    await openTeam(page, businessId);
    await addMember(page, 'MANAGER');
    await expect.poll(async () => (await memberRows(businessId))[0]?.role).toBe('MANAGER');
    await expect(page.getByText(teammateEmail, { exact: true })).toBeVisible();
  });

  test('duplicate membership is rejected without creating a second record', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Duplicate');
    await openTeam(page, businessId);
    await addMember(page);
    await expect.poll(async () => (await memberRows(businessId)).length).toBe(1);
    await addMember(page);
    await expect(page.getByRole('alert').filter({ hasText: 'already belongs' })).toBeVisible();
    expect(await memberRows(businessId)).toHaveLength(1);
  });

  test('unknown and unverified accounts cannot be added', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Unverified');
    await openTeam(page, businessId);
    await addMember(page, 'STAFF', unverifiedEmail);
    await expect(page.getByRole('alert').filter({ hasText: 'No verified account' })).toBeVisible();
    await addMember(page, 'STAFF', 'consavro-e2e-unknown-team@example.com');
    await expect(page.getByRole('alert').filter({ hasText: 'No verified account' })).toBeVisible();
    const count = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "business_member" WHERE "businessId" = $1', [businessId],
    );
    expect(count.rows[0].count).toBe(1); // Only the original OWNER.
  });

  test('OWNER changes STAFF to MANAGER and OWNER, and changes persist', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Promote');
    await openTeam(page, businessId);
    await addMember(page);
    await expect(page.getByRole('combobox', { name: `Role for ${teammateName}` })).toBeVisible();
    await page.getByRole('combobox', { name: `Role for ${teammateName}` }).selectOption('MANAGER');
    await expect.poll(async () => (await memberRows(businessId))[0]?.role).toBe('MANAGER');
    await page.getByRole('combobox', { name: `Role for ${teammateName}` }).selectOption('OWNER');
    await expect.poll(async () => (await memberRows(businessId))[0]?.role).toBe('OWNER');
    await page.reload();
    await expect(page.getByRole('combobox', { name: `Role for ${teammateName}` })).toHaveValue('OWNER');
  });

  test('OWNER removes a member after confirmation', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Remove');
    await openTeam(page, businessId);
    await addMember(page);
    await expect(page.getByText(teammateEmail, { exact: true })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: `Remove ${teammateName}` }).click();
    await expect.poll(async () => (await memberRows(businessId)).length).toBe(0);
    await expect(page.getByText(teammateEmail, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(teammateEmail, { exact: true })).toHaveCount(0);
  });

  test('MANAGER can view the team but cannot add, change, or remove members', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Manager Read');
    await pool.query(`UPDATE "business_member" SET role = 'MANAGER' WHERE "businessId" = $1 AND "userId" = $2`, [businessId, await ownerId()]);
    await openTeam(page, businessId);
    await expect(page.getByText('Your role: MANAGER')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Team members/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add member' })).toHaveCount(0);
    await expect(page.getByLabel('Member email')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  });

  test('STAFF cannot access the team page even with the URL', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Staff Denied');
    await pool.query(`UPDATE "business_member" SET role = 'STAFF' WHERE "businessId" = $1 AND "userId" = $2`, [businessId, await ownerId()]);
    await page.goto(`/dashboard/businesses/${businessId}/team`);
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  });

  test('OWNER cannot edit or remove their own membership through team controls', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Self Protection');
    await openTeam(page, businessId);
    await expect(page.getByText('Consavro E2E User (you)')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Role for Consavro E2E User' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove Consavro E2E User' })).toHaveCount(0);
    expect((await memberRows(businessId, await ownerId()))[0]?.role).toBe('OWNER');
  });

  test('membership changes remain isolated to the selected business', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'Isolation A');
    const second = await createBusiness(page, 'Isolation B');
    await openTeam(page, first);
    await addMember(page);
    await expect.poll(async () => (await memberRows(first)).length).toBe(1);
    expect(await memberRows(second)).toHaveLength(0);
    await page.getByRole('combobox', { name: `Role for ${teammateName}` }).selectOption('MANAGER');
    await expect.poll(async () => (await memberRows(first))[0]?.role).toBe('MANAGER');
    expect(await memberRows(second)).toHaveLength(0);
  });
});
