import { normalizeTag } from '@projectbench/core/schemas';
import { useState, type KeyboardEvent } from 'react';
import { useTags } from '../lib/queries.ts';
import { CloseIcon } from './icons.tsx';

const MAX_TAGS = 20;
const MAX_LENGTH = 40;

/** Tag chips with a text field. Enter or a comma adds a tag; known tags are suggested. */
export function TagInput({ id, value, onChange }: { id: string; value: string[]; onChange: (tags: string[]) => void }) {
  const known = useTags();
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);

  const add = (text: string) => {
    const incoming = text.split(',').map((t) => normalizeTag(t).slice(0, MAX_LENGTH)).filter(Boolean);
    const next = [...new Set([...value, ...incoming])].slice(0, MAX_TAGS);
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && draft.trim()) {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Enter') {
      e.preventDefault();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const wanted = normalizeTag(draft);
  const suggestions = focused
    ? (known.data ?? []).map((t) => t.name).filter((name) => !value.includes(name) && name.includes(wanted)).slice(0, 6)
    : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
        {value.map((tag) => (
          <span key={tag} className="flex h-8 items-center rounded-lg bg-accent-soft pl-2 text-[13px] font-medium text-accent-ink">
            #{tag}
            <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} aria-label={`Remove tag ${tag}`} className="flex h-8 w-7 items-center justify-center">
              <CloseIcon width={13} height={13} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          // Phone keyboards don't always report the comma as a key press.
          onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (draft.trim()) add(draft);
          }}
          placeholder={value.length ? 'Add tag' : 'Add a tag'}
          autoCapitalize="none"
          autoComplete="off"
          className="h-8 min-w-20 flex-1 bg-transparent px-1 text-[15px] text-ink outline-none placeholder:text-faint"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              // Keeps focus in the field, so several tags can be picked in a row.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(name)}
              className="h-9 rounded-lg border border-line px-2 text-[13px] font-medium text-ink-soft hover:bg-ground"
            >
              #{name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
