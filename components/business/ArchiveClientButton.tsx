'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { archiveClient } from '@/app/(dashboard)/dashboard/businesses/[businessId]/clients/actions';

export function ArchiveClientButton({ businessId, clientId }: { businessId: string; clientId: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function archive() {
    if (!window.confirm('Archive this client? The record will be retained.')) return;
    setPending(true);
    setError('');
    try {
      const result = await archiveClient(businessId, clientId);
      if (!result.ok) { setError(result.error); return; }
      router.push(`/dashboard/businesses/${businessId}/clients`);
      router.refresh();
    } catch { setError('Unable to archive client.'); }
    finally { setPending(false); }
  }
  return <div className="space-y-2">
    <Button variant="outline" type="button" disabled={pending} onClick={() => void archive()}>{pending ? 'Archiving…' : 'Archive client'}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
