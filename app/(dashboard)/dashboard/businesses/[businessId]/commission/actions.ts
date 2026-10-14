'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { businessCommissionSchema } from '@/lib/validations/commission';

export async function updateBusinessCommission(businessId: string, input: unknown) {
  await requireBusinessPermission(businessId, 'business:settings');
  const parsed = businessCommissionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid commission rate.' };
  await prisma.business.update({
    where: { id: businessId },
    data: { defaultCommissionRate: parsed.data.defaultCommissionRate },
  });
  revalidatePath(`/dashboard/businesses/${businessId}`);
  revalidatePath(`/dashboard/businesses/${businessId}/commission`);
  revalidatePath(`/dashboard/businesses/${businessId}/clients`, 'layout');
  return { ok: true as const };
}
