'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { Prisma } from '@/app/generated/prisma/client';
import { requireBusinessPermission } from '@/lib/business-access';
import { createSaleSchema } from '@/lib/validations/sales';

type Result = { ok: true; id: string } | { ok: false; error: string };

export async function createSale(businessId: string, input: unknown): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const parsed = createSaleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid sale.' };
  const values = parsed.data;
  const soldAt = new Date(`${values.soldAt}T12:00:00.000Z`);
  if (Number.isNaN(soldAt.getTime()) || soldAt.toISOString().slice(0, 10) !== values.soldAt) {
    return { ok: false, error: 'Enter a valid sale date.' };
  }
  if (soldAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) return { ok: false, error: 'Sale date cannot be in the future.' };
  // Read the item and its commission policy in the same transaction as the sale.
  // The snapshot remains immutable if the business default or client override changes.
  const result = await prisma.$transaction(async tx => {
    const item = await tx.inventoryItem.findFirst({
      where: { id: values.inventoryItemId, businessId, archivedAt: null, status: { not: 'SOLD' }, quantity: { gt: 0 }, sales: { none: { cancelledAt: null } } },
      select: {
        id: true, name: true, quantity: true, status: true,
        client: { select: { id: true, name: true, commissionRateOverride: true } },
      },
    });
    if (!item) return null;

    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId }, select: { defaultCommissionRate: true },
    });
    const price = new Prisma.Decimal(values.salePrice);
    // Without a consignor, the business owns the full sale proceeds.
    const rate = item.client
      ? (item.client.commissionRateOverride ?? business.defaultCommissionRate)
      : new Prisma.Decimal(100);
    const commission = price.mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const proceeds = price.minus(commission);
    // Atomic conditional claim: concurrent submissions cannot both fulfill this listing.
    const claim = await tx.inventoryItem.updateMany({
      where: { id: item.id, businessId, archivedAt: null, status: { not: 'SOLD' }, quantity: { gt: 0 }, sales: { none: { cancelledAt: null } } },
      data: { quantity: 0, status: 'SOLD' },
    });
    if (claim.count !== 1) return null;
    return tx.sale.create({
      data: {
        businessId, inventoryItemId: item.id, itemName: item.name,
        inventoryQuantityBefore: item.quantity, inventoryStatusBefore: item.status,
        salePrice: price, soldAt, notes: values.notes || null,
        consignorId: item.client?.id ?? null,
        consignorName: item.client?.name ?? null,
        commissionRate: rate,
        commissionAmount: commission,
        consignorProceeds: proceeds,
      },
      select: { id: true },
    });
  });
  if (!result) return { ok: false, error: 'Choose an available inventory item from this business.' };
  const sale = result;
  revalidatePath(`/dashboard/businesses/${businessId}/sales`);
  revalidatePath(`/dashboard/businesses/${businessId}/sales/new`);
  revalidatePath(`/dashboard/businesses/${businessId}/inventory`);
  revalidatePath(`/dashboard/businesses/${businessId}/inventory/${values.inventoryItemId}`);
  return { ok: true, id: sale.id };
}

/** Cancel an active transaction without deleting its financial audit trail. */
export async function cancelSale(businessId: string, saleId: string): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const result = await prisma.$transaction(async tx => {
    const sale = await tx.sale.findFirst({ where: { id: saleId, businessId, cancelledAt: null, payout: null },
      select: { id: true, inventoryItemId: true, inventoryQuantityBefore: true, inventoryStatusBefore: true } });
    if (!sale) return null;
    // Only restore inventory for transactions fulfilled by this layer. Legacy
    // transactions have no inventory snapshot and cannot be safely reversed.
    if (sale.inventoryQuantityBefore === null || sale.inventoryStatusBefore === null) return 'legacy';
    const marked = await tx.sale.updateMany({ where: { id: saleId, businessId, cancelledAt: null, payout: null }, data: { cancelledAt: new Date() } });
    if (marked.count !== 1) return null;
    const restored = await tx.inventoryItem.updateMany({
      where: { id: sale.inventoryItemId, businessId, archivedAt: null, status: 'SOLD', quantity: 0 },
      data: { quantity: sale.inventoryQuantityBefore, status: sale.inventoryStatusBefore },
    });
    if (restored.count !== 1) throw new Error('Inventory changed; cannot safely restore the cancelled sale.');
    return sale.inventoryItemId;
  });
  if (!result) return { ok: false, error: 'Sale not found or already cancelled.' };
  if (result === 'legacy') return { ok: false, error: 'This earlier sale has no inventory snapshot and cannot be safely cancelled.' };
  revalidatePath(`/dashboard/businesses/${businessId}/sales`);
  revalidatePath(`/dashboard/businesses/${businessId}/sales/${saleId}`);
  revalidatePath(`/dashboard/businesses/${businessId}/sales/new`);
  revalidatePath(`/dashboard/businesses/${businessId}/inventory`);
  revalidatePath(`/dashboard/businesses/${businessId}/inventory/${result}`);
  return { ok: true, id: saleId };
}
