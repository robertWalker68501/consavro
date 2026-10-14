import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { Suspense } from 'react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { BusinessCommissionForm } from '@/components/business/BusinessCommissionForm';

type Props = { params: Promise<{ businessId: string }> };
async function Content({ params }: Props) {
  const { businessId } = await params;
  await requireBusinessPermission(businessId, 'business:settings');
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { defaultCommissionRate: true } });
  return <main className="app-page max-w-4xl">
    <DashboardBreadcrumbs items={[{ label: "Business", href: `/dashboard/businesses/${businessId}` }, { label: "Commission policy" }]} />
    <h1 className="app-title mt-5">Commission policy</h1>
    <BusinessCommissionForm businessId={businessId} defaultCommissionRate={business.defaultCommissionRate.toString()} />
  </main>;
}
export default function Page(props: Props) {
  return <Suspense fallback={<main role="status" className="p-12">Loading commission policy…</main>}><Content {...props} /></Suspense>;
}
