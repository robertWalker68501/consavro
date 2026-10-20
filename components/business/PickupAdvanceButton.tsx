"use client";
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { advancePickup } from '@/app/(dashboard)/dashboard/businesses/[businessId]/pickups/actions';
export function PickupAdvanceButton({ businessId, pickupId, status }: { businessId: string; pickupId: string; status: string }) {
  const [pending, start] = useTransition(); const [error, setError] = useState(''); const router = useRouter();
  const next: Record<string, { value: string; label: string }> = { SCHEDULED: { value: 'PICKED_UP', label: 'Mark picked up' }, PICKED_UP: { value: 'PROCESSING', label: 'Start processing' }, PROCESSING: { value: 'COMPLETED', label: 'Complete pickup' } };
  const action = next[status]; if (!action) return null;
  return <div className="mt-5"><button className="app-button" type="button" disabled={pending} onClick={() => start(async () => { const result = await advancePickup(businessId, pickupId, action.value); if (!result.ok) setError(result.error); else router.refresh(); })}>{pending ? 'Updating…' : action.label}</button>{error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}</div>;
}
