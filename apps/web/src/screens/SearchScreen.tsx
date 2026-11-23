import type { SearchHit } from '@projectbench/core/schemas';
import { useEffect, useRef, useState } from 'react';
import { SearchIcon } from '../components/icons.tsx';
import { TagFilter } from '../components/TagFilter.tsx';
import { useOffline } from '../lib/connection.ts';
import { useSearch } from '../lib/queries.ts';
import { useTagFilter } from '../useRoute.ts';
import { appLink, type Navigate } from './DailyItem.tsx';

const GROUPS: { entity: SearchHit['entity']; label: string }[] = [
  { entity: 'project', label: 'Projects' },
  { entity: 'item', label: 'Checklist items' },
  { entity: 'note', label: 'Notes' },
];

export function SearchScreen({ navigate }: { navigate: Navigate }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const offline = useOffline();
  const [tag, setTag] = useTagFilter();
  const fullQuery = [tag && `#${tag}`, query].filter(Boolean).join(' ');
  const results = useSearch(fullQuery);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.matchMedia?.('(min-width: 768px)').matches) input.current?.focus();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);

  const hits = fullQuery ? (results.data ?? []) : [];

  return (
    <>
      <header className="flex flex-col gap-3.5 px-5 pt-6 pb-3 md:px-8 md:pt-8">
        <h1 className="font-display text-[32px] font-semibold tracking-tight">Search</h1>
        <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-muted md:max-w-md">
          <SearchIcon width={18} height={18} />
          <span className="sr-only">Search projects, tags, items and notes</span>
          <input
            ref={input}
            id="global-search"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Projects, #tags, items, notes"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none"
          />
        </label>
        <TagFilter value={tag} onChange={setTag} />
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 pb-28 md:max-w-3xl md:px-8 md:pb-10">
        {offline ? (
          <Message>Search needs a connection to the server.</Message>
        ) : !fullQuery ? (
          <Message>Search across projects, tags, checklist items and notes.</Message>
        ) : results.isError ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-danger">
            {results.error.message}
          </p>
        ) : results.isPending ? (
          <p className="px-1 py-6 text-muted">Searching…</p>
        ) : hits.length === 0 ? (
          <Message>Nothing found for “{fullQuery}”.</Message>
        ) : (
          GROUPS.map(({ entity, label }) => {
            const group = hits.filter((h) => h.entity === entity);
            if (group.length === 0) return null;
            return (
              <section key={entity} aria-label={label} className="flex flex-col gap-2">
                <h2 className="mx-1 text-[13px] font-semibold tracking-[0.06em] text-muted uppercase">{label}</h2>
                <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
                  {group.map((hit) => (
                    <li key={hit.entityId} className="border-b border-line-soft last:border-b-0">
                      <a {...appLink(`/projects/${hit.projectId}`, navigate)} className="flex min-h-11 flex-col gap-0.5 px-3.5 py-2.5 hover:bg-ground">
                        <span className="line-clamp-2 text-[15px] leading-snug font-medium">{hit.title || hit.snippet}</span>
                        {hit.title && hit.snippet && hit.snippet !== hit.title && <span className="line-clamp-2 text-[13px] text-muted">{hit.snippet}</span>}
                        {entity !== 'project' && <span className="text-xs text-muted">{hit.projectTitle}</span>}
                        {entity === 'project' && hit.tags.length > 0 && <span className="text-xs text-muted">{hit.tags.map((t) => `#${t}`).join(' ')}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </main>
    </>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-muted">{children}</p>;
}
