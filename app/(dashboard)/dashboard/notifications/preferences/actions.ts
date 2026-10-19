'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireVerifiedUser } from '@/lib/business-access';
import prisma from '@/lib/prisma';

export async function saveNotificationPreferences(formData: FormData) {
  const user = await requireVerifiedUser();
  const data = {
    inventory: formData.get('inventory') === 'on',
    sales: formData.get('sales') === 'on',
    payouts: formData.get('payouts') === 'on',
  };
  await prisma.notificationPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
  revalidatePath('/dashboard/notifications/preferences');
  revalidatePath('/dashboard/notifications');
  redirect('/dashboard/notifications/preferences?saved=1');
}
