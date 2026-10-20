"use client";

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { savePickup } from '@/app/(dashboard)/dashboard/businesses/[businessId]/pickups/actions';

type ClientOption = { id: string; name: string };
type Initial = { clientId: string; date: string; location: string; notes: string };
export function SellerPickupForm({ businessId, pickupId = null, clients, initial }: { businessId: string; pickupId?: string | null; clients: ClientOption[]; initial?: Initial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10));
  const [location, setLocation] = useState(initial?.location ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return <form data-hydrated={hydrated ? "true" : "false"} className="app-panel mt-7 max-w-2xl space-y-5" onSubmit={e => {
    e.preventDefault(); setError('');
    start(async () => { const result = await savePickup(businessId, pickupId, { clientId, date, location, notes });
      if (!result.ok) { setError(result.error); return; }
      router.push(`/dashboard/businesses/${businessId}/pickups/${result.id}`); router.refresh();
    });
  }}>
    <div className="space-y-2"><label className="block text-sm font-medium" htmlFor="pickup-seller">Seller</label><select id="pickup-seller" className="w-full rounded-md border bg-background p-2" required value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Select seller</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    <div className="space-y-2"><label className="block text-sm font-medium" htmlFor="pickup-date">Pickup date</label><input id="pickup-date" className="w-full rounded-md border bg-background p-2" type="date" required value={date} onChange={e => setDate(e.target.value)}/></div>
    <div className="space-y-2"><label className="block text-sm font-medium" htmlFor="pickup-location">Pickup location (optional)</label><input id="pickup-location" className="w-full rounded-md border bg-background p-2" maxLength={500} value={location} onChange={e => setLocation(e.target.value)}/></div>
    <div className="space-y-2"><label className="block text-sm font-medium" htmlFor="pickup-notes">Notes (optional)</label><textarea id="pickup-notes" className="w-full rounded-md border bg-background p-2" rows={4} maxLength={10000} value={notes} onChange={e => setNotes(e.target.value)}/></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <button type="submit" className="app-button" disabled={pending}>{pending ? 'Saving…' : pickupId ? 'Save pickup' : 'Create pickup'}</button>
  </form>;
}
