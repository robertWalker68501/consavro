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
  const consignor = item.clientId ? await prisma.client.findFirst({ where: { id: item.clientId, businessId }, select: { id: true, name: true, archivedAt: true } }) : null;
  const activeSale = await prisma.sale.findFirst({ where: { businessId, inventoryItemId: itemId, cancelledAt: null }, select: { id: true } });
  const recentSales = await prisma.sale.findMany({ where: { businessId, inventoryItemId: itemId }, orderBy: { createdAt: 'desc' }, select: { id: true, salePrice: true, soldAt: true, cancelledAt: true } });
  const canManage = !item.archivedAt && hasBusinessPermission(membership.role, 'operations:write');
  return <main className="app-page max-w-5xl">
    <DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Inventory', href: `/dashboard/businesses/${businessId}/inventory` }, { label: item.name }]} />
    <div className="mt-7 flex flex-wrap items-start justify-between gap-4">
      <div><div className="app-eyebrow"><span className="app-eyebrow-dot"/> INVENTORY ITEM</div><h1 className="app-title">{item.name}</h1><p className="app-subtitle">{item.archivedAt ? 'Archived item' : item.status === 'IN_STOCK' ? 'In stock' : item.status === 'RESERVED' ? 'Reserved' : 'Sold'}</p></div>
      {canManage && <div className="flex flex-wrap gap-2"><Link className="app-button" href={`/dashboard/businesses/${businessId}/inventory/${itemId}/edit`}>Edit item</Link>{!activeSale && <ArchiveInventoryItemButton businessId={businessId} itemId={itemId}/>}</div>}
    </div>
    <div className="app-panel mt-8">
      <h2 className="app-section-title">Item details</h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">Item name</dt><dd>{item.name}</dd>
        <dt className="text-muted-foreground">Internal SKU</dt><dd>{item.sku || 'Not provided'}</dd>
        <dt className="text-muted-foreground">Quantity</dt><dd>{item.quantity}</dd>
        <dt className="text-muted-foreground">Inventory status</dt><dd>{item.status === 'IN_STOCK' ? 'In stock' : item.status === 'RESERVED' ? 'Reserved' : 'Sold'}</dd>
        <dt className="text-muted-foreground">Description</dt><dd className="whitespace-pre-wrap">{item.description || 'No description added.'}</dd>
        <dt className="text-muted-foreground">LEGO set number</dt><dd>{item.setNumber || 'Not provided'}</dd>
        <dt className="text-muted-foreground">LEGO theme</dt><dd>{item.theme || 'Not provided'}</dd>
        <dt className="text-muted-foreground">Condition</dt><dd>{item.condition === 'NEW_SEALED' ? 'New / sealed' : item.condition === 'NEW_OPEN_BOX' ? 'New / open box' : item.condition === 'USED' ? 'Used' : 'Not specified'}</dd>
        <dt className="text-muted-foreground">Completeness</dt><dd>{item.completeness === 'COMPLETE' ? 'Complete' : item.completeness === 'INCOMPLETE' ? 'Incomplete' : item.completeness === 'UNKNOWN' ? 'Unknown' : 'Not specified'}</dd>
        <dt className="text-muted-foreground">Asking price</dt><dd>{item.askingPrice === null ? 'Not provided' : `$${Number(item.askingPrice).toFixed(2)}`}</dd>
        <dt className="text-muted-foreground">Estimated value</dt><dd>{item.estimatedValue === null ? 'Not provided' : `$${Number(item.estimatedValue).toFixed(2)}`}</dd>
        <dt className="text-muted-foreground">Consignor</dt><dd>{consignor ? <Link className="underline underline-offset-4" href={`/dashboard/businesses/${businessId}/clients/${consignor.id}`}>{consignor.name}{consignor.archivedAt ? ' (archived)' : ''}</Link> : 'Not assigned'}</dd>
        <dt className="text-muted-foreground">Created</dt><dd>{item.createdAt.toLocaleDateString('en-US')}</dd>
      </dl>
    </div>
    {activeSale && <p className="mt-4 text-sm text-muted-foreground">This item has an active sale. Cancel that sale before archiving or editing the item.</p>}
    {recentSales.length > 0 && <section className="app-panel mt-8"><h2 className="app-section-title">Sales history</h2><ul className="mt-4 divide-y">{recentSales.map(sale => <li key={sale.id} className="py-3"><Link className="underline underline-offset-4" href={`/dashboard/businesses/${businessId}/sales/${sale.id}`}>{sale.soldAt.toLocaleDateString('en-US', { timeZone: 'UTC' })} · ${sale.salePrice.toFixed(2)}{sale.cancelledAt ? ' · Cancelled' : ' · Recorded'}</Link></li>)}</ul></section>}
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading item…</main>}><Content {...props}/></Suspense>; }
