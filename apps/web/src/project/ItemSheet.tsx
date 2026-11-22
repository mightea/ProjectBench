import type { Checklist, ChecklistItem, ItemState } from '@projectbench/core/schemas';
import { useId, useState, type FormEvent } from 'react';
import { ExternalIcon, StarIcon, TrashIcon } from '../components/icons.tsx';
import { Field, inputClass, Sheet } from '../components/Sheet.tsx';
import { formatPrice } from '../lib/format.ts';
import type { useProjectMutations } from '../lib/queries.ts';

interface Props {
  item: ChecklistItem;
  checklists: Checklist[];
  mutations: ReturnType<typeof useProjectMutations>;
  onClose: () => void;
}

const numberOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

export function ItemSheet({ item, checklists, mutations, onClose }: Props) {
  const list = checklists.find((c) => c.id === item.checklistId)!;
  const kind = list.kind;
  const [text, setText] = useState(item.text);
  const [state, setState] = useState<ItemState>(item.state);
  const [quantity, setQuantity] = useState(item.quantity?.toString() ?? '');
  const [unit, setUnit] = useState(item.unit ?? '');
  const [dueDate, setDueDate] = useState(item.dueDate ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [orderRef, setOrderRef] = useState(item.orderRef ?? '');
  const [expectedDate, setExpectedDate] = useState(item.expectedDate ?? '');
  const [checklistId, setChecklistId] = useState(item.checklistId);
  const [newUrl, setNewUrl] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const id = {
    text: useId(),
    qty: useId(),
    unit: useId(),
    due: useId(),
    note: useId(),
    ref: useId(),
    expected: useId(),
    list: useId(),
    url: useId(),
    price: useId(),
  };

  const states: { value: ItemState; label: string }[] =
    kind === 'buy'
      ? [
          { value: 'open', label: 'To order' },
          { value: 'ordered', label: 'Ordered' },
          { value: 'done', label: 'Received' },
        ]
      : [
          { value: 'open', label: 'Open' },
          { value: 'done', label: kind === 'clarify' ? 'Answered' : 'Done' },
        ];

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    mutations.updateItem.mutate({
      id: item.id,
      text,
      state,
      quantity: numberOrNull(quantity),
      unit,
      dueDate: dueDate || null,
      note,
      ...(kind === 'buy' ? { orderRef, expectedDate: expectedDate || null } : {}),
      ...(checklistId !== item.checklistId ? { checklistId } : {}),
    });
    onClose();
  };

  const addLink = (e: FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    const url = /^https?:\/\//i.test(newUrl.trim()) ? newUrl.trim() : `https://${newUrl.trim()}`;
    mutations.addLink.mutate({ itemId: item.id, url, price: numberOrNull(newPrice) }, { onSuccess: () => (setNewUrl(''), setNewPrice('')) });
  };

  return (
    <Sheet
      title={kind === 'clarify' ? 'Question' : 'Item'}
      onClose={onClose}
      footer={
        confirmDelete ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmDelete(false)} className="h-12 flex-1 rounded-xl border border-line font-semibold">
              Keep
            </button>
            <button
              type="button"
              onClick={() => {
                mutations.deleteItem.mutate(item.id);
                onClose();
              }}
              className="h-12 flex-1 rounded-xl bg-danger font-semibold text-white"
            >
              Delete item
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete item"
              className="flex size-12 items-center justify-center rounded-xl border border-line text-danger"
            >
              <TrashIcon width={20} height={20} />
            </button>
            <button type="submit" form="item-form" disabled={!text.trim()} className="h-12 flex-1 rounded-xl bg-accent font-semibold text-white hover:bg-accent-strong disabled:opacity-50">
              Save
            </button>
          </div>
        )
      }
    >
      <form id="item-form" onSubmit={save} className="flex flex-col gap-4">
        <Field label={kind === 'clarify' ? 'Question' : 'What'} htmlFor={id.text}>
          <input id={id.text} value={text} onChange={(e) => setText(e.target.value)} required maxLength={500} className={inputClass} />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-[#3F4450]">State</legend>
          <div className="flex rounded-xl bg-line-soft p-[3px]" role="radiogroup">
            {states.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={state === s.value}
                onClick={() => setState(s.value)}
                className={`h-10 flex-1 rounded-lg text-sm ${state === s.value ? 'bg-surface font-semibold shadow-sm' : 'font-medium text-[#3F4450]'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>

        {kind === 'buy' && state === 'ordered' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Order number" htmlFor={id.ref}>
              <input id={id.ref} value={orderRef} onChange={(e) => setOrderRef(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Expected delivery" htmlFor={id.expected}>
              <input id={id.expected} type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={inputClass} />
            </Field>
          </div>
        )}

        {kind !== 'clarify' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity" htmlFor={id.qty}>
              <input id={id.qty} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Unit" htmlFor={id.unit} hint="Optional, e.g. m or kg">
              <input id={id.unit} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} className={inputClass} />
            </Field>
          </div>
        )}

        <Field label={kind === 'clarify' ? 'Answer' : 'Note'} htmlFor={id.note}>
          <textarea id={id.note} value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={`${inputClass} h-auto py-3`} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date" htmlFor={id.due}>
            <input id={id.due} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </Field>
          {checklists.length > 1 && (
            <Field label="Checklist" htmlFor={id.list}>
              <select id={id.list} value={checklistId} onChange={(e) => setChecklistId(e.target.value)} className={inputClass}>
                {checklists.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </form>

      {kind === 'buy' && (
        <section className="mt-6 flex flex-col gap-2" aria-labelledby={`${item.id}-links`}>
          <h3 id={`${item.id}-links`} className="text-[13px] font-semibold text-[#3F4450]">
            Where to buy
          </h3>
          {item.links.length === 0 && <p className="text-sm text-muted">No shop links yet.</p>}
          <ul className="flex flex-col gap-2">
            {item.links.map((l) => (
              <li
                key={l.id}
                className={`flex items-center gap-1 rounded-xl border py-1 pr-1 pl-3 ${l.preferred ? 'border-accent bg-accent-soft' : 'border-line'}`}
              >
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 flex-col py-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {l.shop ?? 'Link'}
                    {l.price !== null && <span className="font-normal text-muted">{formatPrice(l.price, l.currency)}</span>}
                    <ExternalIcon width={11} height={11} className="text-muted" />
                  </span>
                  <span className="truncate text-xs text-[#3F4450]">{l.url.replace(/^https?:\/\//, '')}</span>
                </a>
                <button
                  type="button"
                  onClick={() => mutations.updateLink.mutate({ id: l.id, preferred: true })}
                  aria-label={l.preferred ? `${l.shop ?? 'Link'} is the preferred shop` : `Prefer ${l.shop ?? 'this link'}`}
                  aria-pressed={l.preferred}
                  className={`flex size-10 items-center justify-center rounded-lg ${l.preferred ? 'text-accent' : 'text-[#A7ACB8] hover:text-muted'}`}
                >
                  <StarIcon filled={l.preferred} width={18} height={18} />
                </button>
                <button
                  type="button"
                  onClick={() => mutations.deleteLink.mutate(l.id)}
                  aria-label={`Remove link to ${l.shop ?? l.url}`}
                  className="flex size-10 items-center justify-center rounded-lg text-[#A7ACB8] hover:text-danger"
                >
                  <TrashIcon width={18} height={18} />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={addLink} className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor={id.url} className="sr-only">
                Shop link
              </label>
              <input
                id={id.url}
                type="url"
                inputMode="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="Paste a shop link"
                className={inputClass}
              />
            </div>
            <div className="w-24">
              <label htmlFor={id.price} className="sr-only">
                Price per unit
              </label>
              <input id={id.price} inputMode="decimal" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="Price" className={inputClass} />
            </div>
            <button type="submit" disabled={!newUrl.trim() || mutations.addLink.isPending} className="h-12 rounded-xl border border-line px-4 font-semibold disabled:opacity-50">
              Add
            </button>
          </form>
          {mutations.addLink.isError && (
            <p role="alert" className="text-sm text-danger">
              {mutations.addLink.error.message}
            </p>
          )}
        </section>
      )}
    </Sheet>
  );
}
