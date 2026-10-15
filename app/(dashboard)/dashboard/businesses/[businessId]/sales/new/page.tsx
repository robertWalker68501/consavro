import { Suspense } from 'react';
import prisma from '@/lib/prisma';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission } from '@/lib/business-access';
import { SaleForm } from '@/components/business/SaleForm';

type Props = { params: Promise<{ businessId: string }> };
async function Content({ params }: Props) {
  const { businessId } = await params;
  const { business } = await requireBusinessPermission(businessId, 'operations:write');
  const items = await prisma.inventoryItem.findMany({ where: { businessId, archivedAt: null, status: { not: 'SOLD' }, quantity: { gt: 0 }, sales: { none: { cancelledAt: null } } }, orderBy: { name: 'asc' }, select: { id: true, name: true, sku: true, setNumber: true } });
  return <main className="app-page max-w-3xl"><DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Sales', href: `/dashboard/businesses/${businessId}/sales` }, { label: 'Record sale' }]}/><h1 className="app-title mt-5">Record sale</h1><p className="app-subtitle">Add a transaction for this business.</p><SaleForm businessId={businessId} items={items}/></main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading…</main>}><Content {...props}/></Suspense>; }
