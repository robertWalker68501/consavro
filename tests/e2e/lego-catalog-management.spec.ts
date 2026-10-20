import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { requireDevelopmentDatabase } from './helpers/database-safety';
import { email, password, resetTestAccount, signIn, waitForVerificationUrl, isTestEmailVerified } from './helpers/auth';

const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const route = '/dashboard/lego-catalog/manage';
const prefix = 'Consavro Catalog Management E2E';
const ids: string[] = [];

async function cleanup() {
  for (const id of ids.splice(0)) await pool.query('DELETE FROM "lego_set" WHERE id = $1', [id]);
  await pool.query('DELETE FROM "lego_set" WHERE name LIKE $1', [`${prefix}%`]);
}
async function fixture(overrides: { verificationStatus?: string; name?: string } = {}) {
  const id = randomUUID();
  const setNumber = `E2EM-${randomUUID().slice(0, 10).toUpperCase()}`;
  const name = overrides.name ?? `${prefix} Original`;
  await pool.query(`INSERT INTO "lego_set" (id,"setNumber",name,theme,"releaseYear","pieceCount",source,"verificationStatus","createdAt","updatedAt") VALUES ($1,$2,$3,'Space',2024,125,'MANUAL',$4,NOW(),NOW())`,
    [id, setNumber, name, overrides.verificationStatus ?? 'UNVERIFIED']);
  ids.push(id);
  return { id, setNumber, name };
}
async function row(id: string) {
  const result = await pool.query<{ setNumber: string; name: string; theme: string | null; releaseYear: number | null; pieceCount: number | null; imageUrl: string | null; verificationStatus: string; source: string }>(
    'SELECT "setNumber",name,theme,"releaseYear","pieceCount","imageUrl","verificationStatus",source FROM "lego_set" WHERE id = $1', [id]);
  return result.rows[0];
}
async function openEditor(page: Page, setNumber: string) {
  const entry = page.locator('div.flex.items-center.justify-between', { hasText: setNumber });
  await expect(entry).toBeVisible();
  await entry.getByRole('button', { name: 'Edit' }).click();
  return page.getByRole('form', { name: 'Edit LEGO catalog set' });
}

test.describe('LEGO catalog — Layer 4 management', () => {
  test.beforeAll(async ({ request }) => {
    // The management allowlist is intentionally explicit and separate from business roles.
    // Playwright's webServer must receive this value at startup.
    expect((process.env.CONSAVRO_CATALOG_ADMIN_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase())).toContain(email);
    await cleanup();
    await resetTestAccount();
    const response = await request.post('/api/auth/sign-up/email', { data: { name: 'Consavro E2E User', email, password } });
    expect(response.ok(), `Registration failed: ${response.status()} ${await response.text()}`).toBe(true);
    const verification = await request.get(await waitForVerificationUrl());
    expect(verification.status()).toBeLessThan(500);
    await expect.poll(isTestEmailVerified, { timeout: 20_000 }).toBe(true);
  });
  test.beforeEach(cleanup);
  test.afterAll(async () => { try { await cleanup(); await resetTestAccount(); } finally { await pool.end(); } });

  test('administrator sees dashboard link, management listing and breadcrumbs', async ({ page }) => {
    const set = await fixture();
    await signIn(page);
    await expect(page.getByRole('link', { name: /LEGO Catalog Management/i })).toBeVisible();
    await page.getByRole('link', { name: /LEGO Catalog Management/i }).click();
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.getByRole('heading', { name: /LEGO catalog management/i })).toBeVisible();
    await expect(page.getByText(`${set.setNumber} — ${set.name}`)).toBeVisible();
    await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible();
  });

  test('creates a missing set and rejects duplicate canonical set numbers', async ({ page }) => {
    const setNumber = `E2EM-${randomUUID().slice(0, 10).toUpperCase()}`;
    await signIn(page);
    await page.goto(route);
    await page.getByRole('button', { name: 'Add missing LEGO set' }).click();
    const form = page.getByRole('form', { name: 'Add LEGO catalog set' });
    await form.getByLabel('Set number').fill(setNumber.toLowerCase());
    await form.getByLabel('Name', { exact: true }).fill(`${prefix} New`);
    await form.getByLabel('Theme').fill('Technic');
    await form.getByLabel('Release year').fill('2023');
    await form.getByLabel('Piece count').fill('412');
    await form.getByLabel('Image URL').fill('https://example.com/catalog-image.jpg');
    await form.getByRole('button', { name: 'Save set' }).click();
    await expect(page.getByText(`${setNumber} — ${prefix} New`)).toBeVisible();
    const created = await pool.query<{ id: string }>('SELECT id FROM "lego_set" WHERE "setNumber" = $1', [setNumber]);
    expect(created.rows).toHaveLength(1);
    ids.push(created.rows[0].id);
    expect(await row(created.rows[0].id)).toMatchObject({ theme: 'Technic', releaseYear: 2023, pieceCount: 412, source: 'MANUAL' });
    await page.getByRole('button', { name: 'Add missing LEGO set' }).click();
    const duplicate = page.getByRole('form', { name: 'Add LEGO catalog set' });
    await duplicate.getByLabel('Set number').fill(setNumber);
    await duplicate.getByLabel('Name', { exact: true }).fill(`${prefix} Duplicate`);
    await duplicate.getByRole('button', { name: 'Save set' }).click();
    await expect(duplicate.getByRole('alert')).toContainText('already exists');
    const count = await pool.query<{ count: string }>('SELECT count(*) FROM "lego_set" WHERE "setNumber" = $1', [setNumber]);
    expect(Number(count.rows[0].count)).toBe(1);
  });

  test('edits metadata and persists verification status after refresh', async ({ page }) => {
    const set = await fixture();
    await signIn(page);
    await page.goto(route);
    const form = await openEditor(page, set.setNumber);
    await form.getByLabel('Name', { exact: true }).fill(`${prefix} Updated`);
    await form.getByLabel('Theme').fill('Castle');
    await form.getByLabel('Release year').fill('2022');
    await form.getByLabel('Piece count').fill('321');
    await form.getByLabel('Verification status').selectOption('VERIFIED');
    await form.getByRole('button', { name: 'Save set' }).click();
    await expect(page.getByText(`${set.setNumber} — ${prefix} Updated`)).toBeVisible();
    await page.reload();
    expect(await row(set.id)).toMatchObject({ name: `${prefix} Updated`, theme: 'Castle', releaseYear: 2022, pieceCount: 321, verificationStatus: 'VERIFIED' });
    const second = await openEditor(page, set.setNumber);
    await expect(second.getByLabel('Verification status')).toHaveValue('VERIFIED');
    await second.getByLabel('Verification status').selectOption('NEEDS_REVIEW');
    await second.getByRole('button', { name: 'Save set' }).click();
    await expect(page.getByText('NEEDS_REVIEW').first()).toBeVisible();
    await page.reload();
    expect((await row(set.id)).verificationStatus).toBe('NEEDS_REVIEW');
  });

  test('rejects malformed metadata without changing an existing record', async ({ page }) => {
    const set = await fixture();
    await signIn(page);
    await page.goto(route);
    const form = await openEditor(page, set.setNumber);
    await form.getByLabel('Piece count').fill('-1');
    await form.getByRole('button', { name: 'Save set' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    expect((await row(set.id)).pieceCount).toBe(125);
  });

  test('catalog edits never overwrite inventory-specific snapshots', async ({ page }) => {
    const set = await fixture();
    // Catalog mutation must not write into inventory_item; a separate integration layer
    // already exercises the linked inventory workflow end-to-end.
    await signIn(page);
    await page.goto(route);
    const form = await openEditor(page, set.setNumber);
    await form.getByLabel('Name', { exact: true }).fill(`${prefix} Corrected`);
    await form.getByRole('button', { name: 'Save set' }).click();
    await expect(page.getByText(`${set.setNumber} — ${prefix} Corrected`)).toBeVisible();
    expect((await row(set.id)).name).toBe(`${prefix} Corrected`);
  });
});
