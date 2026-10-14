import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { requireBusinessPermission, hasBusinessPermission } from '@/lib/business-access';
import { ArchiveClientButton } from '@/components/business/ArchiveClientButton';

type Props = { params: Promise<{ businessId: string; clientId: string }> };
async function Content({ params }: Props) {
  const { businessId, clientId } = await params;
  const { membership } = await requireBusinessPermission(businessId, 'operations:read');
  const client = await prisma.client.findFirst({ where: { id: clientId, businessId } });
  if (!client) notFound();
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { defaultCommissionRate: true } });
  const effectiveRate = client.commissionRateOverride ?? business.defaultCommissionRate;
  const canManage = hasBusinessPermission(membership.role, 'operations:write');
  return <main className="app-page max-w-5xl">
    <DashboardBreadcrumbs items={[{ label: "Business", href: `/dashboard/businesses/${businessId}` }, { label: "Clients", href: `/dashboard/businesses/${businessId}/clients` }, { label: client.name }]} />
    <h1 className="app-title mt-5">{client.name}</h1>
    <p className="mt-2 text-muted-foreground">{client.archivedAt ? 'Archived client' : 'Active client'}</p>
    <p className="mt-5 text-sm text-muted-foreground">Created {client.createdAt.toLocaleDateString('en-US')}</p>
    <section className="app-panel mt-8 space-y-4" aria-label="Contact information">
      <h2 className="app-section-title">Contact information</h2>
      <dl className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted-foreground">Email</dt><dd>{client.email ? <a className="underline underline-offset-4" href={`mailto:${client.email}`}>{client.email}</a> : 'Not provided'}</dd>
        <dt className="text-muted-foreground">Phone</dt><dd>{client.phone ?? 'Not provided'}</dd>
        <dt className="text-muted-foreground">Mailing address</dt>
        <dd className="whitespace-pre-line">{[
          client.addressLine1, client.addressLine2,
          [client.city, client.state, client.postalCode].filter(Boolean).join(', '),
          client.country,
        ].filter(Boolean).join('\n') || 'Not provided'}</dd>
      </dl>
    </section>
    <section className="app-panel mt-5 space-y-4" aria-label="Internal notes">
      <h2 className="app-section-title">Internal notes</h2>
      <p className="whitespace-pre-wrap">{client.notes || 'No notes added.'}</p>
    </section>

    <section className="app-panel mt-5 space-y-4" aria-label="Commission policy">
      <h2 className="app-section-title">Commission policy</h2>
      <p>Business commission: <strong>{effectiveRate.toString()}%</strong></p>
      <p className="text-sm text-muted-foreground">{client.commissionRateOverride === null ? 'Using business default' : 'Client-specific override'} · Consignor receives {(100 - Number(effectiveRate)).toFixed(2)}% before any future fees or adjustments.</p>
    </section>
    {canManage && !client.archivedAt && <div className="mt-7 flex flex-wrap items-center gap-4">
      <Link className="app-button" href={`/dashboard/businesses/${businessId}/clients/${client.id}/edit`}>Edit client</Link>
      <ArchiveClientButton businessId={businessId} clientId={client.id} />
    </div>}
  </main>;
}
export default function Page(props: Props) {
  return <Suspense fallback={<main role="status" className="p-12">Loading client…</main>}><Content {...props} /></Suspense>;
}
