import 'server-only';
import type { Prisma } from '@/app/generated/prisma/client';

/**
 * Enqueue business events in the SAME transaction as the operation.
 * OWNER/MANAGER recipients can review operational activity; STAFF cannot.
 * The actor is excluded to avoid notifying users about their own changes.
 * Membership is queried at write time and rechecked when notifications are read.
 */
export async function notifyBusinessManagers(
  tx: Prisma.TransactionClient,
  businessId: string,
  actorId: string,
  event: { title: string; message: string; href: string },
) {
  // Record the event for the business regardless of who has opted out of alerts.
  // This happens in the same transaction as the successful business operation.
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { name: true },
  });
  const actorName = actor?.name?.trim() || 'A team member';
  const category = event.title.startsWith('Inventory ') ? 'inventory'
    : event.title.startsWith('Sale ') ? 'sales'
    : event.title.startsWith('Payout ') ? 'payouts'
    : 'other';
  await tx.businessActivityEvent.create({
    data: {
      businessId,
      actorId,
      actorName,
      category,
      title: event.title,
      message: event.message,
      href: event.href,
    },
  });

  const recipients = await tx.businessMember.findMany({
    where: { businessId, userId: { not: actorId }, role: { in: ['OWNER', 'MANAGER'] } },
    select: { userId: true },
  });
  if (!recipients.length) return;
  const preferences = await tx.notificationPreference.findMany({
    where: { userId: { in: recipients.map(recipient => recipient.userId) } },
    select: { userId: true, inventory: true, sales: true, payouts: true },
  });
  const preferenceByUser = new Map(preferences.map(preference => [preference.userId, preference]));
  const eligible = recipients.filter(recipient => {
    const preference = preferenceByUser.get(recipient.userId);
    return category === 'other' || !preference || preference[category];
  });
  if (!eligible.length) return;
  await tx.notification.createMany({
    data: eligible.map(({ userId }) => ({
      userId,
      businessId,
      title: event.title,
      message: `${actorName}: ${event.message}`,
      href: event.href,
    })),
  });
}
