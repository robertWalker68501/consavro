import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, Boxes, Plus, Package, Search } from 'lucide-react';
import prisma from '@/lib/prisma';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission, hasBusinessPermission } from '@/lib/business-access';
import { InventorySearchFilters } from '@/components/business/InventorySearchFilters';

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ archived?: string; q?: string; status?: string; sort?: string }> };
async function Content({ params, searchParams }: Props) {
  const { businessId } = await params;
  const { archived, q, status, sort } = await searchParams;
  const query = (q ?? '').trim().slice(0, 120);
  const statusFilter = ['IN_STOCK', 'RESERVED', 'SOLD'].includes(status ?? '') ? status as 'IN_STOCK' | 'RESERVED' | 'SOLD' : undefined;
  const sortKey = ['newest', 'oldest', 'name_asc', 'name_desc', 'quantity_desc', 'quantity_asc'].includes(sort ?? '') ? (sort ?? 'newest') : 'newest';
  const basePath = `/dashboard/businesses/${businessId}/inventory`;
  const filters = new URLSearchParams();
  if (query) filters.set('q', query);
  if (statusFilter) filters.set('status', statusFilter);
  if (sortKey !== 'newest') filters.set('sort', sortKey);
  const activeHref = `${basePath}${filters.size ? `?${filters}` : ''}`;
  const archivedFilters = new URLSearchParams(filters);
  archivedFilters.set('archived', 'true');
  const archivedHref = `${basePath}?${archivedFilters}`;
  const { business, membership } = await requireBusinessPermission(businessId, 'operations:read');
  const showArchived = archived === 'true';
  const items = await prisma.inventoryItem.findMany({
    where: {
      businessId,
      archivedAt: showArchived ? { not: null } : null,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(query ? { OR: [
        { name: { contains: query, mode: 'insensitive' as const } },
        { sku: { contains: query, mode: 'insensitive' as const } },
        { setNumber: { contains: query, mode: 'insensitive' as const } },
        { theme: { contains: query, mode: 'insensitive' as const } },
      ] } : {}),
    },
    orderBy: sortKey === 'oldest' ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
      : sortKey === 'name_asc' ? [{ name: 'asc' as const }, { id: 'asc' as const }]
      : sortKey === 'name_desc' ? [{ name: 'desc' as const }, { id: 'desc' as const }]
      : sortKey === 'quantity_desc' ? [{ quantity: 'desc' as const }, { id: 'asc' as const }]
      : sortKey === 'quantity_asc' ? [{ quantity: 'asc' as const }, { id: 'asc' as const }]
      : [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    select: { id: true, name: true, sku: true, quantity: true, status: true, setNumber: true },
  });
  return <main className="app-page">
    <DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Inventory' }]} />
    <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
      <div><div className="app-eyebrow"><span className="app-eyebrow-dot"/> {business.name}</div><h1 className="app-title">Inventory</h1><p className="app-subtitle">Organize every item in your LEGO consignment inventory.</p></div>
      <Link className="app-button" href={`/dashboard/businesses/${businessId}/lego-catalog`}><Search className="size-4"/> LEGO catalog</Link>
      {hasBusinessPermission(membership.role, 'operations:write') && <Link className="app-button" href={`/dashboard/businesses/${businessId}/inventory/new`}><Plus className="size-4"/> Add item</Link>}
    </div>
    <div className="app-panel mt-8 overflow-hidden !p-0">
      <nav aria-label="Inventory status" className="flex gap-1 border-b px-5 pt-4">
        <Link className={`app-tab ${!showArchived ? 'app-tab-active' : ''}`} aria-current={!showArchived ? 'page' : undefined} href={activeHref}>Active items</Link>
        <Link className={`app-tab ${showArchived ? 'app-tab-active' : ''}`} aria-current={showArchived ? 'page' : undefined} href={archivedHref}>Archived items</Link>
      </nav>
      <InventorySearchFilters
        businessId={businessId}
        archived={showArchived}
        query={query}
        status={statusFilter ?? ''}
        sort={sortKey}
      />
      <div className="flex items-center justify-between px-6 py-5"><div><h2 className="font-semibold">{showArchived ? 'Archived items' : 'Active items'}</h2><p className="mt-1 text-sm text-muted-foreground">{items.length} {items.length === 1 ? 'item' : 'items'}</p></div><Boxes className="size-5 text-muted-foreground"/></div>
      {items.length ? <ul className="divide-y border-t">{items.map(item => <li key={item.id}>
        <Link href={`/dashboard/businesses/${businessId}/inventory/${item.id}`} className="group flex items-center gap-4 px-6 py-4 transition hover:bg-muted/60">
          <span className="app-avatar"><Package className="size-5"/></span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium group-hover:text-primary">{item.name}</span><span className="mt-0.5 block truncate text-sm text-muted-foreground">{[item.sku ? `SKU: ${item.sku}` : null, item.setNumber ? `Set: ${item.setNumber}` : null].filter(Boolean).join(' · ') || 'No SKU or set number'}</span></span>
          <span className="hidden rounded-full border px-3 py-1 text-xs text-muted-foreground sm:inline-flex">{item.status === 'IN_STOCK' ? 'In stock' : item.status === 'RESERVED' ? 'Reserved' : 'Sold'}</span>
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">Qty {item.quantity}</span><ArrowRight className="size-4 text-muted-foreground"/>
        </Link>
      </li>)}</ul> : <div className="app-empty mx-6 mb-6"><Package className="mx-auto size-8 text-primary"/><p className="mt-3 font-semibold">No {showArchived ? 'archived' : 'active'} inventory items yet.</p><p className="mt-1 text-sm text-muted-foreground">{query || statusFilter ? 'Try a different search or status filter.' : showArchived ? 'Archived items will appear here.' : 'Add your first LEGO item to get started.'}</p></div>}
    </div>
  </main>;
}
export default function Page(props: Props) {
  return <Suspense fallback={<main role="status" className="app-page">Loading inventory…</main>}><Content {...props}/></Suspense>;
}
