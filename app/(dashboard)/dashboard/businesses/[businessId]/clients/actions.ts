'use server';

import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { clientSchema, clientContactFields, type ClientValues } from '@/lib/validations/client';

type Result = { ok: true; id?: string } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const path = (businessId: string) => `/dashboard/businesses/${businessId}/clients`;

function clientData(values: ClientValues) {
  const contact = Object.fromEntries(
    clientContactFields.map(field => [field, values[field] || null]),
  ) as Record<(typeof clientContactFields)[number], string | null>;
  return { name: values.name, ...contact, commissionRateOverride: values.commissionRateOverride === '' ? null : values.commissionRateOverride }; 
}

export async function createClient(businessId: string, input: unknown): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid client.');
  const client = await prisma.client.create({ data: { businessId, ...clientData(parsed.data) } });
  revalidatePath(path(businessId));
  return { ok: true, id: client.id };
}

export async function updateClient(businessId: string, clientId: string, input: unknown): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid client.');
  const result = await prisma.client.updateMany({
    where: { id: clientId, businessId, archivedAt: null },
    data: clientData(parsed.data),
  });
  if (!result.count) return fail('Active client not found.');
  revalidatePath(path(businessId));
  revalidatePath(`${path(businessId)}/${clientId}`);
  return { ok: true };
}

export async function archiveClient(businessId: string, clientId: string): Promise<Result> {
  await requireBusinessPermission(businessId, 'operations:write');
  const result = await prisma.client.updateMany({
    where: { id: clientId, businessId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (!result.count) return fail('Active client not found.');
  revalidatePath(path(businessId));
  revalidatePath(`${path(businessId)}/${clientId}`);
  return { ok: true };
}
