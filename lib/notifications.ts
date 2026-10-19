import 'server-only';
import prisma from '@/lib/prisma';

export type NotificationRecord = {
  id: string;
  title: string;
  message: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
};

// All reads are scoped to the authenticated recipient, never to a supplied user ID.
export async function listNotifications(userId: string, unreadOnly = false) {
  return prisma.$queryRaw<NotificationRecord[]>`
    SELECT n."id", n."title", n."message", n."href", n."readAt", n."createdAt"
    FROM "notification" n
    WHERE n."userId" = ${userId}
      AND (${unreadOnly} = false OR n."readAt" IS NULL)
      AND (n."businessId" IS NULL OR EXISTS (
        SELECT 1 FROM "business_member" m
        WHERE m."businessId" = n."businessId" AND m."userId" = ${userId}
      ))
    ORDER BY n."createdAt" DESC, n."id" DESC
    LIMIT 100
  `;
}

export async function unreadNotificationCount(userId: string) {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "notification" n
    WHERE n."userId" = ${userId} AND n."readAt" IS NULL
      AND (n."businessId" IS NULL OR EXISTS (
        SELECT 1 FROM "business_member" m
        WHERE m."businessId" = n."businessId" AND m."userId" = ${userId}
      ))
  `;
  return Number(rows[0]?.count ?? 0);
}
