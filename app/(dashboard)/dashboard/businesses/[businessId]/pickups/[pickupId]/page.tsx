import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { requireBusinessPermission, hasBusinessPermission } from '@/lib/business-access';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { PickupAdvanceButton } from '@/components/business/PickupAdvanceButton';
import { SellerPickupItems } from '@/components/business/SellerPickupItems';
type Props = { params: Promise<{ businessId: string; pickupId: string }> };
async function Content({ params }: Props) { const { businessId, pickupId } = await params; const { business, membership } = await requireBusinessPermission(businessId, 'operations:read');
  const pickup = await prisma.sellerPickup.findFirst({ where: { id: pickupId, businessId }, include: { client: { select: { name: true } }, items: { orderBy: { createdAt: 'asc' } } } }); if (!pickup) notFound();
  const canWrite = hasBusinessPermission(membership.role, 'operations:write');
  return <main className="app-page"><DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Seller pickups', href: `/dashboard/businesses/${businessId}/pickups` }, { label: 'Pickup details' }]}/>
    <div className="mt-7 flex flex-wrap items-center justify-between gap-4"><h1 className="app-title">Pickup details</h1>{canWrite && pickup.status !== 'COMPLETED' && <Link className="app-button" href={`/dashboard/businesses/${businessId}/pickups/${pickupId}/edit`}>Edit pickup</Link>}</div>
    <dl className="app-panel mt-7 grid gap-5 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">Seller</dt><dd className="font-medium">{pickup.client.name}</dd></div><div><dt className="text-sm text-muted-foreground">Status</dt><dd>{pickup.status.replaceAll('_',' ')}</dd></div><div><dt className="text-sm text-muted-foreground">Pickup date</dt><dd>{pickup.scheduledAt.toISOString().slice(0,10)}</dd></div><div><dt className="text-sm text-muted-foreground">Reference</dt><dd className="break-all">{pickup.reference}</dd></div><div><dt className="text-sm text-muted-foreground">Location</dt><dd>{pickup.location || 'Not provided'}</dd></div><div><dt className="text-sm text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap">{pickup.notes || 'No notes'}</dd></div></dl>
    <SellerPickupItems businessId={businessId} pickupId={pickupId} items={pickup.items.map(item=>({...item,estimatedValue:item.estimatedValue?.toFixed(2)??null,askingPrice:item.askingPrice?.toFixed(2)??null}))} canWrite={canWrite && pickup.status !== 'COMPLETED'}/>
    {canWrite && pickup.status !== 'COMPLETED' && <PickupAdvanceButton businessId={businessId} pickupId={pickupId} status={pickup.status}/>}
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading pickup…</main>}><Content {...props}/></Suspense>; }
