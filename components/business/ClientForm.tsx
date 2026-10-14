'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormFieldControl } from '@/components/form-fields/FormFieldControl';
import { Button } from '@/components/ui/button';
import { clientSchema, type ClientValues } from '@/lib/validations/client';
import { createClient, updateClient } from '@/app/(dashboard)/dashboard/businesses/[businessId]/clients/actions';

type ClientForForm = { id: string; name: string } & Partial<Record<Exclude<keyof ClientValues, 'name'>, string | null>>;

export function ClientForm({ businessId, client }: { businessId: string; client?: ClientForForm }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const form = useForm<ClientValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client?.name ?? '',
      email: client?.email ?? '',
      phone: client?.phone ?? '',
      addressLine1: client?.addressLine1 ?? '',
      addressLine2: client?.addressLine2 ?? '',
      city: client?.city ?? '',
      state: client?.state ?? '',
      postalCode: client?.postalCode ?? '',
      country: client?.country ?? '',
      notes: client?.notes ?? '',
      commissionRateOverride: client?.commissionRateOverride ?? '',
    },
  });

  async function submit(values: ClientValues) {
    setError('');
    setPending(true);
    try {
      const result = client
        ? await updateClient(businessId, client.id, values)
        : await createClient(businessId, values);
      if (!result.ok) { setError(result.error); return; }
      if (!client) form.reset();
      router.push(`/dashboard/businesses/${businessId}/clients${client ? `/${client.id}` : ''}`);
      router.refresh();
    } catch {
      setError('Unable to save client. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return <form noValidate onSubmit={form.handleSubmit(submit)} className="app-panel mt-8 space-y-7">
    <section className="space-y-4">
      <h2 className="app-section-title">Client</h2>
      <FormFieldControl control={form.control} name="name" label="Client name" type="text" autoComplete="off" placeholder="Client name" required />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormFieldControl control={form.control} name="email" label="Email" type="email" placeholder="client@example.com" />
        <FormFieldControl control={form.control} name="phone" label="Phone" type="tel" placeholder="Phone number" />
      </div>
    </section>
    <section className="space-y-4">
      <h2 className="app-section-title">Mailing address</h2>
      <FormFieldControl control={form.control} name="addressLine1" label="Street address" type="text" />
      <FormFieldControl control={form.control} name="addressLine2" label="Apartment or suite" type="text" />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormFieldControl control={form.control} name="city" label="City" type="text" />
        <FormFieldControl control={form.control} name="state" label="State or region" type="text" />
        <FormFieldControl control={form.control} name="postalCode" label="Postal code" type="text" />
        <FormFieldControl control={form.control} name="country" label="Country" type="text" />
      </div>
    </section>
    <section className="space-y-4">
      <h2 className="app-section-title">Commission policy</h2>
      <p className="text-sm text-muted-foreground">Leave blank to inherit the business default. This percentage is retained by the business; the remainder belongs to the consignor.</p>
      <FormFieldControl control={form.control} name="commissionRateOverride" label="Client commission override (%)" type="number" min={0} max={100} step="0.01" placeholder="Use business default" />
    </section>
    <section className="space-y-4">
      <h2 className="app-section-title">Internal notes</h2>
      <FormFieldControl control={form.control} name="notes" label="Notes" type="textarea" rows={5} placeholder="Private consignment notes" />
    </section>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>{pending ? 'Saving…' : client ? 'Save changes' : 'Create client'}</Button>
  </form>;
}
