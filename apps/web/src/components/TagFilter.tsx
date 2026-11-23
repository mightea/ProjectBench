import { useTags } from '../lib/queries.ts';

/** One-tap filter by tag. Renders nothing until a project has a tag. */
export function TagFilter({ value, onChange, allCount }: { value: string | null; onChange: (tag: string | null) => void; allCount?: number }) {
  const tags = useTags();
  const names = tags.data?.map((t) => t.name) ?? [];
  if (value && !names.includes(value)) names.unshift(value);
  if (names.length === 0) return null;

  return (
    <div role="group" aria-label="Filter by tag" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {allCount !== undefined && (
        <button
          type="button"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
          className={`h-11 shrink-0 rounded-full px-3.5 text-[13px] whitespace-nowrap md:h-8 ${
            value === null ? 'bg-ink font-semibold text-surface' : 'border border-line bg-surface font-medium text-ink-soft hover:border-line-strong'
          }`}
        >
          All{value === null ? ` · ${allCount}` : ''}
        </button>
      )}
      {names.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={value === name}
          onClick={() => onChange(value === name ? null : name)}
          className={`h-11 shrink-0 rounded-full px-3 text-[13px] whitespace-nowrap md:h-8 ${
            value === name ? 'bg-accent font-semibold text-white' : 'border border-line bg-surface font-medium text-ink-soft hover:border-line-strong'
          }`}
        >
          #{name}
        </button>
      ))}
    </div>
  );
}
