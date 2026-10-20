import { Suspense } from 'react';
import { listCatalogForManagement } from '@/lib/lego-catalog/admin';
import { CatalogEditor } from '@/components/lego-catalog/CatalogEditor';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';

async function Content() {
  const entries = await listCatalogForManagement();
  return <main className="app-page max-w-4xl"><DashboardBreadcrumbs items={[{ label: 'LEGO Catalog Management' }]} /><h1 className="app-title">LEGO catalog management</h1>
    <p className="app-subtitle mb-6">Shared product data. Inventory details remain business-specific.</p>
    <CatalogEditor entries={entries}/></main>;
}
export default function Page() {
  return <Suspense fallback={<main role="status" className="app-page">Loading catalog management…</main>}><Content/></Suspense>;
}
