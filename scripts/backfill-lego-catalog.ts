/**
 * One-time, repeatable inventory -> shared LEGO catalog backfill.
 *
 * Run with: npx tsx scripts/backfill-lego-catalog.ts --dry-run
 *           npx tsx scripts/backfill-lego-catalog.ts --apply --confirm-dev-branch
 *
 * Only reads inventory and inserts missing catalog records. It never links or
 * changes inventory rows, and never overwrites existing catalog entries.
 */
import { config } from 'dotenv';
// Match the local Next.js environment precedence for the database URL.
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
import { PrismaClient } from '../app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Specify exactly one of --dry-run or --apply.');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required.');
const parsedUrl = new URL(url);
const host = parsedUrl.hostname.toLowerCase();
if (!host.endsWith('.neon.tech')) {
  throw new Error('Safety stop: DATABASE_URL must point to a Neon endpoint.');
}
// Neon hostnames identify endpoints, not necessarily human-readable branch names.
// For writes, require an explicit operator acknowledgement after verifying the
// endpoint belongs to the Neon dev branch in the Neon console.
if (apply && !process.argv.includes('--confirm-dev-branch')) {
  throw new Error('Safety stop: Verify DATABASE_URL endpoint is the Neon dev branch in the Neon console, then pass --confirm-dev-branch with --apply.');
}
console.log(`Neon endpoint: ${host} | mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const canonical = (s: string) => s.trim().toUpperCase();
const valid = (s: string) => /^[A-Z0-9-]{1,40}$/.test(s);

type Candidate = { setNumber: string; name: string; theme: string | null; count: number; names: Set<string>; themes: Set<string> };

async function main() {
  const candidates = new Map<string, Candidate>();
  let cursor: string | undefined;
  let scanned = 0;
  let invalid = 0;
  do {
    const batch = await prisma.inventoryItem.findMany({
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, setNumber: true, name: true, theme: true },
    });
    if (!batch.length) break;
    cursor = batch[batch.length - 1].id;
    for (const item of batch) {
      scanned++;
      const number = canonical(item.setNumber ?? '');
      const name = item.name.trim();
      if (!valid(number) || !name || name.length > 200) {
        invalid++;
        continue;
      }
      const theme = item.theme?.trim().slice(0, 120) || null;
      const existing = candidates.get(number);
      if (existing) {
        existing.count++;
        existing.names.add(name.toLowerCase());
        if (theme) existing.themes.add(theme.toLowerCase());
      } else {
        candidates.set(number, { setNumber: number, name, theme, count: 1, names: new Set([name.toLowerCase()]), themes: new Set(theme ? [theme.toLowerCase()] : []) });
      }
    }
    if (batch.length < 500) break;
  } while (true);

  let alreadyPresent = 0;
  let created = 0;
  let conflicting = 0;
  let skippedConcurrent = 0;
  const warnings: string[] = [];
  for (const candidate of candidates.values()) {
    const exists = await prisma.legoSet.findUnique({ where: { setNumber: candidate.setNumber }, select: { id: true } });
    if (exists) { alreadyPresent++; continue; }
    const conflict = candidate.names.size > 1 || candidate.themes.size > 1;
    if (conflict) {
      conflicting++;
      warnings.push(`${candidate.setNumber}: ${candidate.names.size} distinct names, ${candidate.themes.size} distinct themes`);
    }
    if (!apply) { created++; continue; }
    // createMany skipDuplicates is race-safe; do not update pre-existing records.
    const result = await prisma.legoSet.createMany({
      data: [{ setNumber: candidate.setNumber, name: candidate.name, theme: conflict ? null : candidate.theme, source: 'MANUAL', verificationStatus: conflict ? 'NEEDS_REVIEW' : 'UNVERIFIED' }],
      skipDuplicates: true,
    });
    created += result.count;
    skippedConcurrent += 1 - result.count;
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scannedInventoryRows: scanned, invalidOrMissingSetNumbers: invalid, distinctValidSetNumbers: candidates.size, alreadyPresent, wouldCreateOrCreated: created, conflictingSetNumbers: conflicting, skippedConcurrent, warnings: warnings.slice(0, 30) }, null, 2));
  if (warnings.length > 30) console.log(`...and ${warnings.length - 30} more conflicts`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
