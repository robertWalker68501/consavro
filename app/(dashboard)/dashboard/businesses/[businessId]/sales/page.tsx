import { Suspense } from 'react';
import Link from 'next/link';
import { Plus, ReceiptText } from 'lucide-react';
import prisma from '@/lib/prisma';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission, hasBusinessPermission } from '@/lib/business-access';

type Props = { params: Promise<{ businessId: string }> };
async function Content({ params }: Props) {
  const { businessId } = await params;
  const { business, membership } = await requireBusinessPermission(businessId, 'operations:read');
  const sales = await prisma.sale.findMany({ where: { businessId }, orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }], select: { id: true, itemName: true, salePrice: true, soldAt: true, cancelledAt: true } });
  return <main className="app-page">
    <DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Sales' }]} />
    <div className="mt-7 flex flex-wrap items-end justify-between gap-4"><div><div className="app-eyebrow"><span className="app-eyebrow-dot"/> TRANSACTIONS</div><h1 className="app-title">Sales</h1><p className="app-subtitle">Recorded sales for {business.name}.</p></div>
      {hasBusinessPermission(membership.role, 'operations:write') && <Link className="app-button" href={`/dashboard/businesses/${businessId}/sales/new`}><Plus className="size-4"/> Record sale</Link>}
    </div>
    <section className="app-panel mt-8 overflow-hidden !p-0"><div className="flex items-center justify-between px-6 py-5"><div><h2 className="app-section-title">Sales history</h2><p className="mt-1 text-sm text-muted-foreground">{sales.length} {sales.length === 1 ? 'sale' : 'sales'}</p></div><ReceiptText className="size-5 text-muted-foreground"/></div>
      {sales.length ? <ul className="divide-y border-t">{sales.map(sale => <li key={sale.id}><Link className="flex items-center justify-between gap-4 px-6 py-4 transition hover:bg-muted/60" href={`/dashboard/businesses/${businessId}/sales/${sale.id}`}><span><span className="block font-medium">{sale.itemName}</span><span className="text-sm text-muted-foreground">{sale.cancelledAt && <span className="mr-2 font-medium text-destructive">Cancelled</span>}{sale.soldAt.toLocaleDateString('en-US', { timeZone: 'UTC' })}</span></span><span className="font-medium">${sale.salePrice.toFixed(2)}</span></Link></li>)}</ul> : <div className="app-empty mx-6 mb-6"><ReceiptText className="mx-auto size-8 text-primary"/><p className="mt-3 font-semibold">No sales recorded yet.</p><p className="mt-1 text-sm text-muted-foreground">Record your first transaction to start building sales history.</p></div>}
    </section>
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading sales…</main>}><Content {...props}/></Suspense>; }
