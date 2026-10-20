import { z } from 'zod';

// A provider-neutral, bounded representation for future import and correction flows.
// This schema does not authorize writing to the shared catalog.
export const legoSetRecordSchema = z.object({
  setNumber: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9-]+$/, 'Invalid LEGO set number'),
  name: z.string().trim().min(1).max(200),
  theme: z.string().trim().max(120).nullable().optional(),
  releaseYear: z.number().int().min(1932).max(2200).nullable().optional(),
  pieceCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  imageUrl: z.url().max(2048).nullable().optional(),
  sourceUrl: z.url().max(2048).nullable().optional(),
  source: z.enum(['MANUAL', 'REBRICKABLE']),
  externalId: z.string().trim().min(1).max(100).nullable().optional(),
});

export type LegoSetRecord = z.infer<typeof legoSetRecordSchema>;

/** Preserve the variant suffix (e.g. 75192-1) to avoid collisions. */
export function normalizeLegoSetNumber(value: string): string {
  return value.trim().toUpperCase();
}
