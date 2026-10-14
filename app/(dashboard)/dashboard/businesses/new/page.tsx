import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { Suspense } from 'react';
import { requireVerifiedUser } from '@/lib/business-access';
import { CreateBusinessForm } from '@/components/business/CreateBusinessForm';

async function Content() {
  await requireVerifiedUser();
  return (
    <main className="app-page max-w-3xl">
      <DashboardBreadcrumbs items={[{ label: 'Create a business' }]} />
      <h1 className="app-title">Create a business</h1>
      <p className="mt-2 mb-8 text-muted-foreground">You'll be the owner of this business. Team members can be added in a later step.</p>
      <CreateBusinessForm />
    </main>
  );
}
export default function Page() {
  return <Suspense fallback={<main role="status" className="px-6 py-12">Loading business setup…</main>}><Content /></Suspense>;
}
