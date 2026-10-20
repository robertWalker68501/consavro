import { Suspense } from 'react';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessPermission } from '@/lib/business-access';
import { LegoSetSearch } from '@/components/lego-catalog/LegoSetSearch';

type Props = { params: Promise<{ businessId: string }> };
async function Content({ params }: Props) {
  const { businessId } = await params;
  const { business } = await requireBusinessPermission(businessId, 'operations:read');
  return <main className="app-page max-w-3xl">
    <DashboardBreadcrumbs items={[{ label: business.name, href: `/dashboard/businesses/${businessId}` }, { label: 'Inventory', href: `/dashboard/businesses/${businessId}/inventory` }, { label: 'LEGO catalog' }]} />
    <h1 className="app-title mt-5">LEGO set catalog</h1>
    <p className="app-subtitle">Identify sets from the shared catalog. Inventory integration is coming next.</p>
    <LegoSetSearch businessId={businessId}/>
  </main>;
}
export default function Page(props: Props) {
  return <Suspense fallback={<main role="status" className="app-page">Loading LEGO catalog…</main>}><Content {...props}/></Suspense>;
}
