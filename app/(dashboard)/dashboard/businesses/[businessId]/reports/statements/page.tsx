import { Suspense } from 'react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission } from '@/lib/business-access';
import type { Prisma } from '@/app/generated/prisma/client';

type Query = { client?: string; from?: string; to?: string };
type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<Query> };
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const date = (value: Date) => value.toISOString().slice(0, 10);
function validDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && date(parsed) === value ? value : undefined;
}
function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
  };
}
async function Content({ params, searchParams }: Props) {
  const { businessId } = await params;
  const { business } = await requireBusinessPermission(businessId, 'operations:read');
  const query = await searchParams;
  const base = `/dashboard/businesses/${businessId}`;
  const reportUrl = `${base}/reports/statements`;
  const clients = await prisma.client.findMany({ where: { businessId }, select: { id: true, name: true, archivedAt: true }, orderBy: { name: 'asc' } });
  const selected = clients.find(c => c.id === query.client);
  const from = validDate(query.from);
  const to = validDate(query.to);
  const range = dateRange(from, to);
  const saleWhere: Prisma.SaleWhereInput = {
    businessId, cancelledAt: null, consignorId: selected?.id ?? '__no_client_selected__',
    ...(range ? { soldAt: range } : {}),
  };
  const payoutWhere: Prisma.PayoutWhereInput = {
    businessId, clientId: selected?.id ?? '__no_client_selected__',
    ...(range ? { paidAt: range } : {}),
  };
  const [sales, payouts, outstanding, allTimePaid] = selected ? await Promise.all([
    prisma.sale.findMany({ where: saleWhere, select: { id: true, itemName: true, soldAt: true, salePrice: true, commissionAmount: true, consignorProceeds: true, payout: { select: { id: true } } }, orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }] }),
    prisma.payout.findMany({ where: payoutWhere, select: { id: true, saleId: true, paidAt: true, amount: true, method: true, reference: true, sale: { select: { itemName: true } } }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] }),
    prisma.sale.aggregate({ where: { businessId, cancelledAt: null, consignorId: selected.id, consignorProceeds: { gt: 0 }, payout: null }, _sum: { consignorProceeds: true }, _count: { id: true } }),
    prisma.payout.aggregate({ where: { businessId, clientId: selected.id }, _sum: { amount: true } }),
  ]) : [[], [], null, null] as const;
  const gross = sales.reduce((sum, sale) => sum + Number(sale.salePrice), 0);
  const commissions = sales.reduce((sum, sale) => sum + Number(sale.commissionAmount), 0);
  const proceeds = sales.reduce((sum, sale) => sum + Number(sale.consignorProceeds), 0);
  const paidInPeriod = payouts.reduce((sum, payout) => sum + Number(payout.amount), 0);
  const balance = Number(outstanding?._sum.consignorProceeds ?? 0);
  const kpis = [
    { label: 'Gross sales', value: gross, detail: `${sales.length} completed sales in selected period` },
    { label: 'Business commissions', value: commissions, detail: 'Historical commission snapshots' },
    { label: 'Consignor proceeds', value: proceeds, detail: 'Earned on sales in selected period' },
    { label: 'Payouts in period', value: paidInPeriod, detail: `${payouts.length} payments by payment date` },
    { label: 'Outstanding balance', value: balance, detail: `${outstanding?._count.id ?? 0} unpaid sales · all time` },
    { label: 'Total paid', value: Number(allTimePaid?._sum.amount ?? 0), detail: 'All-time payments' },
  ];
  return <main className="app-page max-w-6xl">
    <DashboardBreadcrumbs items={[{ label: business.name, href: base }, { label: 'Financial dashboard', href: `${base}/reports` }, { label: 'Consignor statements' }]}/>
    <div className="mt-7"><div className="app-eyebrow"><span className="app-eyebrow-dot"/> CONSIGNOR ACCOUNTING</div><h1 className="app-title">Consignor statements</h1><p className="app-subtitle">Review a consignor’s completed sales, commissions, proceeds, recorded payments, and current unpaid balance.</p></div>
    {selected && <div className="mt-5 flex justify-end"><a className="app-button" href={`${base}/reports/export/statements?${new URLSearchParams({ client: selected.id, ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`}>Export statement CSV</a></div>}
    <section className="app-panel mt-7"><h2 className="app-section-title">Statement filters</h2>
      <form method="get" action={reportUrl} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid min-w-52 gap-1 text-sm font-medium">Consignor<select name="client" required defaultValue={selected?.id ?? ''} className="h-10 rounded-md border bg-background px-3"><option value="">Select a consignor</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.archivedAt ? ' (archived)' : ''}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">From<input type="date" name="from" defaultValue={from ?? ''} className="h-10 rounded-md border bg-background px-3"/></label>
        <label className="grid gap-1 text-sm font-medium">To<input type="date" name="to" defaultValue={to ?? ''} className="h-10 rounded-md border bg-background px-3"/></label>
        <button type="submit" className="app-button h-10">View statement</button>
        <Link href={reportUrl} className="pb-2 text-sm text-primary underline underline-offset-4">Clear filters</Link>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">Date boundaries are inclusive in UTC. Sales are filtered by sale date; payouts are filtered separately by payment date. Outstanding and total paid are always all-time balances.</p>
    </section>
    {!selected ? <section className="app-panel mt-6"><h2 className="app-section-title">Select a consignor to view a statement</h2><p className="mt-3 text-sm text-muted-foreground">Choose a consignor above to review their financial activity. Archived consignors remain available for historical statements.</p></section> : <>
      <section className="app-panel mt-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="app-section-title">Statement for {selected.name}</h2><p className="mt-1 text-sm text-muted-foreground">{from ?? 'All dates'} to {to ?? 'present'} (UTC){selected.archivedAt ? ' · Archived consignor' : ''}</p></div><Link href={`${base}/clients/${selected.id}`} className="text-sm text-primary underline underline-offset-4">View consignor</Link></div></section>
      <section aria-label="Consignor statement KPIs" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{kpis.map(k => <div className="app-panel" key={k.label}><h2 className="text-sm text-muted-foreground">{k.label}</h2><p className="mt-2 text-2xl font-semibold tabular-nums">{money(k.value)}</p><p className="mt-1 text-sm text-muted-foreground">{k.detail}</p></div>)}</section>
      <section className="app-panel mt-6"><h2 className="app-section-title">Completed sales ({sales.length})</h2>{sales.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="py-3 pr-3">Item</th><th className="py-3 pr-3">Sold (UTC)</th><th className="py-3 pr-3 text-right">Sale</th><th className="py-3 pr-3 text-right">Commission</th><th className="py-3 pr-3 text-right">Proceeds</th><th className="py-3 text-right">Payment</th></tr></thead><tbody>{sales.map(s => <tr key={s.id} className="border-b last:border-0"><td className="py-3 pr-3"><Link className="font-medium underline underline-offset-4" href={`${base}/sales/${s.id}`}>{s.itemName}</Link></td><td className="py-3 pr-3">{date(s.soldAt)}</td><td className="py-3 pr-3 text-right tabular-nums">{money(Number(s.salePrice))}</td><td className="py-3 pr-3 text-right tabular-nums">{money(Number(s.commissionAmount))}</td><td className="py-3 pr-3 text-right tabular-nums">{money(Number(s.consignorProceeds))}</td><td className="py-3 text-right">{s.payout ? 'Paid' : 'Unpaid'}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-muted-foreground">No completed sales in this period.</p>}</section>
      <section className="app-panel mt-6"><h2 className="app-section-title">Recorded payouts ({payouts.length})</h2>{payouts.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="py-3 pr-3">Sale</th><th className="py-3 pr-3">Paid (UTC)</th><th className="py-3 pr-3">Method</th><th className="py-3 pr-3">Reference</th><th className="py-3 text-right">Amount</th></tr></thead><tbody>{payouts.map(p => <tr key={p.id} className="border-b last:border-0"><td className="py-3 pr-3"><Link href={`${base}/sales/${p.saleId}`} className="font-medium underline underline-offset-4">{p.sale.itemName}</Link></td><td className="py-3 pr-3">{date(p.paidAt)}</td><td className="py-3 pr-3">{p.method.replaceAll('_', ' ')}</td><td className="py-3 pr-3">{p.reference ?? '—'}</td><td className="py-3 text-right tabular-nums">{money(Number(p.amount))}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-muted-foreground">No payouts recorded in this period.</p>}</section>
    </>}
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading consignor statements…</main>}><Content {...props}/></Suspense>; }
