import { Fragment } from 'react';
import Link from 'next/link';
import { Home } from 'lucide-react';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

type Crumb = { label: string; href?: string };

/** The final crumb describes the current page; preceding crumbs are links. */
export function DashboardBreadcrumbs({ items = [] }: { items?: Crumb[] }) {
  const crumbs: Crumb[] = [{ label: 'Dashboard', href: '/dashboard' }, ...items];
  return (
    <Breadcrumb className="mb-6">
      <BreadcrumbList className="gap-1.5 text-sm sm:gap-2">
        {crumbs.map((crumb, index) => (
          <Fragment key={`${index}-${crumb.label}`}>
            {index > 0 && <BreadcrumbSeparator className="text-muted-foreground/60" />}
            <BreadcrumbItem className="min-w-0">
            {index === crumbs.length - 1 ? (
              <BreadcrumbPage className="font-semibold text-foreground" >
                {index === 0 && <Home aria-hidden="true" className="mr-1.5 inline size-3.5" />}
                {crumb.label}
              </BreadcrumbPage>
            ) : (
              <Link href={crumb.href ?? '/dashboard'} className="inline-flex items-center rounded-md px-1 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                {index === 0 && <Home aria-hidden="true" className="mr-1.5 size-3.5" />}
                {crumb.label}
              </Link>
            )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
