'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cancelSale } from '@/app/(dashboard)/dashboard/businesses/[businessId]/sales/actions';

export function CancelSaleButton({ businessId, saleId }: { businessId: string; saleId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function handleCancel() {
    if (!window.confirm('Cancel this sale and restore its inventory? The transaction will remain in history.')) return;
    setPending(true); setError('');
    try {
      const result = await cancelSale(businessId, saleId);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    } catch { setError('Unable to cancel the sale. Please try again.'); }
    finally { setPending(false); }
  }
  return <div className="mt-5 space-y-2"><Button type="button" variant="outline" disabled={pending} onClick={handleCancel}>{pending ? 'Cancelling…' : 'Cancel sale'}</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
