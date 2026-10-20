import 'server-only';

import prisma from '@/lib/prisma';
import { normalizeLegoSetNumber } from './schema';

export const legoSetSearchSelect = {
  id: true, setNumber: true, name: true, theme: true, releaseYear: true,
  pieceCount: true, imageUrl: true, source: true, verificationStatus: true,
} as const;

export async function searchLegoSets(rawQuery: string, limit = 15) {
  const query = rawQuery.trim().slice(0, 100);
  if (query.length < 2) return [];
  const normalized = normalizeLegoSetNumber(query);
  const take = Math.min(Math.max(Math.trunc(limit) || 15, 1), 25);
  return prisma.legoSet.findMany({
    where: {
      OR: [
        { setNumber: { contains: normalized, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: legoSetSearchSelect,
    orderBy: [{ setNumber: 'asc' }],
    take,
  });
}
