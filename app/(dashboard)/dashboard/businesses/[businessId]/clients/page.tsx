import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, Plus, UserRound, Users } from 'lucide-react';
import prisma from '@/lib/prisma';
import { requireBusinessPermission, hasBusinessPermission } from '@/lib/business-access';

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ archived?: string }> };
async function Content({ params, searchParams }: Props) {
  const { businessId } = await params;
  const { archived } = await searchParams;
  const { business, membership } = await requireBusinessPermission(businessId, 'operations:read');
  const showArchived = archived === 'true';
  const clients = await prisma.client.findMany({ where: { businessId, archivedAt: showArchived ? { not: null } : null }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true, archivedAt: true } });
  return <main className="app-page">
    <DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: "Clients" }]} />
    <div className="mt-7 flex flex-wrap items-end justify-between gap-4"><div><div className="app-eyebrow"><span className="app-eyebrow-dot"/> {business.name}</div><h1 className="app-title">Clients</h1><p className="app-subtitle">Keep every consignor relationship organized in one place.</p></div>{hasBusinessPermission(membership.role, 'operations:write') && <Link className="app-button" href={`/dashboard/businesses/${businessId}/clients/new`}><Plus className="size-4"/> Add client</Link>}</div>
    <div className="app-panel mt-8 overflow-hidden !p-0">
      <nav className="flex gap-1 border-b px-5 pt-4" aria-label="Client status"><Link aria-current={!showArchived ? 'page' : undefined} className={`app-tab ${!showArchived ? 'app-tab-active' : ''}`} href={`/dashboard/businesses/${businessId}/clients`}>Active clients</Link><Link aria-current={showArchived ? 'page' : undefined} className={`app-tab ${showArchived ? 'app-tab-active' : ''}`} href="?archived=true">Archived clients</Link></nav>
      <div className="flex items-center justify-between px-6 py-5"><div><h2 className="font-semibold">{showArchived ? 'Archived clients' : 'Active clients'}</h2><p className="mt-1 text-sm text-muted-foreground">{clients.length} {clients.length === 1 ? 'client' : 'clients'}</p></div><Users className="size-5 text-muted-foreground"/></div>
      {clients.length ? <ul className="divide-y border-t">{clients.map(client => <li key={client.id}><Link className="group flex items-center gap-4 px-6 py-4 transition hover:bg-muted/60" href={`/dashboard/businesses/${businessId}/clients/${client.id}`}><span className="app-avatar"><UserRound className="size-5"/></span><span className="min-w-0 flex-1"><span className="block truncate font-medium group-hover:text-primary">{client.name}</span><span className="mt-0.5 block truncate text-sm text-muted-foreground">{client.email || 'No email provided'}</span></span><ArrowRight className="size-4 text-muted-foreground"/></Link></li>)}</ul> : <div className="app-empty mx-6 mb-6"><UserRound className="mx-auto size-8 text-primary"/><p className="mt-3 font-semibold">No {showArchived ? 'archived' : 'active'} clients yet.</p><p className="mt-1 text-sm text-muted-foreground">{showArchived ? 'Archived records will appear here.' : 'Add your first consignor to get started.'}</p></div>}
    </div>
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading clients…</main>}><Content {...props}/></Suspense>; }
