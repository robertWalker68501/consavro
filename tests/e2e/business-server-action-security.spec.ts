import { expect, test, type Page, type Request } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// SECURITY: This suite writes to the configured DATABASE_URL. Use a disposable dev/test database.
// These tests replay real Next.js Server Action requests, not merely UI visibility checks.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Action Security E2E';
const first = { id: 'consavro-action-security-first', email: 'consavro-action-security-first@example.com', name: 'Action Security First' };
const second = { id: 'consavro-action-security-second', email: 'consavro-action-security-second@example.com', name: 'Action Security Second' };
type Role = 'OWNER' | 'MANAGER' | 'STAFF';

type CapturedAction = { url: string; body: string; headers: Record<string, string> };

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
  await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [[first.id, second.id]]);
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

async function member(businessId: string, userId: string) {
  const result = await pool.query<{ id: string; role: Role }>(
    'SELECT id, role::text AS role FROM "business_member" WHERE "businessId" = $1 AND "userId" = $2',
    [businessId, userId],
  );
  return result.rows[0];
}

async function ownerId() {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}

async function setRole(businessId: string, userId: string, role: Role) {
  const result = await pool.query(
    'UPDATE "business_member" SET role = $1, "updatedAt" = NOW() WHERE "businessId" = $2 AND "userId" = $3',
    [role, businessId, userId],
  );
  expect(result.rowCount).toBe(1);
}

async function openTeam(page: Page, businessId: string) {
  await page.goto(`/dashboard/businesses/${businessId}/team`);
  await expect(page.getByRole('heading', { name: /team members/i })).toBeVisible();
}

// Capture the real wire format/action ID from a successful UI call. Next.js Server Actions
// have framework-specific serialization; do not guess their endpoints or identifiers.
async function captureAction(page: Page, perform: () => Promise<void>): Promise<CapturedAction> {
  const pending: Request[] = [];
  const listener = (request: Request) => {
    if (request.method() === 'POST' && request.headers()['next-action']) pending.push(request);
  };
  page.on('request', listener);
  try {
    await perform();
    await expect.poll(() => pending.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const request = pending[0];
    const original = request.headers();
    const headers: Record<string, string> = {};
    for (const key of ['next-action', 'next-router-state-tree', 'content-type', 'accept']) {
      if (original[key]) headers[key] = original[key];
    }
    const body = request.postData();
    expect(body, 'Expected a serialized Server Action request body').toBeTruthy();
    return { url: request.url(), body: body!, headers };
  } finally {
    page.off('request', listener);
  }
}

async function addThroughUI(page: Page, memberEmail = first.email) {
  await page.getByLabel('Member email').fill(memberEmail);
  await page.getByLabel('Business role').click();
  await page.getByRole('option', { name: 'Staff' }).click();
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status')).toContainText('Team member added.');
}

// Re-send a captured action with attacker-controlled arguments, using the current
// browser session. The response can be an RSC stream, so assertions use database state.
async function replay(page: Page, captured: CapturedAction, body: string) {
  return page.evaluate(async ({ url, headers, body }) => {
    const response = await fetch(url, { method: 'POST', headers, body, credentials: 'same-origin' });
    return { status: response.status, text: await response.text() };
  }, { url: captured.url, headers: captured.headers, body });
}

function replaceExactly(body: string, original: string, replacement: string) {
  expect(body, `Captured action body must include ${original}`).toContain(original);
  return body.replace(original, replacement);
}

test.describe('business server-action security', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(response.ok(), `E2E registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1,$2,$3,true,NOW(),NOW()),($4,$5,$6,true,NOW(),NOW())',
      [first.id, first.name, first.email, second.id, second.name, second.email],
    );
  });
  test.beforeEach(async () => {
    await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
  });
  test.afterAll(async () => {
    try { await cleanup(); await resetTestAccount(); }
    finally { await pool.end(); }
  });

  test('a MANAGER cannot replay a captured OWNER add-member Server Action', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Manager Add');
    await openTeam(page, businessId);
    const captured = await captureAction(page, () => addThroughUI(page));
    expect(await member(businessId, first.id)).toBeTruthy();
    await setRole(businessId, await ownerId(), 'MANAGER');
    const response = await replay(page, captured, replaceExactly(captured.body, first.email, second.email));
    expect(await member(businessId, second.id), `Unexpected addition; HTTP ${response.status}`).toBeUndefined();
  });

  test('a STAFF member cannot replay a captured OWNER role-change Server Action', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Staff Role');
    await openTeam(page, businessId);
    await addThroughUI(page);
    const membership = await member(businessId, first.id);
    const captured = await captureAction(page, async () => {
      await page.getByRole('combobox', { name: `Role for ${first.name}` }).selectOption('MANAGER');
      await expect(page.getByRole('status')).toContainText('Role updated.');
    });
    await setRole(businessId, first.id, 'STAFF');
    await setRole(businessId, await ownerId(), 'STAFF');
    const response = await replay(page, captured, captured.body);
    expect((await member(businessId, first.id))?.role, `Unexpected role change; HTTP ${response.status}`).toBe('STAFF');
    expect(membership.id).toBeTruthy();
  });

  test('a MANAGER cannot replay a captured OWNER remove-member Server Action', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Manager Remove');
    await openTeam(page, businessId);
    await addThroughUI(page);
    const originalMember = await member(businessId, first.id);
    page.once('dialog', dialog => void dialog.accept());
    const captured = await captureAction(page, async () => {
      await page.getByRole('button', { name: `Remove ${first.name}` }).click();
      await expect(page.getByRole('status')).toContainText('Team member removed.');
    });
    // Recreate the removed membership so the replay would have an observable effect.
    const result = await pool.query<{ id: string }>(
      'INSERT INTO "business_member" (id, "businessId", "userId", role, "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING id',
      [`consavro-action-replay-${businessId}`, businessId, first.id, 'STAFF'],
    );
    await setRole(businessId, await ownerId(), 'MANAGER');
    const body = replaceExactly(captured.body, originalMember.id, result.rows[0].id);
    const response = await replay(page, captured, body);
    expect(await member(businessId, first.id), `Unexpected removal; HTTP ${response.status}`).toBeTruthy();
  });

  test('a forged cross-business membership ID cannot change another business role', async ({ page }) => {
    await signIn(page);
    const businessA = await createBusiness(page, 'Cross A');
    const businessB = await createBusiness(page, 'Cross B');
    await openTeam(page, businessA);
    await addThroughUI(page);
    const memberA = await member(businessA, first.id);
    await openTeam(page, businessB);
    await addThroughUI(page);
    const memberB = await member(businessB, first.id);
    const captured = await captureAction(page, async () => {
      await page.getByRole('combobox', { name: `Role for ${first.name}` }).selectOption('MANAGER');
      await expect(page.getByRole('status')).toContainText('Role updated.');
    });
    const forged = replaceExactly(captured.body, memberB.id, memberA.id);
    const response = await replay(page, captured, forged);
    expect((await member(businessA, first.id))?.role, `Cross-business mutation; HTTP ${response.status}`).toBe('STAFF');
  });

  test('forged self-demotion and self-removal cannot eliminate the sole OWNER', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Last Owner');
    await openTeam(page, businessId);
    await addThroughUI(page);
    const other = await member(businessId, first.id);
    const owner = await member(businessId, await ownerId());
    const change = await captureAction(page, async () => {
      await page.getByRole('combobox', { name: `Role for ${first.name}` }).selectOption('MANAGER');
      await expect(page.getByRole('status')).toContainText('Role updated.');
    });
    const forgedChange = replaceExactly(change.body, other.id, owner.id);
    await replay(page, change, forgedChange);
    expect((await member(businessId, await ownerId()))?.role).toBe('OWNER');
    page.once('dialog', dialog => void dialog.accept());
    const removal = await captureAction(page, async () => {
      await page.getByRole('button', { name: `Remove ${first.name}` }).click();
      await expect(page.getByRole('status')).toContainText('Team member removed.');
    });
    const forgedRemoval = replaceExactly(removal.body, other.id, owner.id);
    await replay(page, removal, forgedRemoval);
    expect((await member(businessId, await ownerId()))?.role).toBe('OWNER');
  });
});
