'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { saveCatalogSet } from '@/app/(dashboard)/dashboard/lego-catalog/manage/actions';

type Entry = { id: string; setNumber: string; name: string; theme: string | null;
  releaseYear: number | null; pieceCount: number | null; imageUrl: string | null;
  source: string; verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'NEEDS_REVIEW';
  _count: { inventoryItems: number } };

function Editor({ entry, onCancel }: { entry?: Entry; onCancel: () => void }) {
  const [state, action, pending] = useActionState(saveCatalogSet, {});
  const router = useRouter();
  useEffect(() => {
    if (state.success) {
      router.refresh();
      onCancel();
    }
  }, [state.success, router, onCancel]);
  return <form action={action} className="app-panel space-y-4" aria-label={entry ? 'Edit LEGO catalog set' : 'Add LEGO catalog set'}>
    {entry && <input type="hidden" name="id" value={entry.id}/>}
    <div className="grid gap-4 sm:grid-cols-2">
      {([['setNumber', 'Set number', entry?.setNumber ?? ''], ['name', 'Name', entry?.name ?? ''],
        ['theme', 'Theme', entry?.theme ?? ''], ['releaseYear', 'Release year', entry?.releaseYear?.toString() ?? ''],
        ['pieceCount', 'Piece count', entry?.pieceCount?.toString() ?? ''],
        ['imageUrl', 'Image URL', entry?.imageUrl ?? '']] as const).map(([key, label, value]) =>
        <label key={key} className="space-y-1 text-sm font-medium">{label}
          <input className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" name={key} defaultValue={value}
            required={key === 'setNumber' || key === 'name'} maxLength={key === 'setNumber' ? 40 : key === 'name' ? 200 : undefined}
            type={key === 'releaseYear' || key === 'pieceCount' ? 'number' : key === 'imageUrl' ? 'url' : 'text'} />
        </label>)}
    </div>
    <label className="block space-y-1 text-sm font-medium">Verification status
      <select name="verificationStatus" defaultValue={entry?.verificationStatus ?? 'UNVERIFIED'} className="flex h-9 w-full rounded-md border bg-background px-3 text-sm">
        <option value="UNVERIFIED">Unverified</option><option value="NEEDS_REVIEW">Needs review</option><option value="VERIFIED">Verified</option>
      </select>
    </label>
    {entry && <p className="text-sm text-muted-foreground">Source: {entry.source}. Linked inventory items: {entry._count.inventoryItems}. Changes will not overwrite inventory values.</p>}
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state.success && <p role="status" className="text-sm">{state.success} Refresh to see the updated catalog list.</p>}
    <div className="flex gap-2"><button disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">{pending ? 'Saving…' : 'Save set'}</button>
      <button type="button" onClick={onCancel} className="rounded-md border px-4 py-2 text-sm">Cancel</button></div>
  </form>;
}

export function CatalogEditor({ entries }: { entries: Entry[] }) {
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const closeEditor = () => setEditing(null);
  return <div className="space-y-5">
    <button type="button" onClick={() => setEditing('new')} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Add missing LEGO set</button>
    {editing && <Editor key={editing === 'new' ? 'new' : editing.id} entry={editing === 'new' ? undefined : editing} onCancel={closeEditor}/>}
    <div className="divide-y rounded-lg border">{entries.map(entry => <div key={entry.id} className="flex items-center justify-between gap-3 p-3">
      <div><p className="font-medium">{entry.setNumber} — {entry.name}</p><p className="text-sm text-muted-foreground">{entry.theme ?? 'No theme'} · {entry.verificationStatus} · {entry._count.inventoryItems} linked inventory items</p></div>
      <button type="button" onClick={() => setEditing(entry)} className="shrink-0 rounded-md border px-3 py-1.5 text-sm">Edit</button>
    </div>)}{entries.length === 0 && <p className="p-4 text-sm text-muted-foreground">No catalog records yet.</p>}</div>
  </div>;
}
