import { expect, test, type Page, type Request } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Only run against the disposable development/test database, in isolation.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Client Security E2E';
type Role = 'OWNER' | 'MANAGER' | 'STAFF';
type Action = { url: string; headers: Record<string, string>; body: string };
async function cleanup() { await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]); }
async function userId() {
  const rows = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function createBusiness(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name = $1', [name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function setRole(id: string, role: Role) {
  const result = await pool.query('UPDATE "business_member" SET role = $1, "updatedAt" = NOW() WHERE "businessId" = $2 AND "userId" = $3', [role, id, await userId()]);
  expect(result.rowCount).toBe(1);
}
async function createClient(page: Page, id: string, name: string) {
  await page.goto(`/dashboard/businesses/${id}/clients/new`);
  await page.getByLabel('Client name').fill(name);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`/businesses/${id}/clients/?$`), { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "client" WHERE "businessId" = $1 AND name = $2', [id, name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
async function state(id: string) {
  const rows = await pool.query<{ name: string; businessId: string; archivedAt: Date | null; commissionRateOverride: string | null }>(
    'SELECT name, "businessId", "archivedAt", "commissionRateOverride" FROM "client" WHERE id = $1', [id]);
  return rows.rows[0];
}
async function rate(id: string) {
  const rows = await pool.query<{ defaultCommissionRate: string }>('SELECT "defaultCommissionRate" FROM "business" WHERE id = $1', [id]);
  return rows.rows[0].defaultCommissionRate;
}
async function denied(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText('404', { exact: true }).first()).toBeVisible();
}
async function capture(page: Page, perform: () => Promise<void>): Promise<Action> {
  const requests: Request[] = [];
  const listener = (req: Request) => { if (req.method() === 'POST' && req.headers()['next-action']) requests.push(req); };
  page.on('request', listener);
  try {
    await perform();
    await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const req = requests[0], original = req.headers();
    const headers: Record<string, string> = {};
    for (const key of ['next-action', 'next-router-state-tree', 'content-type', 'accept']) if (original[key]) headers[key] = original[key];
    expect(req.postData()).toBeTruthy();
    return { url: req.url(), headers, body: req.postData()! };
  } finally { page.off('request', listener); }
}
async function replay(page: Page, action: Action, body: string) {
  await page.evaluate(async ({ url, headers, body }) => {
    await fetch(url, { method: 'POST', headers, body, credentials: 'same-origin' });
  }, { url: action.url, headers: action.headers, body });
}
function swap(body: string, from: string, to: string) {
  expect(body).toContain(from);
  return body.replace(from, to);
}

test.describe('client management — authorization and tenant isolation', () => {
  test.beforeAll(async ({ request }) => {
    await cleanup(); await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', { data: { name: 'Consavro E2E User', email, password } });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => { try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); } });

  test('unauthenticated users are redirected from client and policy routes', async ({ page }) => {
    for (const suffix of ['clients', 'clients/new', 'clients/fake/edit', 'commission']) {
      await page.goto(`/dashboard/businesses/fake/${suffix}`);
      await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    }
  });
  test('OWNER can manage clients and business commission policy', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Owner');
    const client = await createClient(page, business, 'Owner Client');
    await page.goto(`/dashboard/businesses/${business}/clients/${client}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit client' })).toBeVisible();
    await page.goto(`/dashboard/businesses/${business}/commission`);
    await expect(page.getByLabel('Default business commission (%)')).toBeVisible();
    await page.goto(`/dashboard/businesses/${business}/clients/${client}`);
    await expect(page.getByRole('button', { name: 'Archive client' })).toBeVisible();
  });
  test('MANAGER can edit client commission override but not business default', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Manager');
    const client = await createClient(page, business, 'Manager Client');
    await setRole(business, 'MANAGER');
    await page.goto(`/dashboard/businesses/${business}/clients/${client}/edit`);
    await page.getByLabel('Client commission override (%)').fill('18');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(async () => (await state(client)).commissionRateOverride).toBe('18.00');
    await denied(page, `/dashboard/businesses/${business}/commission`);
    expect(await rate(business)).toBe('30.00');
  });
  test('STAFF can read but not create, edit, archive or change commission', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Staff');
    const client = await createClient(page, business, 'Staff Client');
    await setRole(business, 'STAFF');
    await page.goto(`/dashboard/businesses/${business}/clients`);
    await expect(page.getByRole('link', { name: 'Staff Client' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add client' })).toHaveCount(0);
    await page.goto(`/dashboard/businesses/${business}/clients/${client}`);
    await expect(page.getByRole('link', { name: 'Edit client' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive client' })).toHaveCount(0);
    for (const suffix of ['clients/new', `clients/${client}/edit`, 'commission']) await denied(page, `/dashboard/businesses/${business}/${suffix}`);
    expect((await state(client)).archivedAt).toBeNull();
  });
  test('client IDs cannot cross business boundaries in detail and edit routes', async ({ page }) => {
    await signIn(page);
    const a = await createBusiness(page, 'A'), b = await createBusiness(page, 'B');
    const client = await createClient(page, a, 'Tenant A Client');
    await denied(page, `/dashboard/businesses/${b}/clients/${client}`);
    await denied(page, `/dashboard/businesses/${b}/clients/${client}/edit`);
    expect((await state(client)).businessId).toBe(a);
  });
  test('a known business ID without membership grants no access', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'No Membership');
    const client = await createClient(page, business, 'Isolated Client');
    await pool.query('DELETE FROM "business_member" WHERE "businessId" = $1 AND "userId" = $2', [business, await userId()]);
    for (const suffix of ['clients', 'clients/new', `clients/${client}`, `clients/${client}/edit`, 'commission']) await denied(page, `/dashboard/businesses/${business}/${suffix}`);
  });
  test('forged cross-business server action cannot change a client', async ({ page }) => {
    await signIn(page);
    const a = await createBusiness(page, 'Action A'), b = await createBusiness(page, 'Action B');
    const client = await createClient(page, a, 'Original Client');
    await page.goto(`/dashboard/businesses/${a}/clients/${client}/edit`);
    const action = await capture(page, async () => {
      await page.getByLabel('Client name').fill('Authorized Update');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect.poll(async () => (await state(client)).name).toBe('Authorized Update');
    });
    await replay(page, action, swap(action.body, a, b));
    expect((await state(client)).name).toBe('Authorized Update');
  });
  test('STAFF cannot replay previously captured client update action', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Staff Action');
    const client = await createClient(page, business, 'Original Staff Client');
    await page.goto(`/dashboard/businesses/${business}/clients/${client}/edit`);
    const action = await capture(page, async () => {
      await page.getByLabel('Client name').fill('Authorized Staff Test');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect.poll(async () => (await state(client)).name).toBe('Authorized Staff Test');
    });
    await setRole(business, 'STAFF');
    await replay(page, action, swap(action.body, 'Authorized Staff Test', 'Forged Staff Edit'));
    expect((await state(client)).name).toBe('Authorized Staff Test');
  });
  test('MANAGER cannot replay previously captured business commission update', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Manager Action');
    await page.goto(`/dashboard/businesses/${business}/commission`);
    const action = await capture(page, async () => {
      await page.getByLabel('Default business commission (%)').fill('27');
      await page.getByRole('button', { name: 'Save commission policy' }).click();
      await expect(page.getByText('Default commission saved.')).toBeVisible();
    });
    expect(await rate(business)).toBe('27.00');
    await setRole(business, 'MANAGER');
    await replay(page, action, swap(action.body, '27', '61'));
    expect(await rate(business)).toBe('27.00');
  });
  test('archived client rejects a previously captured edit action', async ({ page }) => {
    await signIn(page);
    const business = await createBusiness(page, 'Archived Action');
    const client = await createClient(page, business, 'Before Archive');
    await page.goto(`/dashboard/businesses/${business}/clients/${client}/edit`);
    const action = await capture(page, async () => {
      await page.getByLabel('Client name').fill('Before Archive Edited');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect.poll(async () => (await state(client)).name).toBe('Before Archive Edited');
    });
    await page.goto(`/dashboard/businesses/${business}/clients/${client}`);
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Archive client' }).click();
    await expect.poll(async () => (await state(client)).archivedAt).not.toBeNull();
    await denied(page, `/dashboard/businesses/${business}/clients/${client}/edit`);
    await replay(page, action, swap(action.body, 'Before Archive Edited', 'Archived Forgery'));
    expect((await state(client)).name).toBe('Before Archive Edited');
  });
});
