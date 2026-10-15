import { Suspense } from 'react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission } from '@/lib/business-access';
import type { Prisma } from '@/app/generated/prisma/client';

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ from?: string; to?: string; consignor?: string; item?: string }> };
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
function dateOnly(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}
async function Content({ params, searchParams }: Props) {
  const { businessId } = await params;
  const { business } = await requireBusinessPermission(businessId, 'operations:read');
  const query = await searchParams;
  const from = dateOnly(query.from);
  const to = dateOnly(query.to);
  const base = `/dashboard/businesses/${businessId}`;
  const [consignors, inventory] = await Promise.all([
    prisma.sale.findMany({ where: { businessId, cancelledAt: null, consignorId: { not: null } }, distinct: ['consignorId'], select: { consignorId: true, consignorName: true }, orderBy: { consignorName: 'asc' } }),
    prisma.sale.findMany({ where: { businessId, cancelledAt: null }, distinct: ['inventoryItemId'], select: { inventoryItemId: true, itemName: true }, orderBy: { itemName: 'asc' } }),
  ]);
  const consignor = typeof query.consignor === 'string' && consignors.some(c => c.consignorId === query.consignor) ? query.consignor : undefined;
  const item = typeof query.item === 'string' && inventory.some(i => i.inventoryItemId === query.item) ? query.item : undefined;
  const soldAt: Prisma.DateTimeFilter | undefined = from || to ? {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000) } : {}),
  } : undefined;
  const where: Prisma.SaleWhereInput = { businessId, cancelledAt: null, ...(soldAt ? { soldAt } : {}), ...(consignor ? { consignorId: consignor } : {}), ...(item ? { inventoryItemId: item } : {}) };
  const sales = await prisma.sale.findMany({ where, select: { id: true, itemName: true, inventoryItemId: true, consignorId: true, consignorName: true, soldAt: true, salePrice: true, commissionAmount: true, consignorProceeds: true }, orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }] });
  const totals = sales.reduce((acc, sale) => ({ revenue: acc.revenue + Number(sale.salePrice), commission: acc.commission + Number(sale.commissionAmount), proceeds: acc.proceeds + Number(sale.consignorProceeds) }), { revenue: 0, commission: 0, proceeds: 0 });
  type Breakdown = { id: string; name: string; count: number; revenue: number; commission: number; proceeds: number };
  function groupBy(key: 'item' | 'consignor'): Breakdown[] {
    const groups = new Map<string, Breakdown>();
    for (const sale of sales) {
      const id = key === 'item' ? sale.inventoryItemId : (sale.consignorId ?? 'unassigned');
      const name = key === 'item' ? sale.itemName : (sale.consignorName ?? 'Unassigned');
      const current = groups.get(id) ?? { id, name, count: 0, revenue: 0, commission: 0, proceeds: 0 };
      current.count++;
      current.revenue += Number(sale.salePrice);
      current.commission += Number(sale.commissionAmount);
      current.proceeds += Number(sale.consignorProceeds);
      groups.set(id, current);
    }
    return [...groups.values()].sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  }
  function breakdown(title: string, rows: Breakdown[]) {
    return <section className="app-panel mt-6"><h2 className="app-section-title">{title}</h2>{rows.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="py-3 pr-3">Name</th><th className="py-3 pr-3 text-right">Sales</th><th className="py-3 pr-3 text-right">Revenue</th><th className="py-3 pr-3 text-right">Commission</th><th className="py-3 text-right">Proceeds</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b last:border-0"><td className="py-3 pr-3 font-medium">{row.name}</td><td className="py-3 pr-3 text-right tabular-nums">{row.count}</td><td className="py-3 pr-3 text-right tabular-nums">{money(row.revenue)}</td><td className="py-3 pr-3 text-right tabular-nums">{money(row.commission)}</td><td className="py-3 text-right tabular-nums">{money(row.proceeds)}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-muted-foreground">No completed sales match these filters.</p>}</section>;
  }
  return <main className="app-page max-w-6xl">
    <DashboardBreadcrumbs items={[{ label: business.name, href: base }, { label: 'Financial dashboard', href: `${base}/reports` }, { label: 'Sales reporting' }]}/>
    <div className="mt-7"><div className="app-eyebrow"><span className="app-eyebrow-dot"/> SALES ANALYTICS</div><h1 className="app-title">Sales reporting</h1><p className="app-subtitle">Completed sales and historical financial snapshots for {business.name}. Cancelled sales are excluded.</p></div>
    <div className="mt-5 flex justify-end"><a className="app-button" href={`${base}/reports/export/sales?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(consignor ? { consignor } : {}), ...(item ? { item } : {}) }).toString()}`}>Export sales CSV</a></div>
    <section className="app-panel mt-7"><h2 className="app-section-title">Report filters</h2><form method="get" action={`${base}/reports/sales`} className="mt-4 flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm font-medium">From<input name="from" type="date" defaultValue={from ?? ''} className="h-10 rounded-md border bg-background px-3"/></label><label className="grid gap-1 text-sm font-medium">To<input name="to" type="date" defaultValue={to ?? ''} className="h-10 rounded-md border bg-background px-3"/></label><label className="grid gap-1 text-sm font-medium">Consignor<select name="consignor" defaultValue={consignor ?? ''} className="h-10 rounded-md border bg-background px-3"><option value="">All consignors</option>{consignors.map(c => <option key={c.consignorId} value={c.consignorId ?? ''}>{c.consignorName ?? 'Unnamed consignor'}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">Inventory item<select name="item" defaultValue={item ?? ''} className="h-10 rounded-md border bg-background px-3"><option value="">All items</option>{inventory.map(i => <option key={i.inventoryItemId} value={i.inventoryItemId}>{i.itemName}</option>)}</select></label><button type="submit" className="app-button h-10">Apply filters</button><Link href={`${base}/reports/sales`} className="pb-2 text-sm text-primary underline underline-offset-4">Clear filters</Link></form><p className="mt-3 text-xs text-muted-foreground">Dates are inclusive and interpreted in UTC. All figures use financial values captured when each sale was recorded.</p></section>
    <section aria-label="Sales report KPIs" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[{ label: 'Completed sales', value: String(sales.length) }, { label: 'Gross revenue', value: money(totals.revenue) }, { label: 'Business commissions', value: money(totals.commission) }, { label: 'Consignor proceeds', value: money(totals.proceeds) }].map(k => <div key={k.label} className="app-panel"><h2 className="text-sm text-muted-foreground">{k.label}</h2><p className="mt-2 text-2xl font-semibold tabular-nums">{k.value}</p></div>)}</section>
    {breakdown('Sales by inventory item', groupBy('item'))}
    {breakdown('Sales by consignor', groupBy('consignor'))}
    <section className="app-panel mt-6"><h2 className="app-section-title">Sales detail</h2>{sales.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="py-3 pr-3">Item</th><th className="py-3 pr-3">Consignor</th><th className="py-3 pr-3">Sold (UTC)</th><th className="py-3 pr-3 text-right">Revenue</th><th className="py-3 pr-3 text-right">Commission</th><th className="py-3 text-right">Proceeds</th></tr></thead><tbody>{sales.map(s => <tr key={s.id} className="border-b last:border-0"><td className="py-3 pr-3"><Link className="font-medium underline underline-offset-4" href={`${base}/sales/${s.id}`}>{s.itemName}</Link></td><td className="py-3 pr-3">{s.consignorName ?? 'Unassigned'}</td><td className="py-3 pr-3">{s.soldAt.toISOString().slice(0, 10)}</td><td className="py-3 pr-3 text-right tabular-nums">{money(Number(s.salePrice))}</td><td className="py-3 pr-3 text-right tabular-nums">{money(Number(s.commissionAmount))}</td><td className="py-3 text-right tabular-nums">{money(Number(s.consignorProceeds))}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-muted-foreground">No completed sales match these filters.</p>}</section>
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading sales report…</main>}><Content {...props}/></Suspense>; }
