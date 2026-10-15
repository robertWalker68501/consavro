import { Suspense } from 'react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission } from '@/lib/business-access';
import type { Prisma } from '@/app/generated/prisma/client';

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ from?: string; to?: string }> };
const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
function validDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
async function Content({ params, searchParams }: Props) {
  const { businessId } = await params;
  const { business } = await requireBusinessPermission(businessId, 'operations:read');
  const filters = await searchParams;
  const from = validDate(filters.from);
  const to = validDate(filters.to);
  const range: Prisma.DateTimeFilter | undefined = from || to ? {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000) } : {}),
  } : undefined;
  const saleWhere: Prisma.SaleWhereInput = { businessId, cancelledAt: null, ...(range ? { soldAt: range } : {}) };
  const [totals, count, recent, outstanding, outstandingCount, paid] = await Promise.all([
    prisma.sale.aggregate({ where: saleWhere, _sum: { salePrice: true, commissionAmount: true, consignorProceeds: true } }),
    prisma.sale.count({ where: saleWhere }),
    prisma.sale.findMany({ where: saleWhere, select: { id: true, itemName: true, soldAt: true, salePrice: true, commissionAmount: true }, orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }], take: 10 }),
    prisma.sale.aggregate({ where: { businessId, cancelledAt: null, consignorId: { not: null }, consignorProceeds: { gt: 0 }, payout: null }, _sum: { consignorProceeds: true } }),
    prisma.sale.count({ where: { businessId, cancelledAt: null, consignorId: { not: null }, consignorProceeds: { gt: 0 }, payout: null } }),
    prisma.payout.aggregate({ where: { businessId }, _sum: { amount: true }, _count: { id: true } }),
  ]);
  const base = `/dashboard/businesses/${businessId}`;
  const kpis = [
    { label: 'Gross sales', value: money(Number(totals._sum.salePrice ?? 0)), detail: `${count} completed sales` },
    { label: 'Business commissions', value: money(Number(totals._sum.commissionAmount ?? 0)), detail: 'Historical commission snapshots' },
    { label: 'Consignor proceeds', value: money(Number(totals._sum.consignorProceeds ?? 0)), detail: 'Earned on completed sales' },
    { label: 'Outstanding payouts', value: money(Number(outstanding._sum.consignorProceeds ?? 0)), detail: `${outstandingCount} unpaid sales · all time` },
    { label: 'Payouts recorded', value: money(Number(paid._sum.amount ?? 0)), detail: `${paid._count.id} payouts · all time` },
  ];
  return <main className="app-page max-w-6xl">
    <DashboardBreadcrumbs items={[{ label: business.name, href: base }, { label: 'Financial dashboard' }]}/>
    <div className="mt-7"><div className="app-eyebrow"><span className="app-eyebrow-dot"/> FINANCIAL OVERVIEW</div><h1 className="app-title">Financial dashboard</h1><p className="app-subtitle">Sales revenue, historical commissions, consignor earnings, and payment liabilities for {business.name}.</p></div>
    <nav aria-label="Financial reporting navigation" className="mt-7 grid gap-4 sm:grid-cols-2">
      <Link href={`${base}/reports/sales`} className="app-panel group flex items-start justify-between gap-4 border border-border transition-colors hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div><h2 className="text-base font-semibold text-foreground">Sales reporting</h2><p className="mt-2 text-sm text-muted-foreground">Explore sales, revenue, commissions, and consignor breakdowns with detailed filters.</p><span className="mt-4 inline-block text-sm font-semibold text-primary group-hover:underline">Explore sales reporting →</span></div>
      </Link>
      <Link href={`${base}/reports/inventory`} className="app-panel group flex items-start justify-between gap-4 border border-border transition-colors hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div><h2 className="text-base font-semibold text-foreground">Inventory reporting</h2><p className="mt-2 text-sm text-muted-foreground">Review unsold inventory value, aging, sell-through, and consignor stock.</p><span className="mt-4 inline-block text-sm font-semibold text-primary group-hover:underline">Explore inventory reporting →</span></div>
      </Link>
      <Link href={`${base}/reports/statements`} className="app-panel group flex items-start justify-between gap-4 border border-border transition-colors hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div><h2 className="text-base font-semibold text-foreground">Consignor statements</h2><p className="mt-2 text-sm text-muted-foreground">Review consignor sales, commissions, payouts, and outstanding balances in one statement.</p><span className="mt-4 inline-block text-sm font-semibold text-primary group-hover:underline">View consignor statements →</span></div>
      </Link>
      <Link href={`${base}/payouts`} className="app-panel group flex items-start justify-between gap-4 border border-border transition-colors hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div><h2 className="text-base font-semibold text-foreground">Payout management</h2><p className="mt-2 text-sm text-muted-foreground">Review outstanding consignor balances, recorded payouts, and payment history.</p><span className="mt-4 inline-block text-sm font-semibold text-primary group-hover:underline">Review payouts →</span></div>
      </Link>
    </nav>
    <section className="app-panel mt-7"><h2 className="app-section-title">Sales period</h2><form method="get" action={`${base}/reports`} className="mt-4 flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm font-medium">From<input name="from" type="date" defaultValue={from ?? ''} className="h-10 rounded-md border bg-background px-3"/></label><label className="grid gap-1 text-sm font-medium">To<input name="to" type="date" defaultValue={to ?? ''} className="h-10 rounded-md border bg-background px-3"/></label><button className="app-button h-10" type="submit">Apply dates</button>{(from || to) && <Link href={`${base}/reports`} className="text-sm text-primary underline underline-offset-4">Clear dates</Link>}</form><p className="mt-3 text-xs text-muted-foreground">Date filters apply to sales, commissions, consignor proceeds, and recent activity. Outstanding and paid totals are always all-time balances.</p></section>
    <section aria-label="Financial KPIs" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{kpis.map(k => <div key={k.label} className="app-panel"><h2 className="text-sm text-muted-foreground">{k.label}</h2><p className="mt-2 text-2xl font-semibold tabular-nums">{k.value}</p><p className="mt-1 text-sm text-muted-foreground">{k.detail}</p></div>)}</section>
    <section className="app-panel mt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="app-section-title">Recent sales activity</h2><Link href={`${base}/sales`} className="text-sm text-primary underline underline-offset-4">View all sales</Link></div>{recent.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="py-3 pr-4">Item</th><th className="py-3 pr-4">Sold (UTC)</th><th className="py-3 pr-4 text-right">Sale</th><th className="py-3 text-right">Commission</th></tr></thead><tbody>{recent.map(s => <tr key={s.id} className="border-b last:border-0"><td className="py-3 pr-4"><Link href={`${base}/sales/${s.id}`} className="font-medium underline underline-offset-4">{s.itemName}</Link></td><td className="py-3 pr-4">{s.soldAt.toISOString().slice(0, 10)}</td><td className="py-3 pr-4 text-right tabular-nums">{money(Number(s.salePrice))}</td><td className="py-3 text-right tabular-nums">{money(Number(s.commissionAmount))}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-muted-foreground">No completed sales in this period.</p>}</section>
    
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading financial dashboard…</main>}><Content {...props}/></Suspense>; }
