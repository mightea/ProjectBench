import type { ChecklistItem, ChecklistKind, ItemLink, ItemState } from '@projectbench/core/schemas';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KeyboardEventHandler } from 'react';
import { BoxIcon, CheckIcon, ExternalIcon, GripIcon } from '../components/icons.tsx';
import { dueTone, dueToneClass, formatDue, formatPrice, formatQuantity } from '../lib/format.ts';

export function nextState(kind: ChecklistKind, state: ItemState): ItemState {
  if (kind === 'buy') return state === 'open' ? 'ordered' : state === 'ordered' ? 'done' : 'open';
  return state === 'done' ? 'open' : 'done';
}

export const actionLabel = (kind: ChecklistKind, state: ItemState) => {
  const next = nextState(kind, state);
  if (next === 'ordered') return 'Mark as ordered';
  if (next === 'done') return kind === 'buy' ? 'Mark as received' : kind === 'clarify' ? 'Mark as answered' : 'Mark as done';
  return 'Mark as open';
};

export function StateMark({ state }: { state: ItemState }) {
  if (state === 'done') {
    return (
      <span className="flex size-[22px] items-center justify-center rounded-full bg-accent text-white">
        <CheckIcon width={14} height={14} strokeWidth={3} />
      </span>
    );
  }
  if (state === 'ordered') {
    return (
      <span className="flex size-[22px] items-center justify-center rounded-full border-2 border-warning bg-warning-soft text-warning">
        <BoxIcon width={12} height={12} strokeWidth={3} />
      </span>
    );
  }
  return <span className="size-[22px] rounded-full border-2 border-control" />;
}

export function LinkChips({ links }: { links: ItemLink[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {links.map((l) => (
        <a
          key={l.id}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-xs ${
            l.preferred ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
          }`}
        >
          <span className="font-semibold">{l.shop ?? 'Link'}</span>
          {l.price !== null && <span className="text-muted">{formatPrice(l.price, l.currency)}</span>}
          <ExternalIcon width={11} height={11} className="text-muted" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ))}
    </div>
  );
}

export const itemShop = (item: ChecklistItem) => (item.links.find((l) => l.preferred) ?? item.links[0])?.shop ?? null;

interface Props {
  item: ChecklistItem;
  kind: ChecklistKind;
  onToggle: () => void;
  onOpen: () => void;
  className?: string;
}

export function ItemRow({ item, kind, onToggle, onOpen, className = '' }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  // Mouse drag and long-press work on the whole row; the keyboard uses the handle, shown on focus.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  const done = item.state === 'done';
  const pending = item.id.startsWith('pending-');

  const meta: string[] = [];
  if (item.state === 'ordered') {
    meta.push(
      [
        itemShop(item),
        item.orderedAt ? `ordered ${formatDue(item.orderedAt.slice(0, 10))}` : 'ordered',
        item.orderRef && `#${item.orderRef}`,
        item.expectedDate ? `arrives ${formatDue(item.expectedDate)}` : 'no ETA',
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
  if (item.state === 'done' && kind === 'buy' && item.doneAt) meta.push(`Received ${formatDue(item.doneAt.slice(0, 10))}`);

  const showLinks = kind === 'buy' && item.state === 'open' && item.links.length > 0;
  const qty = formatQuantity(item.quantity, item.unit);

  return (
    <li
      ref={setNodeRef}
      {...pointerListeners}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex touch-manipulation items-start gap-0.5 border-b border-line-soft bg-surface py-1 pr-3 pl-1 last:border-b-0 [-webkit-touch-callout:none] pointer-coarse:select-none ${isDragging ? 'relative z-10 shadow-lg' : ''} ${pending ? 'opacity-60' : ''} ${className}`}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        aria-label={`${actionLabel(kind, item.state)}: ${item.text}`}
        className="flex size-11 shrink-0 items-center justify-center"
      >
        <StateMark state={item.state} />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-[11px]">
        <button type="button" onClick={onOpen} disabled={pending} className="flex items-baseline gap-2 text-left">
          <span className={`flex-1 text-[15px] leading-snug font-medium ${done ? 'text-faint line-through' : ''}`}>{item.text}</span>
          {qty && <span className={`text-[13px] font-semibold ${done ? 'text-faint' : ''}`}>{qty}</span>}
          {item.dueDate && !done && (
            <span className={`text-xs font-semibold whitespace-nowrap ${dueToneClass[dueTone(item.dueDate)]}`}>{formatDue(item.dueDate)}</span>
          )}
        </button>
        {meta.map((m) => (
          <span key={m} className="text-xs text-muted">
            {m}
          </span>
        ))}
        {item.note && (
          <button type="button" onClick={onOpen} className="self-start rounded-lg bg-ground px-2.5 py-1.5 text-left text-[13px] leading-snug text-ink">
            {kind === 'clarify' ? <span className="font-semibold">Answer: </span> : null}
            {item.note}
          </button>
        )}
        {showLinks && <LinkChips links={item.links} />}
      </div>

      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        onKeyDown={onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined}
        aria-label={`Reorder ${item.text}`}
        className="sr-only text-muted focus:not-sr-only focus:flex focus:size-11 focus:shrink-0 focus:items-center focus:justify-center"
      >
        <GripIcon width={18} height={18} />
      </button>
    </li>
  );
}
