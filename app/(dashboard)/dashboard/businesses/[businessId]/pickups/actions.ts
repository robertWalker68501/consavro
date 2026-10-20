"use server";

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { pickupSchema } from '@/lib/validations/seller-pickup';

const root = (id: string) => `/dashboard/businesses/${id}/pickups`;
type Result = { ok: true; id: string } | { ok: false; error: string };

export async function savePickup(businessId: string, pickupId: string | null, input: unknown): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const parsed = pickupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid pickup.' };
  const v = parsed.data;
  const client = await prisma.client.findFirst({ where: { id: v.clientId, businessId, archivedAt: null }, select: { id: true } });
  if (!client) return { ok: false, error: 'Active seller not found in this business.' };
  const data = { clientId: v.clientId, scheduledAt: new Date(`${v.date}T12:00:00.000Z`), location: v.location || null, notes: v.notes || null };
  if (pickupId) {
    const result = await prisma.sellerPickup.updateMany({ where: { id: pickupId, businessId, status: { not: 'COMPLETED' } }, data });
    if (!result.count) return { ok: false, error: 'Editable pickup not found.' };
    revalidatePath(root(businessId)); revalidatePath(`${root(businessId)}/${pickupId}`);
    return { ok: true, id: pickupId };
  }
  const pickup = await prisma.sellerPickup.create({ data: { businessId, ...data } });
  revalidatePath(root(businessId));
  return { ok: true, id: pickup.id };
}

export async function advancePickup(businessId: string, pickupId: string, status: string): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const transitions: Record<string, string> = { SCHEDULED: 'PICKED_UP', PICKED_UP: 'PROCESSING', PROCESSING: 'COMPLETED' };
  const from = Object.keys(transitions).find(key => transitions[key] === status);
  if (!from) return { ok: false, error: 'Invalid pickup transition.' };
  const result = await prisma.sellerPickup.updateMany({
    where: { id: pickupId, businessId, status: from as 'SCHEDULED' | 'PICKED_UP' | 'PROCESSING' },
    data: { status: status as 'PICKED_UP' | 'PROCESSING' | 'COMPLETED', ...(status === 'PICKED_UP' ? { pickedUpAt: new Date() } : {}) },
  });
  if (!result.count) return { ok: false, error: 'Pickup status changed or pickup not found.' };
  revalidatePath(root(businessId)); revalidatePath(`${root(businessId)}/${pickupId}`);
  return { ok: true, id: pickupId };
}
