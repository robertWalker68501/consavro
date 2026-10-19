import { Suspense } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import { DashboardBreadcrumbs } from '@/components/navigation/DashboardBreadcrumbs';
import { requireBusinessRole } from '@/lib/business-access';
import prisma from '@/lib/prisma';

type Props = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ category?: string; page?: string }>;
};
const categories = ['all', 'inventory', 'sales', 'payouts'] as const;
type Category = (typeof categories)[number];
const pageSize = 25;

async function ActivityContent({ params, searchParams }: Props) {
  const { businessId } = await params;
  // History is an operational management view. STAFF and nonmembers get a 404.
  await requireBusinessRole(businessId, ['OWNER', 'MANAGER']);
  const query = await searchParams;
  const category: Category = categories.includes(query.category as Category)
    ? query.category as Category : 'all';
  const requestedPage = Number(query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 100) : 1;
  const events = await prisma.businessActivityEvent.findMany({
    where: { businessId, ...(category === 'all' ? {} : { category }) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
  });
  const hasNext = events.length > pageSize;
  const visibleEvents = events.slice(0, pageSize);
  const base = `/dashboard/businesses/${businessId}/activity`;
  const url = (selected: Category, targetPage: number) =>
    `${base}?category=${selected}&page=${targetPage}`;

  return <main className="app-page">
    <DashboardBreadcrumbs items={[
      { label: 'Business', href: `/dashboard/businesses/${businessId}` },
      { label: 'Activity history' },
    ]} />
    <div className="app-eyebrow"><span className="app-eyebrow-dot" /> OPERATIONS</div>
    <h1 className="app-title">Activity history</h1>
    <p className="app-subtitle">A record of inventory, sales, and payout actions. Notification preferences do not affect this history.</p>
    <nav aria-label="Activity filters" className="mt-8 flex flex-wrap gap-2">
      {categories.map(option =>
        <Link key={option} href={url(option, 1)} aria-current={category === option ? 'page' : undefined}
          className={`rounded-md border px-4 py-2 text-sm capitalize ${category === option ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
          {option}
        </Link>,
      )}
    </nav>
    {visibleEvents.length === 0 ?
      <div className="app-empty mt-6"><History className="mx-auto size-9 text-primary" />
        <h2 className="mt-4 text-lg font-semibold">No activity yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">Business activity will appear here as operations are recorded.</p>
      </div> :
      <ol className="mt-6 space-y-3" aria-label="Business activity events">
        {visibleEvents.map(event =>
          <li key={event.id} className="app-panel" data-testid="activity-event">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="font-semibold">{event.title}</h2>
              <span className="rounded-md border px-2 py-1 text-xs capitalize text-muted-foreground">{event.category}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{event.message}</p>
            <p className="mt-2 text-sm">By <span className="font-medium">{event.actorName}</span>
              {' · '}<time dateTime={event.createdAt.toISOString()}>{event.createdAt.toLocaleString('en-US')}</time>
            </p>
            {event.href?.startsWith(`/dashboard/businesses/${businessId}/`) &&
              <Link className="mt-2 inline-block text-sm font-medium text-primary hover:underline" href={event.href}>View details</Link>}
          </li>,
        )}
      </ol>}
    <nav aria-label="Activity pages" className="mt-6 flex items-center gap-4 text-sm">
      {page > 1 && <Link className="underline" href={url(category, page - 1)}>Previous</Link>}
      <span>Page {page}</span>
      {hasNext && <Link className="underline" href={url(category, page + 1)}>Next</Link>}
    </nav>
  </main>;
}

export default function ActivityHistoryPage(props: Props) {
  return <Suspense fallback={<main className="app-page" role="status">Loading activity…</main>}>
    <ActivityContent {...props} />
  </Suspense>;
}
