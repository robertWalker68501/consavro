import { Suspense } from 'react';
import Link from 'next/link';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireVerifiedUser } from '@/lib/business-access';
import prisma from '@/lib/prisma';
import { saveNotificationPreferences } from './actions';

type Props = { searchParams: Promise<{ saved?: string }> };

async function PreferencesContent({ searchParams }: Props) {
  const user = await requireVerifiedUser();
  const preferences = await prisma.notificationPreference.findUnique({
    where: { userId: user.id },
  });
  const saved = (await searchParams).saved === '1';
  const options = [
    { name: 'inventory', label: 'Inventory', description: 'Items added, updated, or archived.' },
    { name: 'sales', label: 'Sales', description: 'Sales recorded or cancelled.' },
    { name: 'payouts', label: 'Payouts', description: 'Consignor payouts recorded.' },
  ] as const;

  return <main className="app-page">
    <DashboardBreadcrumbs items={[{ label: 'Notifications', href: '/dashboard/notifications' }, { label: 'Preferences' }]} />
    <div className="app-eyebrow"><span className="app-eyebrow-dot"/> YOUR UPDATES</div>
    <h1 className="app-title">Notification preferences</h1>
    <p className="app-subtitle">Choose which business events notify you. Changes affect future notifications only.</p>
    {saved && <p role="status" className="mt-5 text-sm text-primary">Preferences saved.</p>}
    <form action={saveNotificationPreferences} className="app-panel mt-6 max-w-2xl space-y-6">
      {options.map(option => <label key={option.name} className="flex cursor-pointer items-start justify-between gap-6">
        <span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-sm text-muted-foreground">{option.description}</span></span>
        <input type="checkbox" name={option.name} defaultChecked={preferences?.[option.name] ?? true} className="mt-1 size-5 accent-primary" />
      </label>)}
      <div className="flex flex-wrap items-center gap-3 border-t pt-5">
        <button type="submit" className="app-button">Save preferences</button>
        <Link href="/dashboard/notifications" className="text-sm text-muted-foreground hover:underline">Back to notifications</Link>
      </div>
    </form>
  </main>;
}
export default function NotificationPreferencesPage(props: Props) {
  return <Suspense fallback={<main className="app-page" role="status">Loading preferences…</main>}><PreferencesContent {...props}/></Suspense>;
}
