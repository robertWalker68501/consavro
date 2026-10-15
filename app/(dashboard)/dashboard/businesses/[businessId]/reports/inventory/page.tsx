import { Suspense } from 'react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission } from '@/lib/business-access';
import type { Prisma } from '@/app/generated/prisma/client';

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ status?: string; consignor?: string; age?: string }> };
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const statuses = ['IN_STOCK', 'RESERVED', 'SOLD'] as const;
const labelStatus = (status: string) => status.replaceAll('_', ' ').toLowerCase().replace(/^./, letter => letter.toUpperCase());
const dayMs = 86400000;

async function Content({ params, searchParams }: Props) {
  const { businessId } = await params;
  const { business } = await requireBusinessPermission(businessId, 'operations:read');
  const query = await searchParams;
  const status = typeof query.status === 'string' && statuses.some(s => s === query.status) ? query.status : '';
  const age = typeof query.age === 'string' && ['0-30', '31-60', '61-90', '91+'].includes(query.age) ? query.age : '';
  const base = `/dashboard/businesses/${businessId}`;
  const [items, clients, completedSales] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { businessId, archivedAt: null }, select: { id: true, name: true, setNumber: true, sku: true, quantity: true, status: true, askingPrice: true, estimatedValue: true, createdAt: true, clientId: true, client: { select: { name: true, commissionRateOverride: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.client.findMany({ where: { businessId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.sale.findMany({ where: { businessId, cancelledAt: null }, select: { inventoryItemId: true } }),
  ]);
  const consignor = typeof query.consignor === 'string' && clients.some(c => c.id === query.consignor) ? query.consignor : '';
  const soldIds = new Set(completedSales.map(s => s.inventoryItemId));
  // A sale fulfills an entire inventory listing, rather than an individual unit.
  // Therefore sell-through is measured by listings, not by units sold.
  const soldListings = items.filter(i => soldIds.has(i.id)).length;
  const available = items.filter(i => !soldIds.has(i.id) && i.status !== 'SOLD' && i.quantity > 0);
  const now = Date.now();
  const daysOld = (createdAt: Date) => Math.max(0, Math.floor((now - createdAt.getTime()) / dayMs));
  const matchesAge = (days: number) => !age || (age === '0-30' && days <= 30) || (age === '31-60' && days >= 31 && days <= 60) || (age === '61-90' && days >= 61 && days <= 90) || (age === '91+' && days >= 91);
  const filtered = items.filter(i => (!status || i.status === status) && (!consignor || i.clientId === consignor) && matchesAge(daysOld(i.createdAt)));
  const unsold = filtered.filter(i => !soldIds.has(i.id) && i.status !== 'SOLD' && i.quantity > 0);
  const sum = (values: typeof items, field: 'askingPrice' | 'estimatedValue') => values.reduce((total, i) => total + Number(i[field] ?? 0) * i.quantity, 0);
  const askingTotal = sum(unsold, 'askingPrice');
  const estimatedTotal = sum(unsold, 'estimatedValue');
  const ageBuckets = [
    { label: '0–30 days', count: available.filter(i => daysOld(i.createdAt) <= 30).length },
    { label: '31–60 days', count: available.filter(i => daysOld(i.createdAt) >= 31 && daysOld(i.createdAt) <= 60).length },
    { label: '61–90 days', count: available.filter(i => daysOld(i.createdAt) >= 61 && daysOld(i.createdAt) <= 90).length },
    { label: '91+ days', count: available.filter(i => daysOld(i.createdAt) >= 91).length },
  ];
  const byConsignor = new Map<string, { name: string; listings: number; units: number; asking: number; estimated: number }>();
  for (const i of unsold) {
    const key = i.clientId ?? 'unassigned';
    const row = byConsignor.get(key) ?? { name: i.client?.name ?? 'Unassigned / business-owned', listings: 0, units: 0, asking: 0, estimated: 0 };
    row.listings++; row.units += i.quantity;
    row.asking += Number(i.askingPrice ?? 0) * i.quantity;
    row.estimated += Number(i.estimatedValue ?? 0) * i.quantity;
    byConsignor.set(key, row);
  }
  const kpis = [
    { label: 'Unsold listings', value: String(unsold.length), detail: 'Available or reserved listings matching filters' },
    { label: 'Unsold units', value: String(unsold.reduce((n, i) => n + i.quantity, 0)), detail: 'Current on-hand quantity' },
    { label: 'Asking value', value: money(askingTotal), detail: 'Unsold quantity × asking price (where provided)' },
    { label: 'Estimated value', value: money(estimatedTotal), detail: 'Unsold quantity × estimated value (where provided)' },
  ];
  const sellThrough = items.length ? (soldListings / items.length * 100).toFixed(1) : '0.0';
  return <main className="app-page max-w-6xl">
    <DashboardBreadcrumbs items={[{ label: business.name, href: base }, { label: 'Financial dashboard', href: `${base}/reports` }, { label: 'Inventory reporting' }]}/>
    <div className="mt-7"><div className="app-eyebrow"><span className="app-eyebrow-dot"/> INVENTORY ANALYTICS</div><h1 className="app-title">Inventory reporting</h1><p className="app-subtitle">Current stock valuation, aging, and sell-through for {business.name}. Archived inventory is excluded.</p></div>
    <div className="mt-5 flex justify-end"><a className="app-button" href={`${base}/reports/export/inventory?${new URLSearchParams({ ...(status ? { status } : {}), ...(consignor ? { consignor } : {}), ...(age ? { age } : {}) }).toString()}`}>Export inventory CSV</a></div>
    <section className="app-panel mt-7"><h2 className="app-section-title">Inventory filters</h2><form method="get" action={`${base}/reports/inventory`} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm font-medium">Status<select name="status" defaultValue={status} className="h-10 rounded-md border bg-background px-3"><option value="">All statuses</option>{statuses.map(s => <option key={s} value={s}>{labelStatus(s)}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-medium">Consignor<select name="consignor" defaultValue={consignor} className="h-10 rounded-md border bg-background px-3"><option value="">All consignors</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-medium">Inventory age<select name="age" defaultValue={age} className="h-10 rounded-md border bg-background px-3"><option value="">All ages</option><option value="0-30">0–30 days</option><option value="31-60">31–60 days</option><option value="61-90">61–90 days</option><option value="91+">91+ days</option></select></label>
      <button type="submit" className="app-button h-10">Apply filters</button><Link href={`${base}/reports/inventory`} className="pb-2 text-sm text-primary underline underline-offset-4">Clear filters</Link>
    </form><p className="mt-3 text-xs text-muted-foreground">Valuations are indicative asking/estimated values, not realized revenue or guaranteed consignor proceeds. Missing prices contribute $0 to these totals.</p></section>
    <section aria-label="Inventory report KPIs" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{kpis.map(k => <div key={k.label} className="app-panel"><h2 className="text-sm text-muted-foreground">{k.label}</h2><p className="mt-2 text-2xl font-semibold tabular-nums">{k.value}</p><p className="mt-1 text-xs text-muted-foreground">{k.detail}</p></div>)}</section>
    <section className="mt-6 grid gap-4 md:grid-cols-2"><div className="app-panel"><h2 className="app-section-title">Sell-through · all active listings</h2><p className="mt-3 text-2xl font-semibold tabular-nums">{sellThrough}%</p><p className="mt-2 text-sm text-muted-foreground">{soldListings} sold of {items.length} non-archived listings. Based on completed, non-cancelled sales; unaffected by report filters. Each listing counts once, regardless of its original quantity.</p></div><div className="app-panel"><h2 className="app-section-title">Unsold inventory aging · all active listings</h2><dl className="mt-3 grid grid-cols-2 gap-3">{ageBuckets.map(b => <div key={b.label}><dt className="text-sm text-muted-foreground">{b.label}</dt><dd className="text-xl font-semibold tabular-nums">{b.count}</dd></div>)}</dl><p className="mt-2 text-xs text-muted-foreground">Age is measured from the inventory record creation date, not physical receipt date.</p></div></section>
    <section className="app-panel mt-6"><h2 className="app-section-title">Unsold inventory by consignor</h2>{byConsignor.size ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="py-3 pr-3">Consignor</th><th className="py-3 pr-3 text-right">Listings</th><th className="py-3 pr-3 text-right">Units</th><th className="py-3 pr-3 text-right">Asking value</th><th className="py-3 text-right">Estimated value</th></tr></thead><tbody>{[...byConsignor.entries()].sort((a,b) => a[1].name.localeCompare(b[1].name)).map(([id,r]) => <tr key={id} className="border-b last:border-0"><td className="py-3 pr-3">{r.name}</td><td className="py-3 pr-3 text-right">{r.listings}</td><td className="py-3 pr-3 text-right">{r.units}</td><td className="py-3 pr-3 text-right">{money(r.asking)}</td><td className="py-3 text-right">{money(r.estimated)}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-muted-foreground">No unsold inventory matches these filters.</p>}</section>
    <section className="app-panel mt-6"><h2 className="app-section-title">Inventory detail</h2>{filtered.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="py-3 pr-3">Item</th><th className="py-3 pr-3">Consignor</th><th className="py-3 pr-3">Status</th><th className="py-3 pr-3 text-right">Units</th><th className="py-3 pr-3 text-right">Age</th><th className="py-3 pr-3 text-right">Asking / unit</th><th className="py-3 text-right">Estimated / unit</th></tr></thead><tbody>{filtered.map(i => <tr key={i.id} className="border-b last:border-0"><td className="py-3 pr-3"><Link href={`${base}/inventory/${i.id}`} className="font-medium underline underline-offset-4">{i.name}</Link>{i.setNumber && <span className="block text-xs text-muted-foreground">Set {i.setNumber}</span>}</td><td className="py-3 pr-3">{i.client?.name ?? 'Unassigned'}</td><td className="py-3 pr-3">{labelStatus(i.status)}</td><td className="py-3 pr-3 text-right tabular-nums">{i.quantity}</td><td className="py-3 pr-3 text-right tabular-nums">{daysOld(i.createdAt)}d</td><td className="py-3 pr-3 text-right tabular-nums">{i.askingPrice === null ? '—' : money(Number(i.askingPrice))}</td><td className="py-3 text-right tabular-nums">{i.estimatedValue === null ? '—' : money(Number(i.estimatedValue))}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-muted-foreground">No inventory matches these filters.</p>}</section>
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading inventory report…</main>}><Content {...props}/></Suspense>; }
