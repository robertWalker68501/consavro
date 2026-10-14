'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { archiveInventoryItem } from '@/app/(dashboard)/dashboard/businesses/[businessId]/inventory/actions';

export function ArchiveInventoryItemButton({ businessId, itemId }: { businessId: string; itemId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function archive() {
    if (!window.confirm('Archive this inventory item? Its record will be retained.')) return;
    setPending(true);
    setError('');
    try {
      const result = await archiveInventoryItem(businessId, itemId);
      if (!result.ok) { setError(result.error); return; }
      router.push(`/dashboard/businesses/${businessId}/inventory`);
      router.refresh();
    } catch { setError('Unable to archive inventory item.'); }
    finally { setPending(false); }
  }
  return <div className="space-y-2">
    <button type="button" className="app-button border border-border !bg-background !text-foreground hover:!bg-muted disabled:opacity-50" disabled={pending} onClick={() => void archive()}>{pending ? 'Archiving…' : 'Archive item'}</button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
