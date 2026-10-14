'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormFieldControl } from '@/components/form-fields/FormFieldControl';
import { Button } from '@/components/ui/button';
import { createBusinessSchema, type CreateBusinessValues } from '@/lib/validations/business';
import { createBusiness } from '@/app/(dashboard)/dashboard/businesses/new/actions';

export function CreateBusinessForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const form = useForm<CreateBusinessValues>({ resolver: zodResolver(createBusinessSchema), defaultValues: { name: '' } });

  async function onSubmit(values: CreateBusinessValues) {
    setError(''); setPending(true);
    try {
      const result = await createBusiness(values);
      if (!result.ok) { setError(result.error); return; }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Unable to create business. Please try again.');
    } finally { setPending(false); }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
      <FormFieldControl control={form.control} name="name" label="Business name" type="text" placeholder="Your consignment business" required />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create business'}</Button>
    </form>
  );
}
