import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission, hasBusinessPermission } from '@/lib/business-access';
import { ArchiveInventoryItemButton } from '@/components/business/ArchiveInventoryItemButton';
import prisma from '@/lib/prisma';

type Props = { params: Promise<{ businessId: string; itemId: string }> };
async function Content({ params }: Props) {
  const { businessId, itemId } = await params;
  const { business, membership } = await requireBusinessPermission(businessId, 'operations:read');
  const item = await prisma.inventoryItem.findFirst({ where: { id: itemId, businessId } });
  if (!item) notFound();
  const canManage = !item.archivedAt && hasBusinessPermission(membership.role, 'operations:write');
  return <main className="app-page max-w-5xl">
    <DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Inventory', href: `/dashboard/businesses/${businessId}/inventory` }, { label: item.name }]} />
    <div className="mt-7 flex flex-wrap items-start justify-between gap-4">
      <div><div className="app-eyebrow"><span className="app-eyebrow-dot"/> INVENTORY ITEM</div><h1 className="app-title">{item.name}</h1><p className="app-subtitle">{item.archivedAt ? 'Archived item' : 'Active item'}</p></div>
      {canManage && <div className="flex flex-wrap gap-2"><Link className="app-button" href={`/dashboard/businesses/${businessId}/inventory/${itemId}/edit`}>Edit item</Link><ArchiveInventoryItemButton businessId={businessId} itemId={itemId}/></div>}
    </div>
    <div className="app-panel mt-8">
      <h2 className="app-section-title">Item details</h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">Item name</dt><dd>{item.name}</dd>
        <dt className="text-muted-foreground">Internal SKU</dt><dd>{item.sku || 'Not provided'}</dd>
        <dt className="text-muted-foreground">Quantity</dt><dd>{item.quantity}</dd>
        <dt className="text-muted-foreground">Description</dt><dd className="whitespace-pre-wrap">{item.description || 'No description added.'}</dd>
        <dt className="text-muted-foreground">Created</dt><dd>{item.createdAt.toLocaleDateString('en-US')}</dd>
      </dl>
    </div>
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading item…</main>}><Content {...props}/></Suspense>; }
