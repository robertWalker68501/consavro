import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { CancelSaleButton } from '@/components/business/CancelSaleButton';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission, hasBusinessPermission } from '@/lib/business-access';

type Props = { params: Promise<{ businessId: string; saleId: string }> };
async function Content({ params }: Props) {
  const { businessId, saleId } = await params;
  const { business, membership } = await requireBusinessPermission(businessId, 'operations:read');
  const sale = await prisma.sale.findFirst({ where: { id: saleId, businessId }, select: { id: true, itemName: true, salePrice: true, consignorId: true, consignorName: true, commissionRate: true, commissionAmount: true, consignorProceeds: true, soldAt: true, notes: true, inventoryItemId: true, cancelledAt: true, inventoryQuantityBefore: true, createdAt: true } });
  if (!sale) notFound();
  return <main className="app-page max-w-5xl"><DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Sales', href: `/dashboard/businesses/${businessId}/sales` }, { label: sale.itemName }]}/><div className="mt-7"><div className="app-eyebrow"><span className="app-eyebrow-dot"/> {sale.cancelledAt ? 'CANCELLED SALE' : 'RECORDED SALE'}</div><h1 className="app-title">{sale.itemName}</h1><p className="app-subtitle">Sale recorded on {sale.soldAt.toLocaleDateString('en-US', { timeZone: 'UTC' })}</p></div>
    <section className="app-panel mt-8"><h2 className="app-section-title">Transaction details</h2><dl className="mt-5 grid gap-4 sm:grid-cols-[10rem_1fr]"><dt className="text-muted-foreground">Status</dt><dd>{sale.cancelledAt ? 'Cancelled' : 'Recorded'}</dd><dt className="text-muted-foreground">Inventory item</dt><dd><Link className="underline underline-offset-4" href={`/dashboard/businesses/${businessId}/inventory/${sale.inventoryItemId}`}>{sale.itemName}</Link></dd><dt className="text-muted-foreground">Sale price</dt><dd>${sale.salePrice.toFixed(2)}</dd><dt className="text-muted-foreground">Consignor</dt><dd>{sale.consignorName ?? 'Business-owned inventory'}</dd><dt className="text-muted-foreground">Commission rate</dt><dd>{sale.commissionRate.toFixed(2)}%</dd><dt className="text-muted-foreground">Business commission</dt><dd>${sale.commissionAmount.toFixed(2)}</dd><dt className="text-muted-foreground">Consignor proceeds</dt><dd>${sale.consignorProceeds.toFixed(2)}</dd><dt className="text-muted-foreground">Payout status</dt><dd>{sale.cancelledAt ? 'Not applicable — sale cancelled' : sale.consignorId ? 'Unpaid — payout not yet recorded' : 'Not applicable'}</dd><dt className="text-muted-foreground">Sale date</dt><dd>{sale.soldAt.toLocaleDateString('en-US', { timeZone: 'UTC' })}</dd><dt className="text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap">{sale.notes || 'No notes added.'}</dd><dt className="text-muted-foreground">Recorded</dt><dd>{sale.createdAt.toLocaleDateString('en-US')}</dd></dl>{!sale.cancelledAt && sale.inventoryQuantityBefore !== null && hasBusinessPermission(membership.role, 'operations:write') && <CancelSaleButton businessId={businessId} saleId={saleId}/>}</section>
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading sale…</main>}><Content {...props}/></Suspense>; }
