'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { notifyBusinessManagers } from '@/lib/business-event-notifications';
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
    legoSetId: values.legoSetId || null,
  };
}

async function validLegoSet(legoSetId: string): Promise<boolean> {
  if (!legoSetId) return true;
  return !!(await prisma.legoSet.findUnique({ where: { id: legoSetId }, select: { id: true } }));
}

async function validConsignor(businessId: string, clientId: string): Promise<boolean> {
  if (!clientId) return true;
  return !!(await prisma.client.findFirst({
    where: { id: clientId, businessId, archivedAt: null },
    select: { id: true },
  }));
}

export async function createInventoryItem(businessId: string, input: unknown): Promise<Result> {
  const { user } = await requireBusinessPermission(businessId, 'operations:write');
  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid inventory item.');
  if (!await validConsignor(businessId, parsed.data.clientId)) return fail('Choose an active client from this business.');
  if (!await validLegoSet(parsed.data.legoSetId)) return fail('Selected LEGO catalog set no longer exists.');
  const item = await prisma.$transaction(async tx => {
    const created = await tx.inventoryItem.create({ data: { businessId, ...itemData(parsed.data) } });
    await notifyBusinessManagers(tx, businessId, user.id, {
      title: 'Inventory item added',
      message: `An inventory item was added: ${created.name}.`,
      href: `/dashboard/businesses/${businessId}/inventory/${created.id}`,
    });
    return created;
  });
  revalidatePath(path(businessId));
  return { ok: true, id: item.id };
}

export async function updateInventoryItem(businessId: string, itemId: string, input: unknown): Promise<Result> {
  const { user } = await requireBusinessPermission(businessId, 'operations:write');
  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid inventory item.');
  if (!await validConsignor(businessId, parsed.data.clientId)) return fail('Choose an active client from this business.');
  if (!await validLegoSet(parsed.data.legoSetId)) return fail('Selected LEGO catalog set no longer exists.');
  const result = await prisma.$transaction(async tx => {
    const updated = await tx.inventoryItem.updateMany({
      where: { id: itemId, businessId, archivedAt: null, sales: { none: { cancelledAt: null } } },
      data: itemData(parsed.data),
    });
    if (updated.count) await notifyBusinessManagers(tx, businessId, user.id, {
      title: 'Inventory item updated',
      message: `An inventory item was updated: ${parsed.data.name}.`,
      href: `/dashboard/businesses/${businessId}/inventory/${itemId}`,
    });
    return updated;
  });
  if (!result.count) return fail('Active inventory item not found.');
  revalidatePath(path(businessId));
  revalidatePath(`${path(businessId)}/${itemId}`);
  return { ok: true };
}

export async function archiveInventoryItem(businessId: string, itemId: string): Promise<Result> {
  const { user } = await requireBusinessPermission(businessId, 'operations:write');
  const result = await prisma.$transaction(async tx => {
    const item = await tx.inventoryItem.findFirst({
      where: { id: itemId, businessId, archivedAt: null },
      select: { name: true },
    });
    const archived = await tx.inventoryItem.updateMany({
      where: { id: itemId, businessId, archivedAt: null, sales: { none: { cancelledAt: null } } },
      data: { archivedAt: new Date() },
    });
    if (archived.count) await notifyBusinessManagers(tx, businessId, user.id, {
      title: 'Inventory item archived',
      message: `An inventory item was archived: ${item?.name ?? 'Inventory item'}.`,
      href: `/dashboard/businesses/${businessId}/inventory`,
    });
    return archived;
  });
  if (!result.count) return fail('Inventory item not found or has an active sale. Cancel the sale before archiving.');
  revalidatePath(path(businessId));
  revalidatePath(`${path(businessId)}/${itemId}`);
  return { ok: true };
}
