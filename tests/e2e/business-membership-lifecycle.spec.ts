import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Run only against a disposable development/test database.
// The fixture user is not a real customer account.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Membership Lifecycle E2E';
const teammate = {
  id: 'consavro-e2e-lifecycle-teammate-id',
  name: 'Consavro Lifecycle Teammate',
  email: 'consavro-e2e-lifecycle-teammate@example.com',
};

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
  await pool.query('DELETE FROM "user" WHERE id = $1', [teammate.id]);
}

async function ownerId() {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  expect(result.rows).toHaveLength(1);
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

async function openTeam(page: Page, businessId: string) {
  await page.goto(`/dashboard/businesses/${businessId}/team`);
  await expect(page.getByRole('heading', { name: /Team members/ })).toBeVisible();
}

async function addTeammate(page: Page, role: 'STAFF' | 'MANAGER' = 'STAFF') {
  await page.getByLabel('Member email').fill(teammate.email);
  await page.getByLabel('Business role').click();
  await page.locator('[data-slot="select-item"][role="option"]')
    .filter({ hasText: role === 'STAFF' ? /^Staff$/ : /^Manager$/ })
    .click();
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status')).toContainText('Team member added.');
}

async function member(businessId: string, userId = teammate.id) {
  const result = await pool.query<{ id: string; role: string }>(
    'SELECT id, role::text AS role FROM "business_member" WHERE "businessId" = $1 AND "userId" = $2',
    [businessId, userId],
  );
  return result.rows[0];
}

async function setRole(page: Page, role: 'OWNER' | 'MANAGER' | 'STAFF') {
  await page.getByRole('combobox', { name: `Role for ${teammate.name}` }).selectOption(role);
  await expect(page.getByRole('status')).toContainText('Role updated.');
}

async function removeTeammate(page: Page) {
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: `Remove ${teammate.name}` }).click();
  await expect(page.getByRole('status')).toContainText('Team member removed.');
}

test.describe('business membership integration and lifecycle', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,NOW(),NOW())',
      [teammate.id, teammate.name, teammate.email],
    );
  });

  test.beforeEach(async () => {
    await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
  });

  test.afterAll(async () => {
    try {
      await cleanup();
      await resetTestAccount();
    } finally {
      await pool.end();
    }
  });

  test('creation immediately establishes a durable OWNER membership', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Create');
    expect((await member(id, await ownerId()))?.role).toBe('OWNER');
    await page.reload();
    await page.goto(`/dashboard/businesses/${id}`);
    await expect(page.getByText('Your role: OWNER', { exact: true })).toBeVisible();
    await openTeam(page, id);
    await expect(page.getByText(email, { exact: true })).toBeVisible();
  });

  test('add, promote, demote, and remove persists through reloads', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Role lifecycle');
    await openTeam(page, id);
    await addTeammate(page);
    await expect.poll(async () => (await member(id))?.role).toBe('STAFF');
    await setRole(page, 'MANAGER');
    await expect.poll(async () => (await member(id))?.role).toBe('MANAGER');
    await page.reload();
    await expect(page.getByRole('combobox', { name: `Role for ${teammate.name}` })).toHaveValue('MANAGER');
    await setRole(page, 'STAFF');
    await expect.poll(async () => (await member(id))?.role).toBe('STAFF');
    await removeTeammate(page);
    await expect.poll(async () => await member(id)).toBeUndefined();
    await page.reload();
    await expect(page.getByText(teammate.email, { exact: true })).toHaveCount(0);
  });

  test('removed account can rejoin and receives a fresh membership', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Rejoin');
    await openTeam(page, id);
    await addTeammate(page);
    const original = await member(id);
    expect(original?.role).toBe('STAFF');
    await removeTeammate(page);
    await expect.poll(async () => await member(id)).toBeUndefined();
    await addTeammate(page, 'MANAGER');
    await expect.poll(async () => (await member(id))?.role).toBe('MANAGER');
    expect((await member(id))?.id).not.toBe(original.id);
    await page.reload();
    await expect(page.getByRole('combobox', { name: `Role for ${teammate.name}` })).toHaveValue('MANAGER');
  });

  test('same account has independent memberships and roles across businesses', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'Multiple A');
    const second = await createBusiness(page, 'Multiple B');
    await openTeam(page, first);
    await addTeammate(page, 'STAFF');
    await openTeam(page, second);
    await addTeammate(page, 'MANAGER');
    expect((await member(first))?.role).toBe('STAFF');
    expect((await member(second))?.role).toBe('MANAGER');
    await setRole(page, 'OWNER');
    await expect.poll(async () => (await member(second))?.role).toBe('OWNER');
    expect((await member(first))?.role).toBe('STAFF');
    await page.reload();
    await expect(page.getByRole('combobox', { name: `Role for ${teammate.name}` })).toHaveValue('OWNER');
  });

  test('removal in one business does not revoke membership in another', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'Removal A');
    const second = await createBusiness(page, 'Removal B');
    await openTeam(page, first);
    await addTeammate(page);
    await openTeam(page, second);
    await addTeammate(page, 'MANAGER');
    await openTeam(page, first);
    await removeTeammate(page);
    await expect.poll(async () => await member(first)).toBeUndefined();
    expect((await member(second))?.role).toBe('MANAGER');
    await openTeam(page, second);
    await expect(page.getByText(teammate.email, { exact: true })).toBeVisible();
  });

  test('ownership handoff keeps at least one OWNER and preserves business access', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Ownership handoff');
    await openTeam(page, id);
    await addTeammate(page, 'MANAGER');
    await setRole(page, 'OWNER');
    await expect.poll(async () => (await member(id))?.role).toBe('OWNER');
    expect((await member(id, await ownerId()))?.role).toBe('OWNER');
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "business_member" WHERE "businessId" = $1 AND role = 'OWNER'`,
      [id],
    );
    expect(result.rows[0].count).toBe(2);
    await page.reload();
    await expect(page.getByText(teammate.email, { exact: true })).toBeVisible();
    await page.goto(`/dashboard/businesses/${id}`);
    await expect(page.getByRole('heading', { name: /404|not found/i })).toHaveCount(0);
  });

  test('business deletion cascades its memberships without affecting another business', async ({ page }) => {
    await signIn(page);
    const first = await createBusiness(page, 'Cascade A');
    const second = await createBusiness(page, 'Cascade B');
    await openTeam(page, first);
    await addTeammate(page);
    await openTeam(page, second);
    await addTeammate(page);
    // Delete via database to validate the schema lifecycle independently of a future delete UI.
    await pool.query('DELETE FROM "business" WHERE id = $1', [first]);
    expect(await member(first)).toBeUndefined();
    expect((await member(second))?.role).toBe('STAFF');
    expect((await member(second, await ownerId()))?.role).toBe('OWNER');
    await openTeam(page, second);
    await expect(page.getByText(teammate.email, { exact: true })).toBeVisible();
  });
});
