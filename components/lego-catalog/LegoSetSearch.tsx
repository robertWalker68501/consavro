'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

type LegoSetResult = {
  id: string; setNumber: string; name: string; theme: string | null;
  releaseYear: number | null; pieceCount: number | null; imageUrl: string | null;
  source: string; verificationStatus: string;
};

export function LegoSetSearch({ businessId, onSelect }: {
  businessId: string;
  onSelect?: (set: LegoSetResult) => void;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LegoSetResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { setHydrated(true); }, []);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/businesses/${encodeURIComponent(businessId)}/lego-sets?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to search the catalog right now.');
        const data: { results: LegoSetResult[] } = await response.json();
        setResults(data.results);
      } catch (err) {
        if (!controller.signal.aborted) { setResults([]); setError(err instanceof Error ? err.message : 'Search failed.'); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [businessId, query]);

  function updateQuery(value: string) {
    setQuery(value);
    setSelected(null);
    setResults([]);
    setError('');
    setLoading(false);
  }

  return <section className="app-panel mt-8 space-y-4" aria-label="LEGO set catalog search" data-hydrated={hydrated ? "true" : "false"}>
    <div><h2 className="text-lg font-semibold">Find a LEGO set</h2><p className="text-sm text-muted-foreground">Search the shared catalog by set number or name.</p></div>
    <div className="relative"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true"/><Input aria-label="Search LEGO sets" placeholder="e.g. 75192-1 or Millennium Falcon" value={query} onChange={event => updateQuery(event.target.value)} className="pl-9" autoComplete="off" /></div>
    <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
      {query.trim().length < 2 ? 'Enter at least two characters to search.' : loading ? 'Searching…' : error ? error : results.length ? `${results.length} matching set${results.length === 1 ? '' : 's'}` : 'No matching sets in the local catalog. You can still add inventory manually.'}
    </div>
    {results.length > 0 && <ul className="divide-y rounded-lg border" aria-label="LEGO set search results">
      {results.map(set => <li key={set.id}>
        <button type="button" aria-pressed={selected === set.id} onClick={() => { setSelected(set.id); onSelect?.(set); }} className="flex w-full items-center gap-4 p-3 text-left transition hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-muted">
          {set.imageUrl ? <img src={set.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-16 shrink-0 rounded-md border object-contain" /> : <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">No image</span>}
          <span className="min-w-0 flex-1"><span className="block font-medium">{set.name}</span><span className="block text-sm text-muted-foreground">{[set.setNumber, set.theme, set.releaseYear, set.pieceCount === null ? null : `${set.pieceCount} pieces`].filter(Boolean).join(' · ')}</span>{set.verificationStatus !== 'VERIFIED' && <span className="text-xs text-muted-foreground">Unverified catalog entry</span>}</span>
          {selected === set.id && <span className="text-xs text-primary">Selected</span>}
        </button>
      </li>)}</ul>}
  </section>;
}
