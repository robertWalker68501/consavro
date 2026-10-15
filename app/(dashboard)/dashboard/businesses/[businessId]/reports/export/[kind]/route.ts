import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import type { Prisma } from '@/app/generated/prisma/client';

type Context = { params: Promise<{ businessId: string; kind: string }> };

function validDate(value: string | null) {
  if (!value || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}
function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  return from || to ? {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
  } : undefined;
}
function cell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  // Escape spreadsheet formulas, including values with leading whitespace.
  const safe = /^[\\s\\u0000-\\u001f]*[=+@-]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
function csv(rows: unknown[][]) {
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
function response(rows: unknown[][], filename: string) {
  return new NextResponse(csv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
const money = (value: unknown) => Number(value ?? 0).toFixed(2);

export async function GET(request: NextRequest, { params }: Context) {
  const { businessId, kind } = await params;
  // Authenticate and authorize before any financial lookup or export.
  await requireBusinessPermission(businessId, 'operations:read');
  if (!['sales', 'inventory', 'statements'].includes(kind)) {
    return new NextResponse('Not found', { status: 404 });
  }
  const q = request.nextUrl.searchParams;
  const from = validDate(q.get('from'));
  const to = validDate(q.get('to'));
  const range = dateRange(from, to);
  if (kind === 'sales') {
    const consignor = q.get('consignor');
    const item = q.get('item');
    const sales = await prisma.sale.findMany({
      where: { businessId, cancelledAt: null,
        ...(range ? { soldAt: range } : {}),
        ...(consignor ? { consignorId: consignor } : {}),
        ...(item ? { inventoryItemId: item } : {}),
      },
      select: { id: true, itemName: true, inventoryItemId: true, consignorName: true, soldAt: true, salePrice: true, commissionAmount: true, consignorProceeds: true },
      orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }],
    });
    return response([
      ['Sale ID', 'Item', 'Inventory item ID', 'Consignor', 'Sold (UTC)', 'Gross sale (USD)', 'Commission (USD)', 'Consignor proceeds (USD)'],
      ...sales.map(s => [s.id, s.itemName, s.inventoryItemId, s.consignorName ?? '', s.soldAt.toISOString().slice(0, 10), money(s.salePrice), money(s.commissionAmount), money(s.consignorProceeds)]),
    ], `consavro-sales-${businessId}.csv`);
  }
  if (kind === 'inventory') {
    const status = q.get('status');
    const consignor = q.get('consignor');
    const age = q.get('age');
    const items = await prisma.inventoryItem.findMany({
      where: { businessId, archivedAt: null,
        ...(status && ['IN_STOCK', 'RESERVED', 'SOLD'].includes(status) ? { status: status as 'IN_STOCK' | 'RESERVED' | 'SOLD' } : {}),
        ...(consignor ? { clientId: consignor } : {}),
      },
      select: { id: true, name: true, setNumber: true, sku: true, quantity: true, status: true, askingPrice: true, estimatedValue: true, createdAt: true, client: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const now = Date.now();
    const days = (date: Date) => Math.max(0, Math.floor((now - date.getTime()) / 86_400_000));
    const matchesAge = (n: number) => !age || (age === '0-30' && n <= 30) || (age === '31-60' && n >= 31 && n <= 60) || (age === '61-90' && n >= 61 && n <= 90) || (age === '91+' && n >= 91);
    return response([
      ['Inventory ID', 'Item', 'Set number', 'SKU', 'Consignor', 'Status', 'Units', 'Age (days)', 'Asking per unit (USD)', 'Estimated per unit (USD)', 'Asking total (USD)', 'Estimated total (USD)'],
      ...items.filter(i => matchesAge(days(i.createdAt))).map(i => [i.id, i.name, i.setNumber ?? '', i.sku ?? '', i.client?.name ?? '', i.status, i.quantity, days(i.createdAt), i.askingPrice == null ? '' : money(i.askingPrice), i.estimatedValue == null ? '' : money(i.estimatedValue), money(Number(i.askingPrice ?? 0) * i.quantity), money(Number(i.estimatedValue ?? 0) * i.quantity)]),
    ], `consavro-inventory-${businessId}.csv`);
  }
  const clientId = q.get('client');
  if (!clientId) return new NextResponse('Select a consignor before exporting.', { status: 400 });
  const client = await prisma.client.findFirst({ where: { businessId, id: clientId }, select: { id: true, name: true } });
  if (!client) return new NextResponse('Not found', { status: 404 });
  const [sales, payouts] = await Promise.all([
    prisma.sale.findMany({ where: { businessId, consignorId: client.id, cancelledAt: null, ...(range ? { soldAt: range } : {}) }, select: { id: true, itemName: true, soldAt: true, salePrice: true, commissionAmount: true, consignorProceeds: true, payout: { select: { id: true } } }, orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }] }),
    prisma.payout.findMany({ where: { businessId, clientId: client.id, ...(range ? { paidAt: range } : {}) }, select: { id: true, saleId: true, paidAt: true, amount: true, method: true, reference: true, sale: { select: { itemName: true } } }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] }),
  ]);
  return response([
    ['Type', 'Record ID', 'Sale ID', 'Consignor', 'Item', 'Date (UTC)', 'Gross sale (USD)', 'Commission (USD)', 'Proceeds (USD)', 'Payout (USD)', 'Payment status / method', 'Reference'],
    ...sales.map(s => ['Sale', s.id, s.id, client.name, s.itemName, s.soldAt.toISOString().slice(0, 10), money(s.salePrice), money(s.commissionAmount), money(s.consignorProceeds), '', s.payout ? 'Paid' : 'Unpaid', '']),
    ...payouts.map(p => ['Payout', p.id, p.saleId, client.name, p.sale.itemName, p.paidAt.toISOString().slice(0, 10), '', '', '', money(p.amount), p.method, p.reference ?? '']),
  ], `consavro-statement-${businessId}-${client.id}.csv`);
}
