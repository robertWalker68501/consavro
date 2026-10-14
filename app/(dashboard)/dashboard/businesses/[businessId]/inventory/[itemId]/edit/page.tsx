import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission } from '@/lib/business-access';
import { InventoryItemForm } from '@/components/business/InventoryItemForm';
import prisma from '@/lib/prisma';

type Props = { params: Promise<{ businessId: string; itemId: string }> };
async function Content({ params }: Props) {
  const { businessId, itemId } = await params;
  const { business } = await requireBusinessPermission(businessId, 'operations:write');
  const item = await prisma.inventoryItem.findFirst({ where: { id: itemId, businessId, archivedAt: null } });
  if (!item) notFound();
  const clients = await prisma.client.findMany({ where: { businessId }, select: { id: true, name: true, archivedAt: true }, orderBy: { name: 'asc' } });
  return <main className="app-page max-w-3xl">
    <DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Inventory', href: `/dashboard/businesses/${businessId}/inventory` }, { label: item.name, href: `/dashboard/businesses/${businessId}/inventory/${itemId}` }, { label: 'Edit' }]} />
    <h1 className="app-title mt-5">Edit inventory item</h1>
    <InventoryItemForm businessId={businessId} clients={clients} item={{ ...item, askingPrice: item.askingPrice?.toString() ?? null, estimatedValue: item.estimatedValue?.toString() ?? null }}/>
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading item…</main>}><Content {...props}/></Suspense>; }
