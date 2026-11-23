import type { Checklist, ItemCreate } from '@projectbench/core/schemas';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useId, useState, type ClipboardEvent, type FormEvent } from 'react';
import { DotsIcon, kindIcon, PlusIcon } from '../components/icons.tsx';
import { KIND_META } from '../lib/format.ts';
import { ItemRow, nextState } from './ItemRow.tsx';

interface Props {
  checklist: Checklist;
  onAddItems: (items: ItemCreate[]) => void;
  onToggle: (itemId: string, state: Checklist['items'][number]['state']) => void;
  onMove: (itemId: string, position: number) => void;
  onOpenItem: (itemId: string) => void;
  onEdit: () => void;
}

/** "3x M3 screw" → { text: "M3 screw", quantity: 3 } */
export function parseItemLine(line: string): ItemCreate | null {
  const text = line.trim().replace(/^[-*•]\s*/, '').replace(/^\[[ x]\]\s*/i, '');
  if (!text) return null;
  const qty = text.match(/^(\d+(?:[.,]\d+)?)\s*[x×]\s+(.+)$/i);
  if (qty) return { text: qty[2]!.trim(), quantity: Number(qty[1]!.replace(',', '.')) };
  return { text };
}

export function ChecklistCard({ checklist, onAddItems, onToggle, onMove, onOpenItem, onEdit }: Props) {
  const Icon = kindIcon[checklist.kind];
  const meta = KIND_META[checklist.kind];
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const counts = {
    done: checklist.items.filter((i) => i.state === 'done').length,
    ordered: checklist.items.filter((i) => i.state === 'ordered').length,
    open: checklist.items.filter((i) => i.state === 'open').length,
  };
  const summary =
    checklist.kind === 'buy' && checklist.items.length
      ? [counts.done && `${counts.done} received`, counts.ordered && `${counts.ordered} ordered`, counts.open && `${counts.open} open`]
          .filter(Boolean)
          .join(' · ')
      : `${counts.done} / ${checklist.items.length}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const item = parseItemLine(draft);
    if (item) onAddItems([item]);
    setDraft('');
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n')) return;
    e.preventDefault();
    const items = text.split(/\r?\n/).map(parseItemLine).filter((i): i is ItemCreate => i !== null);
    if (items.length) onAddItems(items);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const to = checklist.items.findIndex((i) => i.id === over.id);
    if (to >= 0) onMove(String(active.id), to);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface" aria-labelledby={`${checklist.id}-title`}>
      <div className="flex items-center gap-2.5 border-b border-line-soft py-1.5 pr-1.5 pl-3.5">
        <span className={`flex size-[30px] items-center justify-center rounded-lg ${meta.iconClass}`}>
          <Icon width={17} height={17} strokeWidth={2} />
        </span>
        <h2 id={`${checklist.id}-title`} className="flex-1 text-[15px] font-semibold">
          {checklist.title}
        </h2>
        <span className="text-xs text-muted">{summary}</span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit checklist ${checklist.title}`}
          className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-ground"
        >
          <DotsIcon width={20} height={20} />
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={checklist.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul>
            {checklist.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                kind={checklist.kind}
                onToggle={() => onToggle(item.id, nextState(checklist.kind, item.state))}
                onOpen={() => onOpenItem(item.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <form onSubmit={submit} className={`flex h-12 items-center gap-2.5 px-3.5 text-accent-ink ${checklist.items.length ? 'border-t border-line-soft' : ''}`}>
        <PlusIcon width={20} height={20} aria-hidden="true" />
        <label htmlFor={inputId} className="sr-only">
          Add item to {checklist.title}
        </label>
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={onPaste}
          enterKeyHint="enter"
          placeholder={checklist.kind === 'buy' ? 'Add item, e.g. 3x M3 screws' : checklist.kind === 'clarify' ? 'Add a question' : 'Add a step'}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
        />
      </form>
    </section>
  );
}
