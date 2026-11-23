import { CHECKLIST_KINDS, type Checklist, type ChecklistKind } from '@projectbench/core/schemas';
import { useId, useState, type FormEvent } from 'react';
import { inputClass, Field, Sheet } from '../components/Sheet.tsx';
import { KIND_META } from '../lib/format.ts';

interface Props {
  /** Existing checklist to edit, or undefined to create one. */
  checklist?: Checklist;
  index?: number;
  count?: number;
  onSave: (data: { title: string; kind: ChecklistKind }) => void;
  onMove?: (position: number) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function ChecklistSheet({ checklist, index = 0, count = 0, onSave, onMove, onDelete, onClose }: Props) {
  const [kind, setKind] = useState<ChecklistKind>(checklist?.kind ?? 'todo');
  const [title, setTitle] = useState(checklist?.title ?? KIND_META.todo.defaultTitle);
  const [confirm, setConfirm] = useState(false);
  const titleId = useId();

  const pickKind = (k: ChecklistKind) => {
    // Keep a custom title; replace a default one.
    if (Object.values(KIND_META).some((m) => m.defaultTitle === title)) setTitle(KIND_META[k].defaultTitle);
    setKind(k);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title, kind });
    onClose();
  };

  return (
    <Sheet
      title={checklist ? 'Checklist' : 'New checklist'}
      onClose={onClose}
      footer={
        <button type="submit" form="checklist-form" disabled={!title.trim()} className="h-12 w-full rounded-xl bg-accent font-semibold text-white hover:bg-accent-strong disabled:opacity-50">
          {checklist ? 'Save' : 'Add checklist'}
        </button>
      }
    >
      <form id="checklist-form" onSubmit={submit} className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-soft">Kind</legend>
          <div className="grid grid-cols-3 gap-2">
            {CHECKLIST_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => pickKind(k)}
                className={`h-11 rounded-xl text-sm ${kind === k ? 'border-2 border-accent bg-accent-soft font-semibold text-accent-ink' : 'border border-line font-medium'}`}
              >
                {KIND_META[k].label}
              </button>
            ))}
          </div>
          {checklist?.kind === 'buy' && kind !== 'buy' && checklist.items.some((i) => i.state === 'ordered') && (
            <p className="mt-2 text-xs text-warning">Ordered items will go back to open.</p>
          )}
        </fieldset>
        <Field label="Title" htmlFor={titleId}>
          <input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required className={inputClass} />
        </Field>
      </form>

      {checklist && (
        <div className="mt-6 flex flex-col gap-2">
          {count > 1 && onMove && (
            <div className="flex gap-2">
              <button type="button" disabled={index === 0} onClick={() => (onMove(index - 1), onClose())} className="h-11 flex-1 rounded-xl border border-line text-sm font-medium disabled:opacity-40">
                Move up
              </button>
              <button type="button" disabled={index === count - 1} onClick={() => (onMove(index + 1), onClose())} className="h-11 flex-1 rounded-xl border border-line text-sm font-medium disabled:opacity-40">
                Move down
              </button>
            </div>
          )}
          {onDelete &&
            (confirm ? (
              <button type="button" onClick={() => (onDelete(), onClose())} className="h-11 rounded-xl bg-danger-fill text-sm font-semibold text-white">
                Delete “{checklist.title}” and its {checklist.items.length} items
              </button>
            ) : (
              <button type="button" onClick={() => setConfirm(true)} className="h-11 rounded-xl border border-line text-sm font-semibold text-danger">
                Delete checklist
              </button>
            ))}
        </div>
      )}
    </Sheet>
  );
}
