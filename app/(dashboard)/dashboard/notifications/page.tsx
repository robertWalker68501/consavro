import { Suspense } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Settings2 } from 'lucide-react';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireVerifiedUser } from '@/lib/business-access';
import { listNotifications } from '@/lib/notifications';
import { markAllNotificationsRead, setNotificationRead } from './actions';

type Props = { searchParams: Promise<{ filter?: string }> };

async function NotificationContent({ searchParams }: Props) {
  const user = await requireVerifiedUser();
  const unreadOnly = (await searchParams).filter === 'unread';
  const notifications = await listNotifications(user.id, unreadOnly);
  return <main className="app-page">
    <DashboardBreadcrumbs items={[{ label: 'Notifications' }]} />
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><div className="app-eyebrow"><span className="app-eyebrow-dot"/> YOUR UPDATES</div><h1 className="app-title">Notifications</h1><p className="app-subtitle">Updates for your account and business workspaces.</p></div>
      <div className="flex flex-wrap items-center gap-3"><Link href="/dashboard/notifications/preferences" className="app-button"><Settings2 className="size-4"/> Preferences</Link><form action={markAllNotificationsRead}><button type="submit" className="app-button"><CheckCheck className="size-4"/> Mark all as read</button></form></div>
    </div>
    <nav aria-label="Notification filters" className="mt-8 flex gap-3 text-sm">
      <Link href="/dashboard/notifications" aria-current={!unreadOnly ? 'page' : undefined} className={`rounded-md border px-4 py-2 ${!unreadOnly ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>All</Link>
      <Link href="/dashboard/notifications?filter=unread" aria-current={unreadOnly ? 'page' : undefined} className={`rounded-md border px-4 py-2 ${unreadOnly ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>Unread</Link>
    </nav>
    {notifications.length === 0 ? <div className="app-empty mt-6"><Bell className="mx-auto size-9 text-primary"/><h2 className="mt-4 text-lg font-semibold">{unreadOnly ? 'All caught up' : 'No notifications yet'}</h2><p className="mt-2 text-sm text-muted-foreground">{unreadOnly ? 'You have no unread notifications.' : 'Important updates will appear here.'}</p></div> :
      <ul className="mt-6 space-y-3">{notifications.map(notification => <li key={notification.id} className={`app-panel flex flex-wrap items-start gap-4 ${notification.readAt ? '' : 'border-primary/40'}`}>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="font-semibold">{notification.title}</h2>{!notification.readAt && <span className="size-2 rounded-full bg-primary" aria-label="Unread"/>}</div><p className="mt-1 text-sm text-muted-foreground">{notification.message}</p><time className="mt-2 block text-xs text-muted-foreground" dateTime={notification.createdAt.toISOString()}>{notification.createdAt.toLocaleString('en-US')}</time>{notification.href?.startsWith('/dashboard/') && !notification.href.startsWith('//') && <Link href={notification.href} className="mt-2 inline-block text-sm font-medium text-primary hover:underline">View details</Link>}</div>
        <form action={setNotificationRead}><input type="hidden" name="id" value={notification.id}/><input type="hidden" name="read" value={String(!notification.readAt)}/><button type="submit" className="rounded-md border px-3 py-2 text-sm hover:bg-muted">{notification.readAt ? 'Mark unread' : 'Mark read'}</button></form>
      </li>)}</ul>}
  </main>;
}
export default function NotificationsPage(props: Props) { return <Suspense fallback={<main className="app-page" role="status">Loading notifications…</main>}><NotificationContent {...props}/></Suspense>; }
