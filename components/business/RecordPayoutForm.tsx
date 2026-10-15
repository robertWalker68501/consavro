'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { recordPayout } from '@/app/(dashboard)/dashboard/businesses/[businessId]/payouts/actions';

export function RecordPayoutForm({ businessId, saleId, amount }: { businessId: string; saleId: string; amount: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [method, setMethod] = useState<'CASH' | 'CHECK' | 'BANK_TRANSFER' | 'ZELLE' | 'VENMO' | 'OTHER'>('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError('');
    try {
      const result = await recordPayout(businessId, saleId, { paidAt: date, method, reference, notes });
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    } catch { setError('Unable to record payout. Please try again.'); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border p-5">
    <h3 className="font-semibold">Record full payout — ${amount}</h3>
    <p className="text-sm text-muted-foreground">Record a payment already made to the consignor. This creates a permanent financial record.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium">Payment date<input aria-label="Payment date" className="h-10 rounded-md border bg-background px-3" type="date" required value={date} onChange={e => setDate(e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-medium">Payment method<select aria-label="Payment method" className="h-10 rounded-md border bg-background px-3" value={method} onChange={e => setMethod(e.target.value as typeof method)}><option value="CASH">Cash</option><option value="CHECK">Check</option><option value="BANK_TRANSFER">Bank transfer</option><option value="ZELLE">Zelle</option><option value="VENMO">Venmo</option><option value="OTHER">Other</option></select></label>
    </div>
    <label className="grid gap-1 text-sm font-medium">Reference (optional)<input className="h-10 rounded-md border bg-background px-3" maxLength={200} value={reference} onChange={e => setReference(e.target.value)}/></label>
    <label className="grid gap-1 text-sm font-medium">Notes (optional)<textarea className="min-h-20 rounded-md border bg-background p-3" maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)}/></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>{pending ? 'Recording…' : 'Record payout'}</Button>
  </form>;
}
