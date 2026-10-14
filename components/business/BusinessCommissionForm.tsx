'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormFieldControl } from '@/components/form-fields/FormFieldControl';
import { Button } from '@/components/ui/button';
import { businessCommissionSchema } from '@/lib/validations/commission';
import { updateBusinessCommission } from '@/app/(dashboard)/dashboard/businesses/[businessId]/commission/actions';
import type { z } from 'zod';

type Values = z.infer<typeof businessCommissionSchema>;
export function BusinessCommissionForm({ businessId, defaultCommissionRate }: { businessId: string; defaultCommissionRate: string }) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(businessCommissionSchema), defaultValues: { defaultCommissionRate } });
  async function submit(values: Values) {
    setPending(true); setMessage('');
    try {
      const result = await updateBusinessCommission(businessId, values);
      setMessage(result.ok ? 'Default commission saved.' : result.error);
    } catch { setMessage('Unable to save commission. Please try again.'); }
    finally { setPending(false); }
  }
  return <form noValidate onSubmit={form.handleSubmit(submit)} className="mt-8 max-w-md space-y-5">
    <p className="text-sm text-muted-foreground">The percentage of each sale retained by your business. Clients without an override inherit this rate. Future sales must snapshot their applied rate.</p>
    <FormFieldControl control={form.control} name="defaultCommissionRate" label="Default business commission (%)" type="number" min={0} max={100} step="0.01" required />
    {message && <p role="status" className="text-sm">{message}</p>}
    <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save commission policy'}</Button>
  </form>;
}
