/** Prevent destructive E2E fixtures from reaching the Consavro production database. */
const DEV_ENDPOINT = 'ep-weathered-sky-ar1cr47r';

export function requireDevelopmentDatabase(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('E2E SAFETY ERROR: DATABASE_URL is missing. Tests will not run.');
  }

  let hostname: string;
  try {
    const url = new URL(connectionString);
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
      throw new Error('Unsupported database URL protocol');
    }
    hostname = url.hostname.toLowerCase();
  } catch {
    throw new Error('E2E SAFETY ERROR: DATABASE_URL is not a valid PostgreSQL URL. Tests will not run.');
  }

  // Accept direct, pooled, and Neon compute-specific endpoints for the same dev branch.
  const endpoint = hostname.split('.')[0];
  if (!new RegExp(`^${DEV_ENDPOINT}(?:-[a-z0-9]+)*(?:-pooler)?$`).test(endpoint) ||
      !hostname.endsWith('.aws.neon.tech')) {
    throw new Error(
      'E2E SAFETY ERROR: DATABASE_URL does not point to Consavro Neon dev. ' +
      `Received host: ${hostname}. Tests will not run to protect production data.`,
    );
  }
  return connectionString;
}
