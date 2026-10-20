import { Suspense } from 'react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { requireBusinessPermission, hasBusinessPermission } from '@/lib/business-access';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';

type Props = { params: Promise<{ businessId: string }> };
async function Content({ params }: Props) {
  const { businessId } = await params;
  const { business, membership } = await requireBusinessPermission(businessId, 'operations:read');
  const pickups = await prisma.sellerPickup.findMany({ where: { businessId }, include: { client: { select: { name: true } } }, orderBy: { scheduledAt: 'desc' } });
  return <main className="app-page"><DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Seller pickups' }]}/>
    <div className="mt-7 flex items-center justify-between gap-4"><div><h1 className="app-title">Seller pickups</h1><p className="app-subtitle">Track collections from sellers and process them at home.</p></div>{hasBusinessPermission(membership.role, 'operations:write') && <Link className="app-button" href={`/dashboard/businesses/${businessId}/pickups/new`}>New pickup</Link>}</div>
    <div className="app-panel mt-7">{pickups.length ? <ul className="divide-y">{pickups.map(p => <li key={p.id}><Link className="flex flex-wrap justify-between gap-2 py-4 hover:text-primary" href={`/dashboard/businesses/${businessId}/pickups/${p.id}`}><span className="font-medium">{p.client.name}</span><span>{p.scheduledAt.toISOString().slice(0,10)}</span><span className="text-sm">{p.status.replaceAll('_',' ')}</span></Link></li>)}</ul> : <p className="text-muted-foreground">No seller pickups yet.</p>}</div>
  </main>;
}
export default function Page(props: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading pickups…</main>}><Content {...props}/></Suspense>; }
