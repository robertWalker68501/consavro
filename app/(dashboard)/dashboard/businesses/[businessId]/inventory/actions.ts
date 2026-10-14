'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { inventoryItemSchema, type InventoryItemValues } from '@/lib/validations/inventory';

type Result = { ok: true; id?: string } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const path = (businessId: string) => `/dashboard/businesses/${businessId}/inventory`;

function itemData(values: InventoryItemValues) {
  return {
    name: values.name,
    sku: values.sku || null,
    quantity: values.quantity,
    description: values.description || null,
  };
}

export async function createInventoryItem(businessId: string, input: unknown): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid inventory item.');
  const item = await prisma.inventoryItem.create({ data: { businessId, ...itemData(parsed.data) } });
  revalidatePath(path(businessId));
  return { ok: true, id: item.id };
}

export async function updateInventoryItem(businessId: string, itemId: string, input: unknown): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid inventory item.');
  const result = await prisma.inventoryItem.updateMany({
    where: { id: itemId, businessId, archivedAt: null },
    data: itemData(parsed.data),
  });
  if (!result.count) return fail('Active inventory item not found.');
  revalidatePath(path(businessId));
  revalidatePath(`${path(businessId)}/${itemId}`);
  return { ok: true };
}

export async function archiveInventoryItem(businessId: string, itemId: string): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const result = await prisma.inventoryItem.updateMany({
    where: { id: itemId, businessId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (!result.count) return fail('Active inventory item not found.');
  revalidatePath(path(businessId));
  revalidatePath(`${path(businessId)}/${itemId}`);
  return { ok: true };
}
