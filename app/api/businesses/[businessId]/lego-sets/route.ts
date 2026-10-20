import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessPermission } from '@/lib/business-access';
import { searchLegoSets } from '@/lib/lego-catalog/search';

export async function GET(request: NextRequest, context: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await context.params;
  await requireBusinessPermission(businessId, 'operations:read');
  const query = request.nextUrl.searchParams.get('q') ?? '';
  if (query.length > 100) return NextResponse.json({ error: 'Search query is too long.' }, { status: 400 });
  const results = await searchLegoSets(query);
  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'private, no-store' } });
}
