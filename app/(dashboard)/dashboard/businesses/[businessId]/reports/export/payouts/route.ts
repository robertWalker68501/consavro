import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import type { Prisma, PayoutMethod } from '@/app/generated/prisma/client';

type Context = { params: Promise<{ businessId: string }> };
const methods: readonly PayoutMethod[] = ['CASH', 'CHECK', 'BANK_TRANSFER', 'ZELLE', 'VENMO', 'OTHER'];

function validDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // Prevent user-entered values from being interpreted as spreadsheet formulas.
  const safe = /^[\s\u0000-\u001f]*[=+@-]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function GET(request: NextRequest, { params }: Context) {
  const { businessId } = await params;
  await requireBusinessPermission(businessId, 'operations:read');
  const query = request.nextUrl.searchParams;
  const client = query.get('client') || '';
  const rawMethod = query.get('method');
  const method = methods.find(m => m === rawMethod);
  const from = validDate(query.get('from'));
  const to = validDate(query.get('to'));
  const where: Prisma.PayoutWhereInput = {
    businessId,
    ...(client ? { clientId: client } : {}),
    ...(method ? { method } : {}),
    ...(from || to ? { paidAt: {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
    } } : {}),
  };
  const payouts = await prisma.payout.findMany({
    where,
    include: {
      client: { select: { name: true } },
      sale: { select: { itemName: true, soldAt: true, salePrice: true, commissionAmount: true, consignorProceeds: true } },
    },
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
  });
  const rows: unknown[][] = [
    ['Payout ID', 'Payment date (UTC)', 'Consignor', 'Inventory item', 'Payout amount (USD)', 'Payment method', 'Reference', 'Notes', 'Sale ID', 'Sale date (UTC)', 'Gross sale (USD)', 'Business commission (USD)', 'Consignor proceeds (USD)'],
    ...payouts.map(p => [
      p.id, p.paidAt.toISOString().slice(0, 10), p.client.name, p.sale.itemName,
      Number(p.amount).toFixed(2), p.method, p.reference ?? '', p.notes ?? '', p.saleId,
      p.sale.soldAt.toISOString().slice(0, 10), Number(p.sale.salePrice).toFixed(2),
      Number(p.sale.commissionAmount).toFixed(2), Number(p.sale.consignorProceeds).toFixed(2),
    ]),
  ];
  const content = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="consavro-payouts-${businessId}.csv"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
