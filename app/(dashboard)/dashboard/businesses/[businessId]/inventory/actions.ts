'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { inventoryItemSchema, type ParsedInventoryItemValues } from '@/lib/validations/inventory';

type Result = { ok: true; id?: string } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const path = (businessId: string) => `/dashboard/businesses/${businessId}/inventory`;

function itemData(values: ParsedInventoryItemValues) {
  return {
    name: values.name,
    sku: values.sku || null,
    quantity: values.quantity,
    status: values.status,
    description: values.description || null,
    setNumber: values.setNumber || null,
    theme: values.theme || null,
    condition: values.condition || null,
    completeness: values.completeness || null,
    askingPrice: values.askingPrice || null,
    estimatedValue: values.estimatedValue || null,
    clientId: values.clientId || null,
  };
}

async function validConsignor(businessId: string, clientId: string): Promise<boolean> {
  if (!clientId) return true;
  return !!(await prisma.client.findFirst({
    where: { id: clientId, businessId, archivedAt: null },
    select: { id: true },
  }));
}

export async function createInventoryItem(businessId: string, input: unknown): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid inventory item.');
  if (!await validConsignor(businessId, parsed.data.clientId)) return fail('Choose an active client from this business.');
  const item = await prisma.inventoryItem.create({ data: { businessId, ...itemData(parsed.data) } });
  revalidatePath(path(businessId));
  return { ok: true, id: item.id };
}

export async function updateInventoryItem(businessId: string, itemId: string, input: unknown): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid inventory item.');
  if (!await validConsignor(businessId, parsed.data.clientId)) return fail('Choose an active client from this business.');
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
