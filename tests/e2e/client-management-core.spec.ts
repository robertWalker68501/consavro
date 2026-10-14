import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Run only against the disposable Neon development/test database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Client CRUD E2E';

async function cleanupClientsAndBusinesses() {
  // Business deletion cascades its client records.
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}

async function createBusiness(page: Page, suffix: string): Promise<string> {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>(
    'SELECT id FROM "business" WHERE name = $1', [name],
  );
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}

function clientsPath(businessId: string) {
  return `/dashboard/businesses/${businessId}/clients`;
}

async function openNewClient(page: Page, businessId: string) {
  await page.goto(`${clientsPath(businessId)}/new`);
  await expect(page.getByRole('heading', { name: 'Add client' })).toBeVisible();
}

async function createClient(page: Page, businessId: string, name: string) {
  await openNewClient(page, businessId);
  await page.getByLabel('Client name').fill(name);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/businesses/${businessId}/clients/?$`), {
    timeout: 20_000,
  });
}

async function clientRows(businessId: string) {
  return (await pool.query<{
    id: string; name: string; archivedAt: Date | null;
  }>(
    'SELECT id, name, "archivedAt" FROM "client" WHERE "businessId" = $1 ORDER BY "createdAt", id',
    [businessId],
  )).rows;
}

test.describe('client management — core CRUD', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupClientsAndBusinesses();
    await resetTestAccount();
    const registration = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Consavro E2E User', email, password },
    });
    expect(
      registration.ok(),
      `E2E registration failed: ${registration.status()} ${await registration.text()}`,
    ).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });

  test.beforeEach(cleanupClientsAndBusinesses);

  test.afterAll(async () => {
    try {
      await cleanupClientsAndBusinesses();
      await resetTestAccount();
    } finally {
      await pool.end();
    }
  });

  test('OWNER creates a client scoped to their business', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Create');
    await createClient(page, businessId, 'LEGO Test Client');
    await expect.poll(async () => (await clientRows(businessId)).length).toBe(1);
    const [client] = await clientRows(businessId);
    expect(client.name).toBe('LEGO Test Client');
    expect(client.archivedAt).toBeNull();
  });

  test('active client list shows newly created clients', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'List');
    await createClient(page, businessId, 'LEGO Active Client');
    await expect(
      page.getByRole('link', { name: 'LEGO Active Client' }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('link', { name: 'LEGO Active Client' }),
    ).toBeVisible();
  });

  test('client detail page displays name and active status', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Details');
    await createClient(page, businessId, 'LEGO Detail Client');
    const [client] = await clientRows(businessId);
    await page.goto(`${clientsPath(businessId)}/${client.id}`);
    await expect(page.getByRole('heading', { name: 'LEGO Detail Client' })).toBeVisible();
    await expect(page.getByText('Active client', { exact: true })).toBeVisible();
  });

  test('editing a client persists in database and after reload', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Edit');
    await createClient(page, businessId, 'Original LEGO Client');
    const [client] = await clientRows(businessId);
    await page.goto(`${clientsPath(businessId)}/${client.id}/edit`);
    await page.getByLabel('Client name').fill('Updated LEGO Client');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/businesses/${businessId}/clients/${client.id}/?$`),
      { timeout: 20_000 },
    );
    await expect(page.getByRole('heading', { name: 'Updated LEGO Client' })).toBeVisible();
    await expect.poll(async () => (await clientRows(businessId))[0]?.name).toBe('Updated LEGO Client');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Updated LEGO Client' })).toBeVisible();
  });

  test('archiving removes a client from active listing without deleting the record', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Archive');
    await createClient(page, businessId, 'Archive LEGO Client');
    const [client] = await clientRows(businessId);
    await page.goto(`${clientsPath(businessId)}/${client.id}`);
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Archive client' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/businesses/${businessId}/clients/?$`),
      { timeout: 20_000 },
    );
    await expect(page.getByRole('link', { name: 'Archive LEGO Client' })).toHaveCount(0);
    await expect.poll(async () => Boolean((await clientRows(businessId))[0]?.archivedAt)).toBe(true);
    expect((await clientRows(businessId))[0].id).toBe(client.id);
  });

  test('archived clients remain visible in archived list and detail view', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Archived Details');
    await createClient(page, businessId, 'Retained LEGO Client');
    const [client] = await clientRows(businessId);
    await page.goto(`${clientsPath(businessId)}/${client.id}`);
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Archive client' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/?$`), { timeout: 20_000 });
    await page.getByRole('link', { name: 'Archived clients' }).click();
    await expect(page.getByRole('link', { name: 'Retained LEGO Client' })).toBeVisible();
    await page.getByRole('link', { name: 'Retained LEGO Client' }).click();
    await expect(page.getByText('Archived client', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit client' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive client' })).toHaveCount(0);
  });

  test('blank and whitespace-only names are rejected without database writes', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Validation');
    await openNewClient(page, businessId);
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByText('Client name must be at least 2 characters')).toBeVisible();
    await page.getByLabel('Client name').fill('   ');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByText('Client name must be at least 2 characters')).toBeVisible();
    expect(await clientRows(businessId)).toHaveLength(0);
  });

  test('two clients can share the same name but have unique IDs', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Duplicate Names');
    await createClient(page, businessId, 'Shared LEGO Name');
    await createClient(page, businessId, 'Shared LEGO Name');
    await expect.poll(async () => (await clientRows(businessId)).length).toBe(2);
    const rows = await clientRows(businessId);
    expect(rows.map(row => row.name)).toEqual(['Shared LEGO Name', 'Shared LEGO Name']);
    expect(rows[0].id).not.toBe(rows[1].id);
    await page.reload();
    await expect(page.getByRole('link', { name: 'Shared LEGO Name' })).toHaveCount(2);
  });

  test('client records persist across dashboard navigation and page reload', async ({ page }) => {
    await signIn(page);
    const businessId = await createBusiness(page, 'Persistence');
    await createClient(page, businessId, 'Persistent LEGO Client');
    const [client] = await clientRows(businessId);
    await page.goto('/dashboard');
    await page.goto(clientsPath(businessId));
    await expect(page.getByRole('link', { name: 'Persistent LEGO Client' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('link', { name: 'Persistent LEGO Client' })).toBeVisible();
    await page.goto(`${clientsPath(businessId)}/${client.id}`);
    await expect(page.getByRole('heading', { name: 'Persistent LEGO Client' })).toBeVisible();
  });
});
