import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, Users, Percent, UserRound, Building2, ShieldCheck, Package, ReceiptText } from 'lucide-react';
import { requireBusinessPermission, hasBusinessPermission } from '@/lib/business-access';

type Props = { params: Promise<{ businessId: string }> };
async function BusinessContent({ params }: Props) {
  const { businessId } = await params;
  const { business, membership } = await requireBusinessPermission(businessId, 'business:read');
  const role = membership.role;
  const items = [
    { href: `/dashboard/businesses/${business.id}/inventory`, label: 'View inventory', description: 'LEGO items, quantities, and item records', icon: Package, show: true },
    { href: `/dashboard/businesses/${business.id}/sales`, label: 'View sales', description: 'Recorded transactions and sales history', icon: ReceiptText, show: true },
    { href: `/dashboard/businesses/${business.id}/clients`, label: 'View clients', description: 'Consignors, contact details, and commission rates', icon: UserRound, show: true },
    { href: `/dashboard/businesses/${business.id}/team`, label: 'View team members', description: 'Memberships, roles, and access', icon: Users, show: hasBusinessPermission(role, 'members:read') },
    { href: `/dashboard/businesses/${business.id}/commission`, label: 'Commission policy', description: 'Business-wide default commission rate', icon: Percent, show: hasBusinessPermission(role, 'business:settings') },
  ];
  return <main className="app-page">
    <DashboardBreadcrumbs items={[{ label: business.name }]} />
    <div className="app-hero mt-6"><div className="relative z-10"><div className="flex items-center gap-2 text-sm text-teal-100/85"><Building2 className="size-4"/> BUSINESS WORKSPACE</div><h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{business.name}</h1><p className="mt-3 max-w-xl text-sm text-teal-50/80">Your home for consignors, team access, and commission management.</p><span className="mt-6 inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide">Your role: {role}</span></div></div>
    <section className="mt-10" aria-label="Business access"><div className="flex items-end justify-between gap-3"><div><h2 className="app-section-title">Business workspace</h2><p className="mt-1 text-sm text-muted-foreground">Business information and operational overview are available to all members.</p></div></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">{items.filter(item => item.show).map(item => <Link key={item.href} href={item.href} className="app-tile group"><div className="app-icon"><item.icon className="size-5"/></div><div className="min-w-0 flex-1"><span className="block font-semibold">{item.label}</span><span className="mt-1 block text-sm text-muted-foreground">{item.description}</span></div><ArrowRight className="size-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary"/></Link>)}</div>
      <div className="app-panel mt-7 flex flex-wrap items-center gap-3"><ShieldCheck className="size-5 text-primary"/><div className="flex-1"><h3 className="font-semibold">Access & permissions</h3><p className="text-sm text-muted-foreground">Your available tools are based on your role in this business.</p></div></div>
      <div className="mt-5 flex flex-wrap gap-2 text-xs text-muted-foreground">{hasBusinessPermission(role, 'operations:write') && <p data-testid="operations-write-access" className="rounded-full border bg-card px-3 py-1.5">You can manage business operations.</p>}{hasBusinessPermission(role, 'members:read') && <p data-testid="members-read-access" className="rounded-full border bg-card px-3 py-1.5">You can view business team members.</p>}{hasBusinessPermission(role, 'members:manage') && <p data-testid="members-manage-access" className="rounded-full border bg-card px-3 py-1.5">You can manage business memberships.</p>}{hasBusinessPermission(role, 'business:settings') && <p data-testid="business-settings-access" className="rounded-full border bg-card px-3 py-1.5">You can manage business settings.</p>}</div>
    </section>
  </main>;
}
export default function BusinessPage({ params }: Props) { return <Suspense fallback={<main role="status" className="app-page">Loading business…</main>}><BusinessContent params={params}/></Suspense>; }
