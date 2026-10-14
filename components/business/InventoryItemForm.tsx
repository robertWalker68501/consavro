'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { FormFieldControl } from '@/components/form-fields/FormFieldControl';
import { inventoryItemSchema, type InventoryItemValues } from '@/lib/validations/inventory';
import { createInventoryItem, updateInventoryItem } from '@/app/(dashboard)/dashboard/businesses/[businessId]/inventory/actions';

type Item = { id: string; name: string; sku: string | null; quantity: number; description: string | null };
export function InventoryItemForm({ businessId, item }: { businessId: string; item?: Item }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const form = useForm<InventoryItemValues>({
    resolver: zodResolver(inventoryItemSchema),
    defaultValues: {
      name: item?.name ?? '',
      sku: item?.sku ?? '',
      quantity: item?.quantity ?? 1,
      description: item?.description ?? '',
    },
  });
  async function submit(values: InventoryItemValues) {
    setError('');
    setPending(true);
    try {
      const result = item
        ? await updateInventoryItem(businessId, item.id, values)
        : await createInventoryItem(businessId, values);
      if (!result.ok) { setError(result.error); return; }
      if (!item) form.reset({ name: '', sku: '', quantity: 1, description: '' });
      router.push(`/dashboard/businesses/${businessId}/inventory${item ? `/${item.id}` : ''}`);
      router.refresh();
    } catch {
      setError('Unable to save inventory item. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return <form noValidate onSubmit={form.handleSubmit(submit)} className="app-panel mt-8 space-y-6">
    <div>
      <h2 className="app-section-title">Item information</h2>
      <p className="mt-1 text-sm text-muted-foreground">Start with the basics. LEGO set details and consignor assignment are coming next.</p>
    </div>
    <FormFieldControl control={form.control} name="name" label="Item name" type="text" autoComplete="off" placeholder="e.g. LEGO Creator Expert Bookshop" required />
    <div className="grid gap-4 sm:grid-cols-2">
      <FormFieldControl control={form.control} name="sku" label="Internal SKU" type="text" placeholder="Optional reference" />
      <FormFieldControl control={form.control} name="quantity" label="Quantity" type="number" min={0} step={1} required />
    </div>
    <FormFieldControl control={form.control} name="description" label="Description" type="textarea" rows={4} placeholder="Optional internal notes about this item" />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>{pending ? 'Saving…' : item ? 'Save changes' : 'Create item'}</Button>
  </form>;
}
