import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

// Run this suite in isolation against a disposable development/test database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Client Lifecycle E2E';
const base = (business: string) => `/dashboard/businesses/${business}/clients`;

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
async function createBusiness(page: Page, suffix: string): Promise<string> {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const rows = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name = $1', [name]);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0].id;
}
type ClientRow = {
  id: string; businessId: string; name: string; email: string | null;
  phone: string | null; addressLine1: string | null; city: string | null;
  notes: string | null; commissionRateOverride: string | null; archivedAt: Date | null;
};
async function clients(business: string): Promise<ClientRow[]> {
  return (await pool.query<ClientRow>(
    'SELECT id, "businessId", name, email, phone, "addressLine1", city, notes, "commissionRateOverride", "archivedAt" FROM "client" WHERE "businessId" = $1 ORDER BY name, id',
    [business],
  )).rows;
}
async function businessRate(business: string) {
  const result = await pool.query<{ defaultCommissionRate: string }>(
    'SELECT "defaultCommissionRate" FROM "business" WHERE id = $1', [business],
  );
  return result.rows[0].defaultCommissionRate;
}
async function createClient(page: Page, business: string, name: string, fields: Record<string, string> = {}) {
  await page.goto(`${base(business)}/new`);
  await page.getByLabel('Client name').fill(name);
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`/businesses/${business}/clients/?$`), { timeout: 20_000 });
  const result = (await pool.query<{ id: string }>(
    'SELECT id FROM "client" WHERE "businessId" = $1 AND name = $2', [business, name],
  )).rows;
  expect(result).toHaveLength(1);
  return result[0].id;
}
async function editClient(page: Page, business: string, id: string, fields: Record<string, string>) {
  await page.goto(`${base(business)}/${id}/edit`);
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/businesses/${business}/clients/${id}/?$`), { timeout: 20_000 });
}
async function setDefault(page: Page, business: string, value: string) {
  await page.goto(`/dashboard/businesses/${business}/commission`);
  await page.getByLabel('Default business commission (%)').fill(value);
  await page.getByRole('button', { name: 'Save commission policy' }).click();
  await expect(page.getByText('Default commission saved.')).toBeVisible();
  await expect.poll(() => businessRate(business)).toBe(Number(value).toFixed(2));
}
async function archive(page: Page, business: string, id: string) {
  await page.goto(`${base(business)}/${id}`);
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Archive client' }).click();
  await expect.poll(async () => (await clients(business)).find(c => c.id === id)?.archivedAt).not.toBeNull();
}

test.describe('client management — integration and lifecycle', () => {
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
    try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); }
  });

  test('creates a client with contact details and commission override in one workflow', async ({ page }) => {
    await signIn(page);
    const b = await createBusiness(page, 'Full Create');
    const id = await createClient(page, b, 'Complete LEGO Consignor', {
      Email: 'consignor@example.com', Phone: '408-555-0199',
      'Street address': '123 Brick Lane', City: 'San Jose', Notes: 'Vintage sets',
      'Client commission override (%)': '19.5',
    });
    const record = (await clients(b)).find(c => c.id === id)!;
    expect(record).toMatchObject({
      name: 'Complete LEGO Consignor', email: 'consignor@example.com',
      phone: '408-555-0199', addressLine1: '123 Brick Lane',
      city: 'San Jose', notes: 'Vintage sets', commissionRateOverride: '19.50',
    });
    await page.goto(`${base(b)}/${id}`);
    await expect(page.getByText('consignor@example.com')).toBeVisible();
    await expect(page.getByText('Vintage sets')).toBeVisible();
    await expect(page.getByText('Client-specific override')).toBeVisible();
  });

  test('editing contact details preserves the client commission override', async ({ page }) => {
    await signIn(page);
    const b = await createBusiness(page, 'Edit Contact');
    const id = await createClient(page, b, 'Contact Edit Client', {
      Email: 'original@example.com', 'Client commission override (%)': '22',
    });
    await editClient(page, b, id, { Email: 'updated@example.com', Phone: '650-555-0142' });
    const record = (await clients(b))[0];
    expect(record.email).toBe('updated@example.com');
    expect(record.phone).toBe('650-555-0142');
    expect(record.commissionRateOverride).toBe('22.00');
    await page.reload();
    await expect(page.getByText('updated@example.com')).toBeVisible();
    await expect(page.getByText('Client-specific override')).toBeVisible();
  });

  test('editing the commission override preserves existing contact information', async ({ page }) => {
    await signIn(page);
    const b = await createBusiness(page, 'Edit Commission');
    const id = await createClient(page, b, 'Commission Edit Client', {
      Email: 'stable@example.com', Phone: '408-555-0111',
      'Street address': '45 Set Street', Notes: 'Do not lose this note',
    });
    await editClient(page, b, id, { 'Client commission override (%)': '17.25' });
    const record = (await clients(b))[0];
    expect(record).toMatchObject({
      email: 'stable@example.com', phone: '408-555-0111',
      addressLine1: '45 Set Street', notes: 'Do not lose this note',
      commissionRateOverride: '17.25',
    });
  });

  test('business default updates inherited clients but not overridden clients', async ({ page }) => {
    await signIn(page);
    const b = await createBusiness(page, 'Inheritance');
    const inheritedA = await createClient(page, b, 'Inherited A');
    const overridden = await createClient(page, b, 'Overridden', { 'Client commission override (%)': '18' });
    const inheritedB = await createClient(page, b, 'Inherited B');
    await setDefault(page, b, '37.5');
    const rows = await clients(b);
    expect(rows.find(c => c.id === inheritedA)?.commissionRateOverride).toBeNull();
    expect(rows.find(c => c.id === inheritedB)?.commissionRateOverride).toBeNull();
    expect(rows.find(c => c.id === overridden)?.commissionRateOverride).toBe('18.00');
    await page.goto(`${base(b)}/${inheritedA}`);
    await expect(page.getByText('Using business default')).toBeVisible();
    await expect(page.getByText('Business commission:')).toContainText('37.5%');
    await page.goto(`${base(b)}/${overridden}`);
    await expect(page.getByText('Client-specific override')).toBeVisible();
    await expect(page.getByText('Business commission:')).toContainText('18%');
  });

  test('archiving preserves contact information and commission override', async ({ page }) => {
    await signIn(page);
    const b = await createBusiness(page, 'Archive Retention');
    const id = await createClient(page, b, 'Archived Consignor', {
      Email: 'archive@example.com', Notes: 'Keep records',
      'Client commission override (%)': '24',
    });
    await archive(page, b, id);
    const record = (await clients(b))[0];
    expect(record.archivedAt).not.toBeNull();
    expect(record.email).toBe('archive@example.com');
    expect(record.notes).toBe('Keep records');
    expect(record.commissionRateOverride).toBe('24.00');
    await page.goto(`${base(b)}?archived=true`);
    await expect(page.getByRole('link', { name: 'Archived Consignor' })).toBeVisible();
    await page.getByRole('link', { name: 'Archived Consignor' }).click();
    await expect(page.getByText('Archived client', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'archive@example.com', exact: true })).toBeVisible();
    await expect(page.getByText('Keep records')).toBeVisible();
    await expect(page.getByText('Client-specific override')).toBeVisible();
  });

  test('archived clients cannot be edited or reactivated through normal navigation', async ({ page }) => {
    await signIn(page);
    const b = await createBusiness(page, 'Archived Locked');
    const id = await createClient(page, b, 'Locked Client');
    await archive(page, b, id);
    await page.goto(`${base(b)}/${id}`);
    await expect(page.getByRole('link', { name: 'Edit client' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive client' })).toHaveCount(0);
    await page.goto(`${base(b)}/${id}/edit`);
    await expect(page.getByText('404', { exact: true }).first()).toBeVisible();
    const record = (await clients(b))[0];
    expect(record.archivedAt).not.toBeNull();
    expect(record.name).toBe('Locked Client');
  });

  test('switching between business client lists does not mix tenants', async ({ page }) => {
    await signIn(page);
    const a = await createBusiness(page, 'Tenant A');
    const b = await createBusiness(page, 'Tenant B');
    const aId = await createClient(page, a, 'Tenant A Consignor', { Email: 'a@example.com' });
    const bId = await createClient(page, b, 'Tenant B Consignor', { Email: 'b@example.com' });
    await page.goto(base(a));
    await expect(page.getByRole('link', { name: 'Tenant A Consignor' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tenant B Consignor' })).toHaveCount(0);
    await page.goto(base(b));
    await expect(page.getByRole('link', { name: 'Tenant B Consignor' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tenant A Consignor' })).toHaveCount(0);
    await page.goto(`${base(b)}/${aId}`);
    await expect(page.getByText('404', { exact: true }).first()).toBeVisible();
    expect((await clients(a))[0].id).toBe(aId);
    expect((await clients(b))[0].id).toBe(bId);
  });

  test('active and archived navigation stays accurate through the client lifecycle', async ({ page }) => {
    await signIn(page);
    const b = await createBusiness(page, 'List Lifecycle');
    const keep = await createClient(page, b, 'Keep Active');
    const archiveId = await createClient(page, b, 'Move To Archive');
    await archive(page, b, archiveId);
    await page.goto(base(b));
    await expect(page.getByRole('link', { name: 'Keep Active' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Move To Archive' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Archived clients' }).click();
    await expect(page.getByRole('link', { name: 'Move To Archive' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Keep Active' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('link', { name: 'Move To Archive' })).toBeVisible();
    await page.getByRole('link', { name: 'Active clients' }).click();
    await expect(page.getByRole('link', { name: 'Keep Active' })).toBeVisible();
    const rows = await clients(b);
    expect(rows.find(c => c.id === keep)?.archivedAt).toBeNull();
    expect(rows.find(c => c.id === archiveId)?.archivedAt).not.toBeNull();
  });
});
