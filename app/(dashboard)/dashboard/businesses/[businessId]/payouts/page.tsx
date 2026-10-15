import { Suspense } from 'react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission } from '@/lib/business-access';
import type { Prisma, PayoutMethod } from '@/app/generated/prisma/client';

type Filters = { client?: string; method?: string; from?: string; to?: string };
type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<Filters> };
const methods: { value: PayoutMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' }, { value: 'CHECK', label: 'Check' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' }, { value: 'ZELLE', label: 'Zelle' },
  { value: 'VENMO', label: 'Venmo' }, { value: 'OTHER', label: 'Other' },
];
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
function validDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
function dateLabel(value: Date) { return value.toLocaleDateString('en-US', { timeZone: 'UTC' }); }
async function Content({ params, searchParams }: Props) {
  const { businessId } = await params;
  const filters = await searchParams;
  const { business } = await requireBusinessPermission(businessId, 'operations:read');
  const client = typeof filters.client === 'string' ? filters.client : '';
  const method = methods.find(m => m.value === filters.method)?.value;
  const from = validDate(filters.from);
  const to = validDate(filters.to);
  const where: Prisma.PayoutWhereInput = {
    businessId,
    ...(client ? { clientId: client } : {}),
    ...(method ? { method } : {}),
    ...((from || to) ? { paidAt: {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000) } : {}),
    } } : {}),
  };
  const [unpaid, paid, clients, allTotals] = await Promise.all([
    prisma.sale.findMany({ where: { businessId, cancelledAt: null, consignorId: { not: null }, consignorProceeds: { gt: 0 }, payout: null }, select: { id: true, itemName: true, consignorName: true, consignorProceeds: true }, orderBy: { soldAt: 'desc' } }),
    prisma.payout.findMany({ where, include: { sale: { select: { itemName: true } }, client: { select: { name: true } } }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] }),
    prisma.client.findMany({ where: { businessId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.payout.aggregate({ where: { businessId }, _sum: { amount: true }, _count: { id: true } }),
  ]);
  const outstandingTotal = unpaid.reduce((sum, sale) => sum + Number(sale.consignorProceeds), 0);
  const filteredTotal = paid.reduce((sum, payout) => sum + Number(payout.amount), 0);
  const activeFilters = Boolean(client || method || from || to);
  const base = `/dashboard/businesses/${businessId}/payouts`;
  const exportParams = new URLSearchParams();
  if (client) exportParams.set('client', client);
  if (method) exportParams.set('method', method);
  if (from) exportParams.set('from', from);
  if (to) exportParams.set('to', to);
  const exportHref = `/dashboard/businesses/${businessId}/reports/export/payouts${exportParams.size ? `?${exportParams.toString()}` : ''}`;
  return <main className="app-page max-w-6xl">
    <DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Financial Dashboard', href: `/dashboard/businesses/${businessId}/reports` }, { label: 'Payouts' }]}/>
    <div className="mt-7"><div className="app-eyebrow"><span className="app-eyebrow-dot"/> CONSIGNOR PAYMENTS</div><h1 className="app-title">Payouts</h1><p className="app-subtitle">Review outstanding balances, search payment history, and reconcile consignor payments.</p></div>
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      <section className="app-panel"><p className="text-sm text-muted-foreground">Outstanding</p><p className="mt-2 text-2xl font-semibold">{money(outstandingTotal)}</p><p className="mt-1 text-sm text-muted-foreground">{unpaid.length} unpaid sales</p></section>
      <section className="app-panel"><p className="text-sm text-muted-foreground">Total paid (all time)</p><p className="mt-2 text-2xl font-semibold">{money(Number(allTotals._sum.amount ?? 0))}</p><p className="mt-1 text-sm text-muted-foreground">{allTotals._count.id} payouts</p></section>
      <section className="app-panel"><p className="text-sm text-muted-foreground">Matching payments</p><p className="mt-2 text-2xl font-semibold">{money(filteredTotal)}</p><p className="mt-1 text-sm text-muted-foreground">{paid.length} matching payouts</p></section>
    </div>
    <section className="app-panel mt-6"><h2 className="app-section-title">Unpaid consignor sales ({unpaid.length})</h2>{unpaid.length ? <ul className="mt-4 divide-y">{unpaid.map(s => <li key={s.id} className="flex items-center justify-between gap-4 py-3"><div><Link className="font-medium underline underline-offset-4" href={`/dashboard/businesses/${businessId}/sales/${s.id}`}>{s.itemName}</Link><p className="text-sm text-muted-foreground">{s.consignorName}</p></div><span className="font-semibold">{money(Number(s.consignorProceeds))}</span></li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">No outstanding consignor payouts.</p>}</section>
    <section className="app-panel mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="app-section-title">Payment history ({paid.length})</h2><div className="flex flex-wrap items-center gap-4">{activeFilters && <Link className="text-sm text-primary underline underline-offset-4" href={base}>Clear filters</Link>}<a className="app-button inline-flex items-center justify-center" href={exportHref} download>Download CSV</a></div></div>
      <form method="get" action={base} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="grid gap-1 text-sm font-medium">Consignor<select name="client" defaultValue={client} className="h-10 w-full rounded-md border bg-background px-3"><option value="">All consignors</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Payment method<select name="method" defaultValue={method ?? ''} className="h-10 w-full rounded-md border bg-background px-3"><option value="">All methods</option>{methods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">From date<input name="from" type="date" defaultValue={from ?? ''} className="h-10 w-full rounded-md border bg-background px-3"/></label>
        <label className="grid gap-1 text-sm font-medium">To date<input name="to" type="date" defaultValue={to ?? ''} className="h-10 w-full rounded-md border bg-background px-3"/></label>
        <div className="flex items-end"><button type="submit" className="app-button h-10 w-full justify-center">Apply filters</button></div>
      </form>
      {paid.length ? <ul className="mt-5 divide-y border-t">{paid.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><Link className="font-medium underline underline-offset-4" href={`/dashboard/businesses/${businessId}/sales/${p.saleId}`}>{p.sale.itemName}</Link><p className="mt-1 text-sm text-muted-foreground">{p.client.name} · {dateLabel(p.paidAt)} · {methods.find(m => m.value === p.method)?.label ?? p.method}</p>{p.reference && <p className="mt-1 text-sm text-muted-foreground">Reference: {p.reference}</p>}{p.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">Notes: {p.notes}</p>}</div><span className="font-semibold">{money(Number(p.amount))}</span></li>)}</ul> : <p className="mt-5 text-sm text-muted-foreground">{activeFilters ? 'No payouts match these filters.' : 'No payouts recorded yet.'}</p>}
    </section>
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading payouts…</main>}><Content {...props}/></Suspense>; }
