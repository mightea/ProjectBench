import type { BuyGroup, BuyOverview, ItemWithContext } from '@projectbench/core/schemas';
import { useState } from 'react';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { dueTone, dueToneClass, formatDue, formatPrice, formatQuantity } from '../lib/format.ts';
import { useBuyOverview } from '../lib/queries.ts';
import { LinkChips } from '../project/ItemRow.tsx';
import { appLink, DailyItem, type Navigate } from './DailyItem.tsx';

type Grouping = 'shop' | 'project';

export function totalLabel(group: Pick<BuyGroup, 'totals' | 'unpriced' | 'items'>): string {
  const sums = group.totals.map((t) => formatPrice(t.amount, t.currency));
  if (sums.length === 0) return `${group.items.length} ${group.items.length === 1 ? 'item' : 'items'}`;
  return group.unpriced ? `${sums.join(' + ')} + ${group.unpriced} unpriced` : sums.join(' + ');
}

export function BuyScreen({ navigate }: { navigate: Navigate }) {
  const buy = useBuyOverview();
  const [grouping, setGrouping] = useState<Grouping>('shop');
  const toOrder = buy.data?.byShop.reduce((n, g) => n + g.items.length, 0) ?? 0;

  return (
    <>
      <header className="flex flex-col gap-3.5 px-5 pt-6 pb-3 md:px-8 md:pt-8">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Buy</h1>
          {buy.data && (
            <span className="text-[13px] text-muted">
              {toOrder} to order · {buy.data.ordered.length} on the way
            </span>
          )}
        </div>
        <div role="group" aria-label="Group items" className="flex rounded-[10px] bg-line p-[3px] md:max-w-xs">
          {(['shop', 'project'] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={grouping === g}
              onClick={() => setGrouping(g)}
              className={`h-11 flex-1 rounded-lg text-sm ${grouping === g ? 'bg-surface font-semibold shadow-sm' : 'font-medium text-[#3F4450]'}`}
            >
              By {g}
            </button>
          ))}
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-3.5 px-4 pb-28 md:max-w-3xl md:px-8 md:pb-10">
        {buy.data ? <BuyLists data={buy.data} grouping={grouping} navigate={navigate} /> : <QueryFallback query={buy} />}
      </main>
    </>
  );
}

function BuyLists({ data, grouping, navigate }: { data: BuyOverview; grouping: Grouping; navigate: Navigate }) {
  const groups = grouping === 'shop' ? data.byShop : data.byProject;

  if (groups.length === 0 && data.ordered.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-muted">
        Nothing to buy. Items on a “To buy” checklist will show up here.
      </p>
    );
  }

  return (
    <>
      {data.ordered.length > 0 && (
        <section aria-labelledby="buy-ordered" className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between px-1">
            <h2 id="buy-ordered" className="text-[13px] font-semibold tracking-[0.06em] text-[#8A4B06] uppercase">
              On the way
            </h2>
            <span className="text-xs text-muted">tap to mark received</span>
          </div>
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {data.ordered.map((item) => (
              <DailyItem
                key={item.id}
                item={item}
                navigate={navigate}
                meta={orderedMeta(item)}
                trailing={
                  item.expectedDate && (
                    <span className={`text-xs font-semibold whitespace-nowrap ${dueToneClass[dueTone(item.expectedDate)]}`}>{formatDue(item.expectedDate)}</span>
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}

      {groups.length > 0 && <h2 className="mx-1 mt-1 -mb-1 text-[15px] font-semibold">To order</h2>}
      {groups.map((group) => (
        <section key={group.key || 'none'} aria-label={group.name ?? 'No shop yet'} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <h3 className="text-[13px] font-semibold tracking-[0.06em] text-[#3F4450] uppercase">{group.name ?? 'No shop yet'}</h3>
            <span className="text-xs whitespace-nowrap text-muted">{totalLabel(group)}</span>
          </div>
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {group.items.map((item) => (
              <ToOrderItem key={item.id} item={item} grouping={grouping} navigate={navigate} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function orderedMeta(item: ItemWithContext) {
  const shop = (item.links.find((l) => l.preferred) ?? item.links[0])?.shop;
  return [shop, item.orderRef && `#${item.orderRef}`, item.projectTitle].filter(Boolean).join(' · ');
}

function ToOrderItem({ item, grouping, navigate }: { item: ItemWithContext; grouping: Grouping; navigate: Navigate }) {
  const qty = formatQuantity(item.quantity, item.unit);
  const shop = (item.links.find((l) => l.preferred) ?? item.links[0])?.shop;
  return (
    <DailyItem
      item={item}
      navigate={navigate}
      meta={grouping === 'shop' ? item.projectTitle : (shop ?? 'No shop yet')}
      trailing={qty ? <span className="text-[13px] font-semibold">{qty}</span> : undefined}
    >
      {item.links.length > 0 ? (
        <LinkChips links={item.links} />
      ) : (
        <a
          {...appLink(`/projects/${item.projectId}`, navigate)}
          className="flex h-[30px] items-center self-start rounded-full border border-dashed border-[#A7ACB8] px-2.5 text-xs font-medium text-[#3F4450]"
        >
          + Add shop link
        </a>
      )}
    </DailyItem>
  );
}
