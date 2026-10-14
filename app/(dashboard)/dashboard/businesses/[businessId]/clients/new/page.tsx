import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { Suspense } from 'react';
import Link from 'next/link';
import { requireBusinessPermission } from '@/lib/business-access';
import { ClientForm } from '@/components/business/ClientForm';

type Props = { params: Promise<{ businessId: string }> };
async function Content({ params }: Props) {
  const { businessId } = await params;
  await requireBusinessPermission(businessId, 'operations:write');
  return <main className="app-page max-w-3xl">
    <DashboardBreadcrumbs items={[{ label: "Business", href: `/dashboard/businesses/${businessId}` }, { label: "Clients", href: `/dashboard/businesses/${businessId}/clients` }, { label: "Add client" }]} />
    <h1 className="app-title mt-5">Add client</h1>
    <ClientForm businessId={businessId} />
  </main>;
}
export default function Page(props: Props) {
  return <Suspense fallback={<main role="status" className="p-12">Loading…</main>}><Content {...props} /></Suspense>;
}
