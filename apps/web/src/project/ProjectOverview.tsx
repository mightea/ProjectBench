import type { ChecklistItem, ChecklistKind, Note, ProjectDetail } from '@projectbench/core/schemas';
import { useState } from 'react';
import { kindIcon } from '../components/icons.tsx';
import { formatDue } from '../lib/format.ts';

const TILES: Record<ChecklistKind, { label: string; className: string }> = {
  buy: { label: 'Parts', className: 'text-accent-ink' },
  clarify: { label: 'Questions', className: 'text-warning-ink' },
  todo: { label: 'Steps', className: 'text-success' },
};

function tileText(kind: ChecklistKind, items: ChecklistItem[]) {
  const open = items.filter((i) => i.state === 'open').length;
  const ordered = items.filter((i) => i.state === 'ordered').length;
  const done = items.filter((i) => i.state === 'done').length;
  if (kind === 'buy') return { value: open, unit: 'to order', detail: ordered ? `${ordered} on the way` : `${done} received`, warn: ordered > 0 };
  if (kind === 'clarify') return { value: open, unit: 'open', detail: `${done} answered`, warn: false };
  return { value: done, unit: `/ ${items.length}`, detail: 'done', warn: false };
}

/** One tile per kind of list in the project; a tap jumps to its first checklist. */
export function OverviewTiles({ project, onJump }: { project: ProjectDetail; onJump: (checklistId: string) => void }) {
  const kinds = (['buy', 'clarify', 'todo'] as const).filter((k) => project.checklists.some((c) => c.kind === k));
  if (kinds.length === 0) return null;
  return (
    <div className="flex gap-2 lg:col-start-1">
      {kinds.map((kind) => {
        const lists = project.checklists.filter((c) => c.kind === kind);
        const t = tileText(kind, lists.flatMap((c) => c.items));
        const Icon = kindIcon[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onJump(lists[0]!.id)}
            className="flex min-w-0 flex-1 flex-col gap-1 rounded-[14px] border border-line bg-surface px-3 py-2.5 text-left hover:border-line-strong"
          >
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${TILES[kind].className}`}>
              <Icon width={14} height={14} strokeWidth={2.2} />
              {TILES[kind].label}
            </span>
            <span className="font-display text-[22px] leading-tight font-semibold">
              {t.value} <span className="font-sans text-[13px] font-medium text-muted">{t.unit}</span>
            </span>
            <span className={`truncate text-xs ${t.warn ? 'font-semibold text-warning-ink' : 'text-muted'}`}>{t.detail}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The first open step. Skip only moves on for now; the order of the list stays as it is. */
export function UpNext({ project, onDone }: { project: ProjectDetail; onDone: (itemId: string) => void }) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const steps = project.checklists.filter((c) => c.kind === 'todo').flatMap((c) => c.items.filter((i) => i.state === 'open' && !i.id.startsWith('pending-')));
  const step = steps.find((s) => !skipped.includes(s.id)) ?? steps[0];
  if (!step) return null;
  return (
    <section aria-labelledby="up-next" className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3.5">
      <h2 id="up-next" className="text-[13px] font-semibold tracking-[0.06em] text-(--look-ink) uppercase">
        Up next
      </h2>
      <p className="text-base leading-snug font-semibold">{step.text}</p>
      {step.note && <p className="line-clamp-3 text-[13px] leading-snug text-muted">{step.note}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => onDone(step.id)} className="h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong">
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

export function LatestNote({ notes, onAll }: { notes: Note[] | undefined; onAll: () => void }) {
  if (!notes?.length) return null;
  const note = notes.reduce((latest, n) => (n.createdAt > latest.createdAt ? n : latest));
  return (
    <section aria-labelledby="latest-note" className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface p-3.5">
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
