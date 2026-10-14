import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function requireVerifiedUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  if (!session.user.emailVerified) redirect('/verify-email');
  return session.user;
}

// Permissions are evaluated for a particular business membership, never globally.
export type BusinessRole = 'OWNER' | 'MANAGER' | 'STAFF';
export type BusinessPermission =
  | 'business:read'
  | 'business:settings'
  | 'members:read'
  | 'members:manage'
  | 'operations:read'
  | 'operations:write';

const permissions: Record<BusinessRole, readonly BusinessPermission[]> = {
  OWNER: ['business:read', 'business:settings', 'members:read', 'members:manage', 'operations:read', 'operations:write'],
  MANAGER: ['business:read', 'members:read', 'operations:read', 'operations:write'],
  STAFF: ['business:read', 'operations:read'],
};

export function hasBusinessPermission(role: BusinessRole, permission: BusinessPermission): boolean {
  return permissions[role].includes(permission);
}

// The lookup is always restricted by both businessId and the authenticated userId.
// Use 404 for inaccessible businesses so their existence is not disclosed.
export async function requireBusinessMembership(businessId: string) {
  const user = await requireVerifiedUser();
  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: user.id } },
    include: { business: { select: { id: true, name: true } } },
  });
  if (!membership) notFound();
  return { user, membership, business: membership.business };
}

export async function requireBusinessPermission(businessId: string, permission: BusinessPermission) {
  const context = await requireBusinessMembership(businessId);
  if (!hasBusinessPermission(context.membership.role, permission)) notFound();
  return context;
}

// Compatibility with the Layer 1 role-based guard.
export async function requireBusinessRole(businessId: string, allowed: readonly BusinessRole[]) {
  const context = await requireBusinessMembership(businessId);
  if (!allowed.includes(context.membership.role)) notFound();
  return { user: context.user, membership: context.membership };
}
