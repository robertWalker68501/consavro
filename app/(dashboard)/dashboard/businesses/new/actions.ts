'use server';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { createBusinessSchema } from '@/lib/validations/business';

export type CreateBusinessResult = { ok: true; businessId: string } | { ok: false; error: string };

export async function createBusiness(input: unknown): Promise<CreateBusinessResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !session.user.emailVerified) return { ok: false, error: 'You must sign in with a verified account.' };
  const parsed = createBusinessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid business name.' };

  // Atomic creation: the creator becomes OWNER, with no intermediate unowned business.
  const business = await prisma.business.create({
    data: {
      name: parsed.data.name,
      members: { create: { userId: session.user.id, role: 'OWNER' } },
    },
    select: { id: true },
  });
  return { ok: true, businessId: business.id };
}
