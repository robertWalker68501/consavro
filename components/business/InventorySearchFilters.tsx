'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { FormFieldControl } from '@/components/form-fields/FormFieldControl';

type FilterValues = {
  q: string;
  status: string;
  sort: string;
};

type Props = {
  businessId: string;
  archived: boolean;
  query: string;
  status: string;
  sort: string;
};

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'IN_STOCK', label: 'In stock' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'SOLD', label: 'Sold' },
];

const sortOptions = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'quantity_desc', label: 'Quantity: high to low' },
  { value: 'quantity_asc', label: 'Quantity: low to high' },
];

export function InventorySearchFilters({ businessId, archived, query, status, sort }: Props) {
  const router = useRouter();
  const basePath = `/dashboard/businesses/${businessId}/inventory`;
  const form = useForm<FilterValues>({
    defaultValues: { q: query, status: status || 'all', sort },
  });

  // The form may remain mounted across App Router navigations. URL filters are
  // authoritative, including when Clear removes the q parameter.
  useEffect(() => {
    form.reset({ q: query, status: status || 'all', sort });
  }, [query, status, sort, archived, form]);

  function submit(values: FilterValues) {
    const params = new URLSearchParams();
    if (archived) params.set('archived', 'true');
    const search = values.q.trim().slice(0, 120);
    if (search) params.set('q', search);
    if (values.status !== 'all') params.set('status', values.status);
    if (values.sort !== 'newest') params.set('sort', values.sort);
    router.push(`${basePath}${params.size ? `?${params.toString()}` : ''}`);
  }

  return (
    <form role="search" onSubmit={form.handleSubmit(submit)} className="grid gap-3 border-b px-6 py-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      <FormFieldControl control={form.control} name="q" label="Search inventory" type="search" autoComplete="off" placeholder="Name, SKU, set number, theme" />
      <FormFieldControl control={form.control} name="status" label="Status" type="select" options={statusOptions} />
      <FormFieldControl control={form.control} name="sort" label="Sort by" type="select" options={sortOptions} />
      <div className="flex items-end gap-2">
        <button type="submit" className="app-button h-10">Apply</button>
        <Link href={archived ? `${basePath}?archived=true` : basePath} className="inline-flex h-10 items-center rounded-md border px-3 text-sm hover:bg-muted">Clear</Link>
      </div>
    </form>
  );
}
