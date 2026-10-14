import prisma from '@/lib/prisma';
import { Suspense } from 'react';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission } from '@/lib/business-access';
import { InventoryItemForm } from '@/components/business/InventoryItemForm';

type Props = { params: Promise<{ businessId: string }> };
async function Content({ params }: Props) {
  const { businessId } = await params;
  const { business } = await requireBusinessPermission(businessId, 'operations:write');
  const clients = await prisma.client.findMany({ where: { businessId }, select: { id: true, name: true, archivedAt: true }, orderBy: { name: 'asc' } });
  return <main className="app-page max-w-3xl">
    <DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Inventory', href: `/dashboard/businesses/${businessId}/inventory` }, { label: 'Add item' }]} />
    <h1 className="app-title mt-5">Add inventory item</h1>
    <p className="app-subtitle">Create an inventory record for this business.</p>
    <InventoryItemForm businessId={businessId} clients={clients}/>
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading…</main>}><Content {...props}/></Suspense>; }
