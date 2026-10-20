import { Suspense } from 'react';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { SellerPickupForm } from '@/components/business/SellerPickupForm';
type Props = { params: Promise<{ businessId: string }> };
async function Content({ params }: Props) { const { businessId } = await params; const { business } = await requireBusinessPermission(businessId, 'operations:write');
  const clients = await prisma.client.findMany({ where: { businessId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  return <main className="app-page"><DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Seller pickups', href: `/dashboard/businesses/${businessId}/pickups` }, { label: 'New pickup' }]}/><h1 className="app-title mt-7">New seller pickup</h1><SellerPickupForm businessId={businessId} clients={clients}/></main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading…</main>}><Content {...props}/></Suspense>; }
