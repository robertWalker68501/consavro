import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, Building2, Plus, Users, ShieldCheck } from 'lucide-react';
import { requireVerifiedUser } from '@/lib/business-access';
import prisma from '@/lib/prisma';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';

async function DashboardContent() {
  const user = await requireVerifiedUser();
  const memberships = await prisma.businessMember.findMany({
    where: { userId: user.id },
    include: { business: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return <main className="app-page">
    <DashboardBreadcrumbs />
    <div className="app-eyebrow"><span className="app-eyebrow-dot"/> YOUR WORKSPACE</div>
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div><h1 className="app-title">Good to see you, {user.name}</h1><p className="app-subtitle">Everything you need to manage your consignment businesses, in one place.</p></div>
      <SignOutButton />
    </div>
    <div className="mt-9 grid gap-4 sm:grid-cols-3">
      <div className="app-stat"><Building2 className="size-5 text-primary"/><div className="app-stat-number">{memberships.length}</div><p className="app-stat-label">Your businesses</p></div>
      <div className="app-stat"><Users className="size-5 text-primary"/><div className="mt-5 text-lg font-semibold">Connected</div><p className="app-stat-label">Business workspace</p></div>
      <div className="app-stat"><ShieldCheck className="size-5 text-primary"/><div className="mt-5 text-lg font-semibold">Secure</div><p className="app-stat-label">Role-based access</p></div>
    </div>
    <section className="mt-12">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="app-section-title">Your businesses</h2><p className="mt-1 text-sm text-muted-foreground">Choose a workspace to get started.</p></div><Link className="app-button" href="/dashboard/businesses/new"><Plus className="size-4"/> Create a business</Link></div>
      {memberships.length === 0 ? <div className="app-empty mt-5"><Building2 className="mx-auto size-9 text-primary"/><h3 className="mt-4 text-lg font-semibold">Your first workspace starts here</h3><p className="mt-2 text-sm text-muted-foreground">Create your first business to get started.</p><Link href="/dashboard/businesses/new" className="app-button mt-5">Create a business <ArrowRight className="size-4"/></Link></div> :
      <ul className="mt-5 grid gap-4 sm:grid-cols-2">{memberships.map(m => <li key={m.id}><Link href={`/dashboard/businesses/${m.business.id}`} className="app-tile group"><div className="app-icon"><Building2 className="size-5"/></div><div className="min-w-0 flex-1"><span className="block truncate text-lg font-semibold">{m.business.name}</span><span className="mt-1 inline-block text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.role} · Workspace</span></div><ArrowRight className="size-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary"/></Link></li>)}</ul>}
    </section>
  </main>;
}
export default function DashboardPage() { return <Suspense fallback={<main role="status" className="app-page">Loading dashboard…</main>}><DashboardContent /></Suspense>; }
