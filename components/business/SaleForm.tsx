'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { FormFieldControl } from '@/components/form-fields/FormFieldControl';
import { createSaleSchema, type CreateSaleValues } from '@/lib/validations/sales';
import { createSale } from '@/app/(dashboard)/dashboard/businesses/[businessId]/sales/actions';

type ItemOption = { id: string; name: string; sku: string | null; setNumber: string | null };
export function SaleForm({ businessId, items }: { businessId: string; items: ItemOption[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const form = useForm<CreateSaleValues>({
    resolver: zodResolver(createSaleSchema),
    defaultValues: { inventoryItemId: '', salePrice: '', soldAt: (() => { const today = new Date(); return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`; })(), notes: '' },
  });
  async function submit(values: CreateSaleValues) {
    setPending(true); setError('');
    try {
      const result = await createSale(businessId, values);
      if (!result.ok) { setError(result.error); return; }
      // Clear controlled values before navigation so returning to this route cannot
      // display details from the previous transaction.
      form.reset({ inventoryItemId: '', salePrice: '', soldAt: (() => { const today = new Date(); return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`; })(), notes: '' });
      router.push(`/dashboard/businesses/${businessId}/sales/${result.id}`);
      router.refresh();
    } catch { setError('Unable to record the sale. Please try again.'); }
    finally { setPending(false); }
  }
  return <form noValidate autoComplete="off" onSubmit={form.handleSubmit(submit)} className="app-panel mt-8 space-y-6">
    <div><h2 className="app-section-title">Sale information</h2><p className="mt-1 text-sm text-muted-foreground">Record one inventory item per transaction. Recording a sale marks the selected inventory listing as sold and sets its available quantity to zero.</p></div>
    <FormFieldControl control={form.control} name="inventoryItemId" label="Inventory item" type="select" required placeholder="Select an available item" options={items.map(item => ({ value: item.id, label: [item.name, item.setNumber ? `Set ${item.setNumber}` : null, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(' · ') }))} />
    <div className="grid gap-4 sm:grid-cols-2">
      <FormFieldControl control={form.control} name="salePrice" label="Sale price (USD)" type="text" inputMode="decimal" placeholder="e.g. 149.99" required />
      <FormFieldControl control={form.control} name="soldAt" label="Sale date" type="date" required />
    </div>
    <FormFieldControl control={form.control} name="notes" label="Notes" type="textarea" rows={4} placeholder="Optional transaction notes" />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending || !items.length}>{pending ? 'Recording…' : 'Record sale'}</Button>
    {!items.length && <p className="text-sm text-muted-foreground">Add an active inventory item with quantity greater than zero to record a sale.</p>}
  </form>;
}
