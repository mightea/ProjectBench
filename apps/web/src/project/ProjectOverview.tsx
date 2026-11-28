import type { ChecklistItem, ChecklistKind, Note, ProjectDetail } from '@projectbench/core/schemas';
import { useState } from 'react';
import { ArrowRightIcon, CheckIcon, kindIcon } from '../components/icons.tsx';
import { formatDue } from '../lib/format.ts';
import { itemShop } from './ItemRow.tsx';

const TILES: Record<ChecklistKind, { label: string; className: string; bar: string }> = {
  buy: { label: 'Parts', className: 'text-accent-ink', bar: 'bg-accent' },
  clarify: { label: 'Questions', className: 'text-warning-ink', bar: 'bg-warning' },
  todo: { label: 'Steps', className: 'text-success', bar: 'bg-success' },
};

/** Ordered items shown on the card before "+n more". */
const ORDERED_LIMIT = 3;

function tileText(kind: ChecklistKind, items: ChecklistItem[]) {
  const open = items.filter((i) => i.state === 'open').length;
  const ordered = items.filter((i) => i.state === 'ordered').length;
  const done = items.filter((i) => i.state === 'done').length;
  const share = (n: number) => (items.length ? `${(n / items.length) * 100}%` : '0%');
  const bar = { done: share(done), ordered: share(ordered) };
  if (kind === 'buy') return { value: open, unit: 'to order', detail: ordered ? `${ordered} on the way` : `${done} received`, warn: ordered > 0, bar };
  if (kind === 'clarify') return { value: open, unit: 'open', detail: `${done} answered`, warn: false, bar };
  return { value: done, unit: `/ ${items.length}`, detail: 'done', warn: false, bar };
}

/** One tile per kind of list in the project; a tap jumps to its first checklist. */
export function OverviewTiles({ project, onJump }: { project: ProjectDetail; onJump: (checklistId: string) => void }) {
  const kinds = (['buy', 'clarify', 'todo'] as const).filter((k) => project.checklists.some((c) => c.kind === k));
  if (kinds.length === 0) return null;
  return (
    <div className="flex gap-2 lg:col-start-1 xl:row-start-2 2xl:row-start-1">
      {kinds.map((kind, index) => {
        const lists = project.checklists.filter((c) => c.kind === kind);
        const t = tileText(kind, lists.flatMap((c) => c.items));
        const Icon = kindIcon[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onJump(lists[0]!.id)}
            style={{ animationDelay: `${index * 60}ms` }}
            className="flex min-w-0 flex-1 animate-rise flex-col gap-1 rounded-[14px] border border-line bg-surface px-3 py-2.5 text-left shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-line-strong active:scale-[0.98]"
          >
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${TILES[kind].className}`}>
              <Icon width={14} height={14} strokeWidth={2.2} />
              {TILES[kind].label}
            </span>
            <span className="font-display text-[22px] leading-tight font-semibold">
              {t.value} <span className="font-sans text-[13px] font-medium text-muted">{t.unit}</span>
            </span>
            <span className={`truncate text-xs ${t.warn ? 'font-semibold text-warning-ink' : 'text-muted'}`}>{t.detail}</span>
            <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
              <span className={`meter-fill ${TILES[kind].bar}`} style={{ width: t.bar.done }} />
              <span className="meter-fill bg-ordered" style={{ width: t.bar.ordered }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The first open step. Skip only moves on for now; the order of the list stays as it is. */
export function UpNext({ project, onDone }: { project: ProjectDetail; onDone: (itemId: string) => void }) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const all = project.checklists.filter((c) => c.kind === 'todo').flatMap((c) => c.items);
  const steps = all.filter((i) => i.state === 'open' && !i.id.startsWith('pending-'));
  const step = steps.find((s) => !skipped.includes(s.id)) ?? steps[0];
  if (!step) return null;
  const after = steps.slice(steps.indexOf(step) + 1, steps.indexOf(step) + 3);
  return (
    <section aria-labelledby="up-next" className="flex animate-rise flex-col gap-2 rounded-2xl border border-(--look) bg-surface p-3.5 shadow-card">
      <div className="flex items-center gap-1.5 text-(--look-ink)">
        <ArrowRightIcon width={14} height={14} />
        <h2 id="up-next" className="text-[13px] font-semibold tracking-[0.06em] uppercase">
          Up next
        </h2>
        <span className="ml-auto text-xs text-muted">
          Step {all.indexOf(step) + 1} of {all.length}
        </span>
      </div>
      {/* Keyed, so the next step rises in when this one is done or skipped. */}
      <p key={step.id} className="animate-rise text-base leading-snug font-semibold">
        {step.text}
      </p>
      {step.note && <p className="line-clamp-3 text-[13px] leading-snug text-muted">{step.note}</p>}
      {after.length > 0 && (
        <ol className="flex flex-col gap-0.5 text-[13px] text-muted">
          {after.map((s) => (
            <li key={s.id} className="truncate">
              Then · {s.text}
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onDone(step.id)}
          className="flex h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-white transition-transform hover:bg-accent-strong active:scale-[0.97]"
        >
          <CheckIcon width={16} height={16} />
          Mark done
        </button>
        {steps.length > 1 && (
          <button
            type="button"
            onClick={() => setSkipped(skipped.length >= steps.length - 1 ? [] : [...skipped, step.id])}
            className="h-11 rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-ground"
          >
            Skip
          </button>
        )}
      </div>
    </section>
  );
}

/** Parts that are ordered but not here yet, with a one-tap "received". */
export function OnTheWay({ project, onReceived }: { project: ProjectDetail; onReceived: (itemId: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const ordered = project.checklists
    .flatMap((c) => c.items.filter((i) => i.state === 'ordered'))
    .sort((a, b) => (a.expectedDate ?? '9999').localeCompare(b.expectedDate ?? '9999'));
  if (ordered.length === 0) return null;
  const shown = showAll ? ordered : ordered.slice(0, ORDERED_LIMIT);
  return (
    <section aria-labelledby="on-the-way" className="flex animate-rise flex-col gap-1.5 rounded-2xl border border-line bg-surface p-3.5 shadow-card" style={{ animationDelay: '60ms' }}>
      <div className="flex items-center gap-2 text-warning-ink">
        <span className="ping-dot" aria-hidden="true" />
        <h2 id="on-the-way" className="text-[13px] font-semibold tracking-[0.06em] uppercase">
          On the way · {ordered.length}
        </h2>
      </div>
      <ul className="flex flex-col">
        {shown.map((item) => (
          <li key={item.id} className="flex items-center gap-2.5">
            <span className="flex min-w-0 flex-1 flex-col py-1">
              <span className="truncate text-sm font-semibold">{item.text}</span>
              <span className="truncate text-xs text-muted">
                {[itemShop(item), item.expectedDate ? `arrives ${formatDue(item.expectedDate)}` : 'no ETA'].filter(Boolean).join(' · ')}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onReceived(item.id)}
              aria-label={`Received: ${item.text}`}
              className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line text-success transition-transform hover:border-line-strong active:scale-[0.94]"
            >
              <CheckIcon width={18} height={18} />
            </button>
          </li>
        ))}
      </ul>
      {ordered.length > ORDERED_LIMIT && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="flex min-h-11 items-center self-start text-[13px] font-semibold text-accent-ink">
          Show {ordered.length - ORDERED_LIMIT} more
        </button>
      )}
    </section>
  );
}

export function LatestNote({ notes, onAll }: { notes: Note[] | undefined; onAll: () => void }) {
  if (!notes?.length) return null;
  const note = notes.reduce((latest, n) => (n.createdAt > latest.createdAt ? n : latest));
  return (
    <section aria-labelledby="latest-note" className="flex animate-rise flex-col gap-1.5 rounded-2xl border border-line bg-surface p-3.5 shadow-card" style={{ animationDelay: '120ms' }}>
      <div className="flex items-center gap-2">
        <h2 id="latest-note" className="text-[13px] font-semibold tracking-[0.06em] text-muted uppercase">
          Latest note
        </h2>
        <span className="text-xs text-muted">{formatDue(note.createdAt)}</span>
        {note.source === 'mcp' && <span className="ml-auto rounded-md bg-claude-soft px-1.5 py-0.5 text-[11px] font-semibold text-claude">via Claude</span>}
      </div>
      <p className="line-clamp-4 text-sm leading-relaxed whitespace-pre-line text-ink-soft">{note.body}</p>
      <button type="button" onClick={onAll} className="flex min-h-11 items-center self-start text-[13px] font-semibold text-accent-ink">
        All notes · {notes.length}
      </button>
    </section>
  );
}
