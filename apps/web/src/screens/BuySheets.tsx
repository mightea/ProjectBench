import type { ItemWithContext } from '@projectbench/core/schemas';
import { useId, useState } from 'react';
import { DateField } from '../components/DateField.tsx';
import { ProjectTile } from '../components/ProjectTile.tsx';
import { Field, inputClass, Sheet } from '../components/Sheet.tsx';
import { countLabel, isCurrency, type Order, parseAmount, preferredLink, priceTotal } from '../lib/buy.ts';
import { formatPrice } from '../lib/format.ts';
import { useUpdateOrder } from '../lib/queries.ts';

type Look = (projectId: string) => { id: string; color: string | null; icon?: string | null };

const saveClass = 'h-12 w-full rounded-xl bg-accent text-[15px] font-semibold text-white hover:bg-accent-strong disabled:opacity-50';

interface FieldsProps {
  orderRef: string;
  expected: string | null;
  paid: string;
  currency: string;
  /** The sum of the item prices, as a guide. */
  estimate: string;
  onRef: (v: string) => void;
  onExpected: (v: string | null) => void;
  onPaid: (v: string) => void;
  onCurrency: (v: string) => void;
}

const paidIsValid = (paid: string, currency: string) => parseAmount(paid) !== undefined && (!paid.trim() || isCurrency(currency));

function OrderFields({ orderRef, expected, paid, currency, estimate, onRef, onExpected, onPaid, onCurrency }: FieldsProps) {
  const refId = useId();
  const dateId = useId();
  const paidId = useId();
  const valid = paidIsValid(paid, currency);
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <Field label="Order number" htmlFor={refId}>
        <input id={refId} value={orderRef} maxLength={100} onChange={(e) => onRef(e.target.value)} placeholder="Optional" className={inputClass} />
      </Field>
      <Field label="Arrives" htmlFor={dateId}>
        <DateField id={dateId} value={expected} onCommit={onExpected} clearLabel="Clear delivery date" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Total paid" htmlFor={paidId} hint={estimate ? `Item prices add up to ${estimate}. Include shipping and fees.` : 'For the whole order, with shipping and fees.'}>
          <div className="flex gap-2">
            <input id={paidId} inputMode="decimal" value={paid} onChange={(e) => onPaid(e.target.value)} placeholder="Optional" aria-invalid={!valid} className={inputClass} />
            <div className="w-24 shrink-0">
              <input aria-label="Currency" value={currency} maxLength={3} onChange={(e) => onCurrency(e.target.value.toUpperCase())} className={inputClass} />
            </div>
          </div>
        </Field>
        {!valid && (
          <p role="alert" className="pt-1.5 text-xs text-danger">
            Enter an amount like 112.30 and a three-letter currency.
          </p>
        )}
      </div>
    </div>
  );
}

/** Moves the chosen items of one shop to "On the way". */
export function MarkOrderedSheet({ shop, items, look, onClose }: { shop: string; items: ItemWithContext[]; look: Look; onClose: () => void }) {
  const [selected, setSelected] = useState(() => new Set(items.map((i) => i.id)));
  const [orderRef, setOrderRef] = useState('');
  const [expected, setExpected] = useState<string | null>(null);
  const [paid, setPaid] = useState('');
  const [currency, setCurrency] = useState(() => items.map((i) => preferredLink(i)?.currency).find(Boolean) ?? 'CHF');
  const update = useUpdateOrder();
  const chosen = items.filter((i) => selected.has(i.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  };

  const save = () => {
    const paidTotal = parseAmount(paid) ?? null;
    update.mutate(
      {
        items: chosen,
        patch: { state: 'ordered', orderRef: orderRef.trim() || null, expectedDate: expected, paidTotal, paidCurrency: paidTotal === null ? null : currency.trim() },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Sheet
      title={`Ordered at ${shop}`}
      onClose={onClose}
      footer={
        <button type="button" onClick={save} disabled={chosen.length === 0 || update.isPending || !paidIsValid(paid, currency)} className={saveClass}>
          Mark {countLabel(chosen.length)} ordered{chosen.length ? ` · ${priceTotal(chosen)}`.replace(/ · $/, '') : ''}
        </button>
      }
    >
      <div className="flex flex-col gap-3.5 pb-1">
        <p className="text-[13px] text-muted">Moves the checked items to On the way.</p>
        <fieldset className="overflow-hidden rounded-[14px] border border-line">
          <legend className="sr-only">Items in this order</legend>
          {items.map((item) => {
            const link = preferredLink(item);
            return (
              <label key={item.id} className="flex min-h-13 items-center gap-3 border-b border-line-soft px-3.5 py-1 last:border-b-0">
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="size-[22px] shrink-0 accent-accent" />
                <ProjectTile project={look(item.projectId)} size={14} />
                <span className="min-w-0 flex-1 text-sm leading-snug">{item.text}</span>
                {link?.price != null && <span className="text-sm font-semibold whitespace-nowrap">{formatPrice(link.price * (item.quantity ?? 1), link.currency)}</span>}
              </label>
            );
          })}
        </fieldset>
        <OrderFields orderRef={orderRef} expected={expected} paid={paid} currency={currency} estimate={priceTotal(chosen)} onRef={setOrderRef} onExpected={setExpected} onPaid={setPaid} onCurrency={setCurrency} />
        {update.isError && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {update.error.message}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** Edits the order number, delivery date and amount paid of a whole order. */
export function OrderDetailsSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const [orderRef, setOrderRef] = useState(order.orderRef ?? '');
  const [expected, setExpected] = useState(order.expectedDate);
  const [paid, setPaid] = useState(order.paidTotal?.toFixed(2) ?? '');
  const [currency, setCurrency] = useState(order.paidCurrency ?? order.items.map((i) => preferredLink(i)?.currency).find(Boolean) ?? 'CHF');
  const update = useUpdateOrder();
  // Only what changed: items of one order can have different delivery dates.
  const save = () => {
    const ref = orderRef.trim() || null;
    const paidTotal = parseAmount(paid) ?? null;
    const paidCurrency = paidTotal === null ? null : currency.trim();
    const patch = {
      ...(ref !== order.orderRef && { orderRef: ref }),
      ...(expected !== order.expectedDate && { expectedDate: expected }),
      ...((paidTotal !== order.paidTotal || paidCurrency !== order.paidCurrency) && { paidTotal, paidCurrency }),
    };
    if (Object.keys(patch).length === 0) onClose();
    else update.mutate({ items: order.items, patch }, { onSuccess: onClose });
  };

  return (
    <Sheet
      title={`${order.shop ?? 'Order'} · ${countLabel(order.items.length)}`}
      onClose={onClose}
      footer={
        <button type="button" onClick={save} disabled={update.isPending || !paidIsValid(paid, currency)} className={saveClass}>
          Save
        </button>
      }
    >
      <div className="flex flex-col gap-3.5 pb-1">
        <OrderFields orderRef={orderRef} expected={expected} paid={paid} currency={currency} estimate={priceTotal(order.items)} onRef={setOrderRef} onExpected={setExpected} onPaid={setPaid} onCurrency={setCurrency} />
        {update.isError && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {update.error.message}
          </p>
        )}
      </div>
    </Sheet>
  );
}
