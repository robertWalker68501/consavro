import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { Suspense } from 'react';
import Link from 'next/link';
import { requireBusinessPermission, hasBusinessPermission } from '@/lib/business-access';
import prisma from '@/lib/prisma';
import { TeamManagement } from '@/components/business/TeamManagement';

type Props = { params: Promise<{ businessId: string }> };
async function TeamContent({ params }: Props) {
  const { businessId } = await params;
  const { business, membership, user } = await requireBusinessPermission(businessId, 'members:read');
  const members = await prisma.businessMember.findMany({
    where: { businessId: business.id },
    select: { id: true, userId: true, role: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return <main className="app-page">
    <DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${business.id}` }, { label: "Team" }]} />
    <h1 className="app-title mt-5">{business.name} — Team</h1>
    <p className="mt-2 text-muted-foreground">Your role: {membership.role}</p>
    <TeamManagement businessId={business.id} currentUserId={user.id} canManage={hasBusinessPermission(membership.role, 'members:manage')} members={members} />
  </main>;
}
export default function TeamPage({ params }: Props) {
  return <Suspense fallback={<main role="status" className="px-6 py-12">Loading team…</main>}><TeamContent params={params} /></Suspense>;
}
