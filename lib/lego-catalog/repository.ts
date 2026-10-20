import 'server-only';

import prisma from '@/lib/prisma';
import { legoSetRecordSchema, normalizeLegoSetNumber, type LegoSetRecord } from './schema';

/** Shared catalog reads; never returns tenant-owned inventory or financial data. */
export async function findLegoSetByNumber(setNumber: string) {
  const normalized = normalizeLegoSetNumber(setNumber);
  if (!normalized || normalized.length > 40 || !/^[A-Z0-9-]+$/.test(normalized)) return null;
  return prisma.legoSet.findUnique({ where: { setNumber: normalized } });
}

/** Internal import primitive, not a Server Action or public API. Caller must be trusted. */
export async function upsertLegoSetFromProvider(input: LegoSetRecord) {
  const parsed = legoSetRecordSchema.parse(input);
  if (parsed.source !== 'REBRICKABLE') {
    throw new Error('Provider imports must identify Rebrickable as the source.');
  }
  const setNumber = normalizeLegoSetNumber(parsed.setNumber);
  const data = {
    name: parsed.name,
    theme: parsed.theme ?? null,
    releaseYear: parsed.releaseYear ?? null,
    pieceCount: parsed.pieceCount ?? null,
    imageUrl: parsed.imageUrl ?? null,
    sourceUrl: parsed.sourceUrl ?? null,
    source: parsed.source,
    externalId: parsed.externalId ?? null,
    verificationStatus: 'VERIFIED' as const,
    lastSyncedAt: new Date(),
  };
  // Never overwrite a manually curated record with remote data.
  return prisma.$transaction(async tx => {
    const existing = await tx.legoSet.findUnique({ where: { setNumber } });
    if (existing && existing.source !== 'REBRICKABLE') return existing;
    if (existing) {
      return tx.legoSet.update({ where: { id: existing.id }, data });
    }
    return tx.legoSet.create({ data: { setNumber, ...data } });
  });
}
