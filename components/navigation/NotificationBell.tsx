import Link from 'next/link';
import { Bell } from 'lucide-react';
import { requireVerifiedUser } from '@/lib/business-access';
import { unreadNotificationCount } from '@/lib/notifications';

export async function NotificationBell() {
  const user = await requireVerifiedUser();
  const count = await unreadNotificationCount(user.id);
  return <Link href="/dashboard/notifications" aria-label={`Notifications${count ? `, ${count} unread` : ''}`} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
    <Bell className="size-4" aria-hidden="true"/> Notifications
    {count > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{count > 99 ? '99+' : count}</span>}
  </Link>;
}
