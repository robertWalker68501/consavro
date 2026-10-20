'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { requireCatalogAdministrator } from '@/lib/lego-catalog/admin';
import { normalizeLegoSetNumber } from '@/lib/lego-catalog/schema';

const formSchema = z.object({
  id: z.string().trim().optional(),
  setNumber: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9-]+$/),
  name: z.string().trim().min(1).max(200),
  theme: z.string().trim().max(120),
  releaseYear: z.union([z.literal(''), z.coerce.number().int().min(1932).max(2200)]),
  pieceCount: z.union([z.literal(''), z.coerce.number().int().min(0).max(1000000)]),
  imageUrl: z.union([z.literal(''), z.url().max(2048)]),
  verificationStatus: z.enum(['UNVERIFIED', 'VERIFIED', 'NEEDS_REVIEW']),
});
export type CatalogSaveResult = { error?: string; success?: string };

export async function saveCatalogSet(_previous: CatalogSaveResult, formData: FormData): Promise<CatalogSaveResult> {
  await requireCatalogAdministrator();
  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid catalog data.' };
  const { id, setNumber: rawNumber, name, theme, releaseYear, pieceCount, imageUrl, verificationStatus } = parsed.data;
  const setNumber = normalizeLegoSetNumber(rawNumber);
  const data = { setNumber, name, theme: theme || null, releaseYear: releaseYear === '' ? null : releaseYear,
    pieceCount: pieceCount === '' ? null : pieceCount, imageUrl: imageUrl || null, verificationStatus };
  try {
    if (id) {
      const existing = await prisma.legoSet.findUnique({ where: { id } });
      if (!existing) return { error: 'Catalog set not found.' };
      // Preserve external provenance fields. Corrections never mutate inventory snapshots.
      await prisma.legoSet.update({ where: { id }, data });
    } else {
      await prisma.legoSet.create({ data: { ...data, source: 'MANUAL' } });
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')
      return { error: 'That LEGO set number already exists in the catalog.' };
    return { error: 'Unable to save catalog set.' };
  }
  revalidatePath('/dashboard/lego-catalog/manage');
  return { success: id ? 'Catalog set updated.' : 'Catalog set created.' };
}
