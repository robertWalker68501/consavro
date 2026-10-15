'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@/app/generated/prisma/client';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { recordPayoutSchema } from '@/lib/validations/payouts';

type Result = { ok: true; id: string } | { ok: false; error: string };

const INELIGIBLE = 'This sale is not eligible for payout, has already been paid, or the payment date is before the sale date.';

export async function recordPayout(businessId: string, saleId: string, input: unknown): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const parsed = recordPayoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid payout.' };
  const values = parsed.data;

  // Date-only values represent calendar dates, not timestamps. Validate using UTC
  // components to avoid local-time/DST shifts or accepting tomorrow in some zones.
  const paidAt = new Date(`${values.paidAt}T12:00:00.000Z`);
  const today = new Date().toISOString().slice(0, 10);
  if (Number.isNaN(paidAt.getTime()) || paidAt.toISOString().slice(0, 10) !== values.paidAt || values.paidAt > today) {
    return { ok: false, error: 'Enter a valid payment date that is not in the future.' };
  }

  try {
    const payout = await prisma.$transaction(async tx => {
      const sale = await tx.sale.findFirst({
        where: {
          id: saleId,
          businessId,
          cancelledAt: null,
          payout: null,
          consignorId: { not: null },
          consignorProceeds: { gt: 0 },
        },
        select: { id: true, consignorId: true, consignorProceeds: true, soldAt: true },
      });
      if (!sale?.consignorId) return null;
      // Compare dates as calendar days; sale time-of-day must not prevent
      // a payout dated on the same day as the sale.
      if (values.paidAt < sale.soldAt.toISOString().slice(0, 10)) return null;

      // Never accept a client-supplied amount or consignor. The payout is an
      // immutable copy of the original sale's financial snapshot.
      return tx.payout.create({
        data: {
          businessId,
          saleId: sale.id,
          clientId: sale.consignorId,
          amount: sale.consignorProceeds,
          paidAt,
          method: values.method,
          reference: values.reference || null,
          notes: values.notes || null,
        },
        select: { id: true },
      });
    });
    if (!payout) return { ok: false, error: INELIGIBLE };
    revalidatePath(`/dashboard/businesses/${businessId}/payouts`);
    revalidatePath(`/dashboard/businesses/${businessId}/sales/${saleId}`);
    return { ok: true, id: payout.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // The unique saleId constraint is the final safeguard against two
      // concurrent requests paying the same sale twice.
      if (error.code === 'P2002') return { ok: false, error: 'A payout has already been recorded for this sale.' };
      if (error.code === 'P2034') return { ok: false, error: 'This payout conflicted with another update. Please refresh and try again.' };
      if (error.code === 'P2003') return { ok: false, error: 'This sale or consignor is no longer eligible for payout.' };
    }
    throw error;
  }
}
