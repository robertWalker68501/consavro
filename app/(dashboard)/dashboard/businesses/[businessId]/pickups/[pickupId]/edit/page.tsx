import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { SellerPickupForm } from '@/components/business/SellerPickupForm';
type Props = { params: Promise<{ businessId: string; pickupId: string }> };
async function Content({ params }: Props) { const { businessId, pickupId } = await params; const { business } = await requireBusinessPermission(businessId, 'operations:write');
  const pickup = await prisma.sellerPickup.findFirst({ where: { id: pickupId, businessId, status: { not: 'COMPLETED' } } }); if (!pickup) notFound();
  const clients = await prisma.client.findMany({ where: { businessId, OR: [{ archivedAt: null }, { id: pickup.clientId }] }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  return <main className="app-page"><DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Seller pickups', href: `/dashboard/businesses/${businessId}/pickups` }, { label: 'Edit pickup' }]}/><h1 className="app-title mt-7">Edit seller pickup</h1><SellerPickupForm businessId={businessId} pickupId={pickupId} clients={clients} initial={{ clientId: pickup.clientId, date: pickup.scheduledAt.toISOString().slice(0,10), location: pickup.location || '', notes: pickup.notes || '' }}/></main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading…</main>}><Content {...props}/></Suspense>; }
