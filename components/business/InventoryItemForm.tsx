'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { LegoSetSearch } from '@/components/lego-catalog/LegoSetSearch';
import { FormFieldControl } from '@/components/form-fields/FormFieldControl';
import { inventoryItemSchema, type InventoryItemValues, type ParsedInventoryItemValues } from '@/lib/validations/inventory';
import { createInventoryItem, updateInventoryItem } from '@/app/(dashboard)/dashboard/businesses/[businessId]/inventory/actions';

type Item = { legoSetId: string | null; id: string; name: string; sku: string | null; quantity: number; status: 'IN_STOCK' | 'RESERVED' | 'SOLD'; description: string | null;
  setNumber: string | null; theme: string | null; condition: string | null; completeness: string | null;
  askingPrice: string | null; estimatedValue: string | null; clientId: string | null };
type ClientOption = { id: string; name: string; archivedAt: Date | null };
export function InventoryItemForm({ businessId, item, clients }: { businessId: string; item?: Item; clients: ClientOption[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [catalogSelection, setCatalogSelection] = useState<{ id: string; name: string; setNumber: string } | null>(null);
  const form = useForm<InventoryItemValues, unknown, ParsedInventoryItemValues>({
    resolver: zodResolver(inventoryItemSchema),
    defaultValues: {
      name: item?.name ?? '',
      sku: item?.sku ?? '',
      quantity: item?.quantity ?? 1,
      status: item?.status ?? 'IN_STOCK',
      description: item?.description ?? '',
      setNumber: item?.setNumber ?? '',
      theme: item?.theme ?? '',
      condition: (item?.condition ?? '') as InventoryItemValues['condition'],
      completeness: (item?.completeness ?? '') as InventoryItemValues['completeness'],
      askingPrice: item?.askingPrice?.toString() ?? '',
      estimatedValue: item?.estimatedValue?.toString() ?? '',
      clientId: item?.clientId ?? '',
      legoSetId: item?.legoSetId ?? '',
    },
  });
  async function submit(values: ParsedInventoryItemValues) {
    setError('');
    setPending(true);
    try {
      const result = item
        ? await updateInventoryItem(businessId, item.id, values)
        : await createInventoryItem(businessId, values);
      if (!result.ok) { setError(result.error); return; }
      if (!item) form.reset({ name: '', sku: '', quantity: 1, status: 'IN_STOCK', description: '', setNumber: '', theme: '', condition: '', completeness: '', askingPrice: '', estimatedValue: '', clientId: '', legoSetId: '' });
      setCatalogSelection(null);
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
      <p className="mt-1 text-sm text-muted-foreground">Record the item and its LEGO set details.</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <FormFieldControl control={form.control} name="sku" label="Internal SKU" type="text" placeholder="Optional reference" />
      <FormFieldControl control={form.control} name="quantity" label="Quantity" type="number" min={0} step={1} required />
    </div>
    <label className="grid gap-2 text-sm font-medium">Inventory status
      <select aria-label="Inventory status" className="h-10 w-full rounded-md border bg-background px-3 font-normal" {...form.register('status')}>
        <option value="IN_STOCK">In stock</option><option value="RESERVED">Reserved</option><option value="SOLD">Sold</option>
      </select>
    </label>
    <FormFieldControl control={form.control} name="description" label="Description" type="textarea" rows={4} placeholder="Optional internal notes about this item" />
    <div className="border-t pt-6">
      <h2 className="app-section-title">LEGO set details</h2>
      <p className="mt-1 text-sm text-muted-foreground">Optional information about the set and its contents.</p>
    </div>
    <LegoSetSearch businessId={businessId} onSelect={set => {
      form.setValue('legoSetId', set.id, { shouldDirty: true });
      form.setValue('name', set.name.slice(0, 160), { shouldDirty: true, shouldValidate: true });
      form.setValue('setNumber', set.setNumber, { shouldDirty: true });
      form.setValue('theme', (set.theme ?? '').slice(0, 100), { shouldDirty: true });
      setCatalogSelection({ id: set.id, name: set.name, setNumber: set.setNumber });
    }}/>
    {(form.watch('legoSetId') || catalogSelection) && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
      <span>{catalogSelection ? `Linked to ${catalogSelection.name} (${catalogSelection.setNumber})` : 'Linked to a LEGO catalog record'}. You can override item details below.</span>
      <Button type="button" variant="outline" onClick={() => { form.setValue('legoSetId', '', { shouldDirty: true }); setCatalogSelection(null); }}>Unlink catalog set</Button>
    </div>}
    <FormFieldControl control={form.control} name="name" label="LEGO set name / item name" type="text" autoComplete="off" placeholder="Override the catalog name if needed" required />
    <div className="grid gap-4 sm:grid-cols-2">
      <FormFieldControl control={form.control} name="setNumber" label="LEGO set number" type="text" placeholder="e.g. 10270" />
      <FormFieldControl control={form.control} name="theme" label="LEGO theme" type="text" placeholder="e.g. Creator Expert" />
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium">Condition
        <select className="h-10 w-full rounded-md border bg-background px-3 font-normal" {...form.register('condition')}>
          <option value="">Not specified</option><option value="NEW_SEALED">New / sealed</option><option value="NEW_OPEN_BOX">New / open box</option><option value="USED">Used</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">Completeness
        <select className="h-10 w-full rounded-md border bg-background px-3 font-normal" {...form.register('completeness')}>
          <option value="">Not specified</option><option value="COMPLETE">Complete</option><option value="INCOMPLETE">Incomplete</option><option value="UNKNOWN">Unknown</option>
        </select>
      </label>
    </div>
    <div className="border-t pt-6">
      <h2 className="app-section-title">Consignment & pricing</h2>
      <p className="mt-1 text-sm text-muted-foreground">Assign an existing client as the consignor and record optional prices in USD.</p>
    </div>
    <label className="grid gap-2 text-sm font-medium">Consignor (client)
      <select className="h-10 w-full rounded-md border bg-background px-3 font-normal" {...form.register('clientId')}>
        <option value="">No consignor assigned</option>
        {clients.map(client => <option key={client.id} value={client.id} disabled={!!client.archivedAt}>{client.name}{client.archivedAt ? ' (archived)' : ''}</option>)}
      </select>
    </label>
    <div className="grid gap-4 sm:grid-cols-2">
      <FormFieldControl control={form.control} name="askingPrice" label="Asking price (USD)" type="text" inputMode="decimal" placeholder="e.g. 149.99" />
      <FormFieldControl control={form.control} name="estimatedValue" label="Estimated value (USD)" type="text" inputMode="decimal" placeholder="e.g. 125.00" />
    </div>
    {form.formState.errors.askingPrice && <p role="alert" className="text-sm text-destructive">{form.formState.errors.askingPrice.message}</p>}
    {form.formState.errors.estimatedValue && <p role="alert" className="text-sm text-destructive">{form.formState.errors.estimatedValue.message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>{pending ? 'Saving…' : item ? 'Save changes' : 'Create item'}</Button>
  </form>;
}
