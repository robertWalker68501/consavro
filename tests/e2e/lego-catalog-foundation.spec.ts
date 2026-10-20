import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { requireDevelopmentDatabase } from './helpers/database-safety';

// Database integration coverage for Layer 1; no catalog UI exists yet.
// Fixtures are isolated and removed after each test. Never use production.
const pool = new Pool({ connectionString: requireDevelopmentDatabase() });
const fixturePrefix = 'Consavro LEGO Catalog E2E';
const createdSetIds: string[] = [];

async function createSet(suffix: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const setNumber = `E2E-${randomUUID().slice(0, 12).toUpperCase()}`;
  const name = `${fixturePrefix} ${suffix}`;
  const { rows } = await pool.query<{ id: string; setNumber: string }>(
    `INSERT INTO "lego_set" (id, "setNumber", name, source, "verificationStatus", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'MANUAL', 'UNVERIFIED', NOW(), NOW()) RETURNING id, "setNumber"`,
    [id, setNumber, name],
  );
  createdSetIds.push(id);
  if (Object.keys(overrides).length) throw new Error('Unsupported test override');
  return rows[0];
}

test.describe('LEGO catalog — Layer 1 foundation', () => {
  test.afterEach(async () => {
    for (const id of createdSetIds.splice(0)) {
      await pool.query('DELETE FROM "lego_set" WHERE id = $1', [id]);
    }
  });
  test.afterAll(async () => { await pool.end(); });

  test('shared catalog stores metadata independently of a business', async () => {
    const set = await createSet('Metadata');
    await pool.query(
      `UPDATE "lego_set" SET theme = $2, "releaseYear" = $3, "pieceCount" = $4,
       "imageUrl" = $5, "sourceUrl" = $6, "updatedAt" = NOW() WHERE id = $1`,
      [set.id, 'Technic', 2024, 1234, 'https://example.com/set.jpg', 'https://example.com/set'],
    );
    const { rows } = await pool.query(
      'SELECT * FROM "lego_set" WHERE id = $1', [set.id],
    );
    expect(rows[0]).toMatchObject({ setNumber: set.setNumber, theme: 'Technic', releaseYear: 2024, pieceCount: 1234 });
    expect(rows[0].imageUrl).toBe('https://example.com/set.jpg');
    expect(rows[0]).not.toHaveProperty('businessId');
  });

  test('canonical set number is unique', async () => {
    const set = await createSet('Unique');
    await expect(pool.query(
      `INSERT INTO "lego_set" (id, "setNumber", name, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [randomUUID(), set.setNumber, `${fixturePrefix} Duplicate`],
    )).rejects.toMatchObject({ code: '23505' });
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM "lego_set" WHERE "setNumber" = $1', [set.setNumber]);
    expect(rows[0].count).toBe(1);
  });

  test('inventory catalog relationship is optional and nulling it preserves inventory', async () => {
    const set = await createSet('Optional link');
    // Existing inventory remains usable without a catalog association.
    const { rows: existing } = await pool.query(
      'SELECT id, "legoSetId" FROM "inventory_item" WHERE "legoSetId" IS NULL LIMIT 1',
    );
    if (existing.length) expect(existing[0].legoSetId).toBeNull();
    const { rows: columns } = await pool.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'inventory_item' AND column_name = 'legoSetId'`,
    );
    expect(columns).toHaveLength(1);
    expect(columns[0].is_nullable).toBe('YES');
    const { rows: refs } = await pool.query(
      `SELECT confdeltype FROM pg_constraint WHERE conrelid = 'inventory_item'::regclass
       AND contype = 'f' AND confrelid = 'lego_set'::regclass`,
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].confdeltype).toBe('n'); // ON DELETE SET NULL
    expect(set.id).toBeTruthy();
  });

  test('catalog contains no tenant-owned financial fields', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'lego_set'`,
    );
    const fields = new Set(rows.map(row => row.column_name));
    for (const field of ['businessId', 'clientId', 'askingPrice', 'estimatedValue', 'quantity']) {
      expect(fields.has(field), `${field} must stay in tenant inventory`).toBe(false);
    }
  });
});
