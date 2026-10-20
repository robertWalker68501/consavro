import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';

export function isCatalogAdministratorEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.CONSAVRO_CATALOG_ADMIN_EMAILS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}

/** Catalog-wide mutations must not be authorized by a business OWNER role. */
export async function requireCatalogAdministrator() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  if (!session.user.emailVerified) redirect('/verify-email');
  if (!isCatalogAdministratorEmail(session.user.email)) notFound();
  // Fail closed until the administrator is explicitly configured.
  return session.user;
}

export async function listCatalogForManagement() {
  await requireCatalogAdministrator();
  return prisma.legoSet.findMany({ orderBy: [{ updatedAt: 'desc' }], take: 100,
    select: { id: true, setNumber: true, name: true, theme: true, releaseYear: true,
      pieceCount: true, imageUrl: true, source: true, verificationStatus: true,
      _count: { select: { inventoryItems: true } } } });
}
