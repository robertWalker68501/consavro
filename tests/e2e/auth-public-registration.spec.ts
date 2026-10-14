import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

const email = 'consavro-e2e-public@example.com';
const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function clean() {
  await db.query('DELETE FROM "user" WHERE email = $1', [email]);
}

test('public registration switch permits a non-allowlisted email', async ({ request }) => {
  await clean();
  try {
    const response = await request.post('/api/auth/sign-up/email', {
      data: { name: 'Public Registration User', email, password: 'Consavro-E2E-Strong-Password-2026!' },
    });
    expect(response.ok(), `Public registration returned ${response.status()}: ${await response.text()}`).toBe(true);
    await expect.poll(async () => {
      const result = await db.query('SELECT id FROM "user" WHERE email = $1', [email]);
      return result.rowCount;
    }).toBe(1);
  } finally {
    await clean();
  }
});
