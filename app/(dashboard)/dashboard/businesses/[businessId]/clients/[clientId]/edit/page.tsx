import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { ClientForm } from '@/components/business/ClientForm';

type Props = { params: Promise<{ businessId: string; clientId: string }> };
async function Content({ params }: Props) {
  const { businessId, clientId } = await params;
  await requireBusinessPermission(businessId, 'operations:write');
  const client = await prisma.client.findFirst({ where: { id: clientId, businessId, archivedAt: null } });
  if (!client) notFound();
  return <main className="app-page max-w-3xl">
    <DashboardBreadcrumbs items={[{ label: "Business", href: `/dashboard/businesses/${businessId}` }, { label: "Clients", href: `/dashboard/businesses/${businessId}/clients` }, { label: client.name, href: `/dashboard/businesses/${businessId}/clients/${clientId}` }, { label: "Edit" }]} />
    <h1 className="app-title mt-5">Edit client</h1>
    <ClientForm businessId={businessId} client={{ ...client, commissionRateOverride: client.commissionRateOverride?.toString() ?? null }} />
  </main>;
}
export default function Page(props: Props) {
  return <Suspense fallback={<main role="status" className="p-12">Loading…</main>}><Content {...props} /></Suspense>;
}
