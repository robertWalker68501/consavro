import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import {
  email, password, resetTestAccount, signIn,
  waitForVerificationUrl, isTestEmailVerified,
} from './helpers/auth';

// Only run against a disposable development/test database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prefix = 'Consavro Client Contact E2E';
const fullContact = {
  email: 'lego.client@example.com',
  phone: '408-555-0188',
  addressLine1: '123 Brick Lane',
  addressLine2: 'Suite 42',
  city: 'San Jose',
  state: 'California',
  postalCode: '95112',
  country: 'United States',
  notes: 'Consignment: sealed sets, handle boxes carefully.\nPreferred pickup: Saturday.',
};
type ContactField = keyof typeof fullContact;
type ClientRow = { id: string; name: string; archivedAt: Date | null } & Record<ContactField, string | null>;

async function cleanup() {
  await pool.query('DELETE FROM "business" WHERE name LIKE $1', [`${prefix}%`]);
}
async function makeBusiness(page: Page, suffix: string) {
  const name = `${prefix} ${suffix}`;
  await page.goto('/dashboard/businesses/new');
  await page.getByLabel('Business name').fill(name);
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
  const result = await pool.query<{ id: string }>('SELECT id FROM "business" WHERE name = $1', [name]);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
function base(businessId: string) {
  return `/dashboard/businesses/${businessId}/clients`;
}
async function rows(businessId: string): Promise<ClientRow[]> {
  const result = await pool.query<ClientRow>(
    'SELECT id, name, email, phone, "addressLine1", "addressLine2", city, state, "postalCode", country, notes, "archivedAt" FROM "client" WHERE "businessId" = $1 ORDER BY "createdAt", id',
    [businessId],
  );
  return result.rows;
}
async function fillContact(page: Page, data: Partial<typeof fullContact> = fullContact) {
  const labels: Record<ContactField, string> = {
    email: 'Email', phone: 'Phone', addressLine1: 'Street address',
    addressLine2: 'Apartment or suite', city: 'City', state: 'State or region',
    postalCode: 'Postal code', country: 'Country', notes: 'Notes',
  };
  for (const [field, value] of Object.entries(data) as [ContactField, string][]) {
    await page.getByLabel(labels[field], { exact: true }).fill(value);
  }
}
async function createClient(page: Page, businessId: string, name: string, contact: Partial<typeof fullContact> = {}) {
  await page.goto(`${base(businessId)}/new`);
  await expect(page.getByRole('heading', { name: 'Add client' })).toBeVisible();
  await page.getByLabel('Client name').fill(name);
  await fillContact(page, contact);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(new RegExp(`/businesses/${businessId}/clients/?$`), { timeout: 20_000 });
  await expect(page.locator('a[href^="/dashboard/businesses/"]').filter({ has: page.getByText(name, { exact: true }) })).toBeVisible();
  const result = await rows(businessId);
  const client = result.find(row => row.name === name);
  expect(client).toBeDefined();
  return client!;
}

// The suite intentionally uses the same disposable account setup as Layer 1,
// and should be run as a targeted spec, not concurrently with Layer 1.
test.describe('client management — contact information', () => {
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

  test('creates a client with all contact fields and stores them in its business', async ({ page }) => {
    await signIn(page);
    const businessId = await makeBusiness(page, 'Create');
    const client = await createClient(page, businessId, 'Complete LEGO Client', fullContact);
    for (const [field, value] of Object.entries(fullContact) as [ContactField, string][]) {
      expect(client[field], `${field} should persist`).toBe(value);
    }
    expect(client.archivedAt).toBeNull();
  });

  test('shows saved contact information, mailing address, and multiline notes on details', async ({ page }) => {
    await signIn(page);
    const businessId = await makeBusiness(page, 'Details');
    const client = await createClient(page, businessId, 'Details LEGO Client', fullContact);
    await page.goto(`${base(businessId)}/${client.id}`);
    const contact = page.getByRole('region', { name: 'Contact information' });
    await expect(contact.getByRole('link', { name: fullContact.email })).toHaveAttribute('href', `mailto:${fullContact.email}`);
    await expect(contact).toContainText(fullContact.phone);
    for (const value of [fullContact.addressLine1, fullContact.addressLine2, fullContact.city, fullContact.state, fullContact.postalCode, fullContact.country]) {
      await expect(contact).toContainText(value);
    }
    await expect(page.getByRole('region', { name: 'Internal notes' })).toContainText(fullContact.notes);
  });

  test('edits contact fields and retains updates after navigation and reload', async ({ page }) => {
    await signIn(page);
    const businessId = await makeBusiness(page, 'Edit');
    const client = await createClient(page, businessId, 'Editable LEGO Client', fullContact);
    await page.goto(`${base(businessId)}/${client.id}/edit`);
    await fillContact(page, {
      email: 'updated@example.com', phone: '669-555-0123',
      city: 'Santa Clara', notes: 'Updated consignment instructions',
    });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/?$`), { timeout: 20_000 });
    await expect.poll(async () => (await rows(businessId))[0]?.email).toBe('updated@example.com');
    await page.goto(base(businessId));
    await page.goto(`${base(businessId)}/${client.id}`);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Contact information' })).toContainText('669-555-0123');
    await expect(page.getByRole('region', { name: 'Contact information' })).toContainText('Santa Clara');
    await expect(page.getByRole('region', { name: 'Internal notes' })).toContainText('Updated consignment instructions');
    const saved = (await rows(businessId))[0];
    expect(saved.name).toBe('Editable LEGO Client');
    expect(saved.addressLine1).toBe(fullContact.addressLine1);
    expect(saved.notes).toBe('Updated consignment instructions');
  });

  test('clearing optional fields removes previous values in the database and UI', async ({ page }) => {
    await signIn(page);
    const businessId = await makeBusiness(page, 'Clear');
    const client = await createClient(page, businessId, 'Clearable LEGO Client', fullContact);
    await page.goto(`${base(businessId)}/${client.id}/edit`);
    await fillContact(page, { email: '', phone: '', addressLine2: '', notes: '' });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/?$`), { timeout: 20_000 });
    await expect.poll(async () => (await rows(businessId))[0]?.email).toBeNull();
    const saved = (await rows(businessId))[0];
    for (const field of ['email', 'phone', 'addressLine2', 'notes'] as ContactField[]) {
      expect(saved[field], `${field} should be cleared`).toBeNull();
    }
    expect(saved.addressLine1).toBe(fullContact.addressLine1);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Contact information' })).toContainText('Not provided');
    await expect(page.getByRole('region', { name: 'Internal notes' })).toContainText('No notes added.');
    await expect(page.getByText(fullContact.email)).toHaveCount(0);
  });

  test('supports a name-only client without requiring contact information', async ({ page }) => {
    await signIn(page);
    const businessId = await makeBusiness(page, 'Optional');
    const client = await createClient(page, businessId, 'Name Only LEGO Client');
    for (const field of Object.keys(fullContact) as ContactField[]) {
      expect(client[field], `${field} should be optional`).toBeNull();
    }
    await page.goto(`${base(businessId)}/${client.id}`);
    await expect(page.getByRole('region', { name: 'Contact information' })).toContainText('Not provided');
    await expect(page.getByRole('region', { name: 'Internal notes' })).toContainText('No notes added.');
  });

  test('rejects invalid email addresses without creating or updating a client', async ({ page }) => {
    await signIn(page);
    const businessId = await makeBusiness(page, 'Validation');
    await page.goto(`${base(businessId)}/new`);
    await page.getByLabel('Client name').fill('Invalid Email LEGO Client');
    await page.getByLabel('Email', { exact: true }).fill('not-an-email');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    expect(await rows(businessId)).toHaveLength(0);

    const client = await createClient(page, businessId, 'Valid Email LEGO Client', { email: 'valid@example.com' });
    await page.goto(`${base(businessId)}/${client.id}/edit`);
    await page.getByLabel('Email', { exact: true }).fill('bad@');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    expect((await rows(businessId))[0].email).toBe('valid@example.com');
  });

  test('preserves contact information when archived and keeps archived details read-only', async ({ page }) => {
    await signIn(page);
    const businessId = await makeBusiness(page, 'Archive');
    const client = await createClient(page, businessId, 'Archived Contact LEGO Client', fullContact);
    await page.goto(`${base(businessId)}/${client.id}`);
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: 'Archive client' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/?$`), { timeout: 20_000 });
    await page.getByRole('link', { name: 'Archived clients' }).click();
    await page.getByRole('link', { name: 'Archived Contact LEGO Client' }).click();
    await expect(page.getByText('Archived client', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Contact information' })).toContainText(fullContact.email);
    await expect(page.getByRole('region', { name: 'Internal notes' })).toContainText(fullContact.notes);
    await expect(page.getByRole('link', { name: 'Edit client' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive client' })).toHaveCount(0);
    const saved = (await rows(businessId))[0];
    expect(saved.archivedAt).not.toBeNull();
    expect(saved.phone).toBe(fullContact.phone);
    expect(saved.addressLine1).toBe(fullContact.addressLine1);
  });
});
