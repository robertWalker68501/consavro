'use server';

import { revalidatePath } from 'next/cache';
import { requireVerifiedUser } from '@/lib/business-access';
import prisma from '@/lib/prisma';

export async function setNotificationRead(formData: FormData) {
  const user = await requireVerifiedUser();
  const id = formData.get('id');
  const read = formData.get('read') === 'true';
  if (typeof id !== 'string' || !id || id.length > 200) return;
  await prisma.$executeRaw`
    UPDATE "notification" SET "readAt" = CASE WHEN ${read} THEN NOW() ELSE NULL END
    WHERE "id" = ${id} AND "userId" = ${user.id}
      AND ("businessId" IS NULL OR EXISTS (
        SELECT 1 FROM "business_member" m
        WHERE m."businessId" = "notification"."businessId" AND m."userId" = ${user.id}
      ))
  `;
  revalidatePath('/dashboard/notifications');
  revalidatePath('/dashboard');
}

export async function markAllNotificationsRead() {
  const user = await requireVerifiedUser();
  await prisma.$executeRaw`
    UPDATE "notification" SET "readAt" = NOW()
    WHERE "userId" = ${user.id} AND "readAt" IS NULL
      AND ("businessId" IS NULL OR EXISTS (
        SELECT 1 FROM "business_member" m
        WHERE m."businessId" = "notification"."businessId" AND m."userId" = ${user.id}
      ))
  `;
  revalidatePath('/dashboard/notifications');
  revalidatePath('/dashboard');
}
