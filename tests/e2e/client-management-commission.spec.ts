import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Run only against the disposable Neon development/test database.
// Like the other Client Management specs, this uses the shared test account:
// run this spec by itself rather than concurrently with other account-reset specs.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Commission E2E';

type ClientRow = {
  id: string;
  name: string;
  commissionRateOverride: string | null;
  archivedAt: Date | null;
};

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}

async function createBusiness(page: Page, suffix: string): Promise<string> {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM "business" WHERE name = $1', [name],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}

function businessPath(id: string) {
  return `/dashboard/businesses/${id}`;
}
function clientPath(id: string) {
  return `${businessPath(id)}/clients`;
}
function policyPath(id: string) {
  return `${businessPath(id)}/commission`;
}
async function businessRate(id: string): Promise<string> {
  const result = await pool.query<{ defaultCommissionRate: string }>(
    'SELECT "defaultCommissionRate" FROM "business" WHERE id = $1', [id],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0].defaultCommissionRate;
}
async function clients(id: string): Promise<ClientRow[]> {
  const result = await pool.query<ClientRow>(
    'SELECT id, name, "commissionRateOverride", "archivedAt" FROM "client" WHERE "businessId" = $1 ORDER BY "createdAt", id',
    [id],
  );
  return result.rows;
}
async function createClient(page: Page, businessId: string, name: string, override?: string) {
  await page.goto(`${clientPath(businessId)}/new`);
  await expect(page.getByRole('heading', { name: 'Add client' })).toBeVisible();
  await page.getByLabel('Client name').fill(name);
  if (override !== undefined) {
    await page.getByLabel('Client commission override (%)').fill(override);
  }
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`/businesses/${businessId}/clients/?$`), { timeout: 20_000 });
  const client = (await clients(businessId)).find(row => row.name === name);
  expect(client).toBeDefined();
  return client!;
}
async function setBusinessRate(page: Page, id: string, value: string) {
  await page.goto(policyPath(id));
  await page.getByLabel('Default business commission (%)').fill(value);
  await page.getByRole('button', { name: 'Save commission policy' }).click();
  await expect(page.getByText('Default commission saved.')).toBeVisible();
  await expect.poll(() => businessRate(id)).toBe(Number(value).toFixed(2));
}
async function expectEffectiveRate(page: Page, businessId: string, clientId: string, rate: string, source: string, payout: string) {
  await page.goto(`${clientPath(businessId)}/${clientId}`);
  const region = page.getByRole('region', { name: 'Commission policy' });
  await expect(region).toContainText(`Business commission: ${rate}%`);
  await expect(region).toContainText(source);
  await expect(region).toContainText(`Consignor receives ${payout}%`);
}

test.describe('client management — commission policies', () => {
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
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => {
    try { await cleanup(); await resetTestAccount(); }
    finally { await pool.end(); }
  });

  test('new businesses default to 30% and OWNER can access commission settings', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Default');
    expect(await businessRate(id)).toBe('30.00');
    await page.goto(businessPath(id));
    await expect(page.getByRole('link', { name: 'Commission policy' })).toBeVisible();
    await page.getByRole('link', { name: 'Commission policy' }).click();
    await expect(page.getByRole('heading', { name: 'Commission policy' })).toBeVisible();
    await expect(page.getByLabel('Default business commission (%)')).toHaveValue('30');
  });

  test('OWNER updates default rate with two decimal places and persists it', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Update Default');
    await setBusinessRate(page, id, '25.50');
    await page.reload();
    await expect(page.getByLabel('Default business commission (%)')).toHaveValue('25.5');
    expect(await businessRate(id)).toBe('25.50');
  });

  test('client without override inherits default, including later changes', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Inheritance');
    await setBusinessRate(page, id, '25.50');
    const client = await createClient(page, id, 'Inherited LEGO Client');
    expect(client.commissionRateOverride).toBeNull();
    await expectEffectiveRate(page, id, client.id, '25.5', 'Using business default', '74.50');
    await setBusinessRate(page, id, '35');
    await expectEffectiveRate(page, id, client.id, '35', 'Using business default', '65.00');
    expect((await clients(id))[0].commissionRateOverride).toBeNull();
  });

  test('client override remains fixed when business default changes', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Override');
    await setBusinessRate(page, id, '25.50');
    const client = await createClient(page, id, 'Override LEGO Client', '20');
    expect(client.commissionRateOverride).toBe('20.00');
    await expectEffectiveRate(page, id, client.id, '20', 'Client-specific override', '80.00');
    await setBusinessRate(page, id, '35');
    await expectEffectiveRate(page, id, client.id, '20', 'Client-specific override', '80.00');
    expect((await clients(id))[0].commissionRateOverride).toBe('20.00');
  });

  test('clearing an override restores inheritance and persists after reload', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Clear Override');
    await setBusinessRate(page, id, '35');
    const client = await createClient(page, id, 'Clear Override LEGO Client', '20');
    await page.goto(`${clientPath(id)}/${client.id}/edit`);
    await expect(page.getByLabel('Client commission override (%)')).toHaveValue('20');
    await page.getByLabel('Client commission override (%)').fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/?$`), { timeout: 20_000 });
    await expect.poll(async () => (await clients(id))[0]?.commissionRateOverride).toBeNull();
    await page.reload();
    const region = page.getByRole('region', { name: 'Commission policy' });
    await expect(region).toContainText('Using business default');
    await expect(region).toContainText('Business commission: 35%');
  });

  test('invalid default percentages are rejected without changing saved policy', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Default Validation');
    await page.goto(policyPath(id));
    const input = page.getByLabel('Default business commission (%)');
    for (const value of ['101', '-1', '12.345']) {
      await input.fill(value);
      await page.getByRole('button', { name: 'Save commission policy' }).click();
      await expect(page.getByText('Enter a percentage from 0 to 100 with at most two decimal places.')).toBeVisible();
      expect(await businessRate(id)).toBe('30.00');
    }
  });

  test('invalid client override percentages are rejected without creating a client', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Override Validation');
    await page.goto(`${clientPath(id)}/new`);
    await page.getByLabel('Client name').fill('Invalid Commission Client');
    const input = page.getByLabel('Client commission override (%)');
    for (const value of ['101', '-1', '12.345']) {
      await input.fill(value);
      await page.getByRole('button', { name: 'Create client' }).click();
      await expect(page.getByText('Enter a percentage from 0 to 100 with at most two decimal places.')).toBeVisible();
      expect(await clients(id)).toHaveLength(0);
    }
  });

  test('archived client retains its commission override and remains read-only', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Archive');
    const client = await createClient(page, id, 'Archived Commission Client', '15.75');
    await page.goto(`${clientPath(id)}/${client.id}`);
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Archive client' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/?$`), { timeout: 20_000 });
    await page.goto(`${clientPath(id)}/${client.id}`);
    await expect(page.getByText('Archived client', { exact: true })).toBeVisible();
    const region = page.getByRole('region', { name: 'Commission policy' });
    await expect(region).toContainText('Business commission: 15.75%');
    await expect(region).toContainText('Client-specific override');
    await expect(page.getByRole('link', { name: 'Edit client' })).toHaveCount(0);
    expect((await clients(id))[0].commissionRateOverride).toBe('15.75');
    expect((await clients(id))[0].archivedAt).not.toBeNull();
  });

  test('MANAGER cannot access or update business-wide commission settings', async ({ page }) => {
    await signIn(page);
    const id = await createBusiness(page, 'Manager Access');
    // Change this disposable account's membership, not a real user's membership.
    const updated = await pool.query(
      'UPDATE "business_member" SET role = $1 WHERE "businessId" = $2',
      ['MANAGER', id],
    );
    expect(updated.rowCount).toBe(1);
    await page.goto(businessPath(id));
    await expect(page.getByRole('link', { name: 'Commission policy' })).toHaveCount(0);
    await page.goto(policyPath(id));
    await expect(page.getByRole('heading', { name: 'Commission policy' })).toHaveCount(0);
    expect(await businessRate(id)).toBe('30.00');
  });
});
