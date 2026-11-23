import type { BuyGroup, BuyOverview, ItemWithContext } from '@projectbench/core/schemas';
import { useState } from 'react';
import { CalendarIcon, ExternalIcon } from '../components/icons.tsx';
import { ProjectTile } from '../components/ProjectTile.tsx';
import { QueryFallback } from '../components/QueryFallback.tsx';
import { TagFilter } from '../components/TagFilter.tsx';
import { countLabel, groupOrders, type Order, orderAmount, preferredLink, priceTotal } from '../lib/buy.ts';
import { dueTone, dueToneClass, formatDue, formatPrice, formatQuantity } from '../lib/format.ts';
import { useBuyOverview, useItemState, useMarkReceived, useProjects } from '../lib/queries.ts';
import { StateMark } from '../project/ItemRow.tsx';
import { useTagFilter } from '../useRoute.ts';
import { MarkOrderedSheet, OrderDetailsSheet } from './BuySheets.tsx';
import { appLink, type Navigate } from './DailyItem.tsx';

type Tab = 'buy' | 'way';
type Look = (projectId: string) => { id: string; color: string | null; icon?: string | null };

/** Rows shown per project or order before "Show n more". */
const COLLAPSED = 3;

const heading = 'mx-1 text-xs font-semibold tracking-[0.06em] uppercase';
const card = 'overflow-hidden rounded-2xl border border-line bg-surface';

export function BuyScreen({ navigate }: { navigate: Navigate }) {
  const [tag, setTag] = useTagFilter();
  const buy = useBuyOverview(tag);
  const projects = useProjects({ status: 'open', sort: 'priority' });
  const [tab, setTab] = useState<Tab>('buy');
  const [picked, setPicked] = useState<string | null>(null);

  const look: Look = (id) => projects.data?.find((p) => p.id === id) ?? { id, color: null };
  const all = buy.data ? [...buy.data.byShop.flatMap((g) => g.items), ...buy.data.ordered] : [];
  const projectIds = [...new Set(all.map((i) => i.projectId))];
  const projectId = picked && projectIds.includes(picked) ? picked : null;
  const inView = (item: ItemWithContext) => !projectId || item.projectId === projectId;
  const toOrder = all.filter((i) => i.state === 'open' && inView(i));
  const ordered = all.filter((i) => i.state === 'ordered' && inView(i));
  const priced = priceTotal(toOrder);
  const unpriced = toOrder.filter((i) => preferredLink(i)?.price == null).length;

  return (
    <>
      <header className="flex flex-col gap-3 px-5 pt-6 pb-2.5 md:px-8 md:pt-8">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Buy</h1>
          {buy.data && (
            <span className="text-[13px] text-muted md:text-sm">
              {toOrder.length} to buy · {ordered.length} on the way
              {priced && ` · ${priced} priced`}
              {priced && unpriced > 0 && <span className="hidden xl:inline">, {unpriced} without a price</span>}
            </span>
          )}
        </div>
        <div role="tablist" aria-label="Buy lists" className="flex rounded-[10px] bg-line p-[3px] md:max-w-sm xl:hidden">
          {(
            [
              ['buy', `To buy · ${toOrder.length}`],
              ['way', `On the way · ${ordered.length}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`h-11 flex-1 rounded-lg text-sm ${tab === id ? 'bg-surface font-semibold shadow-sm' : 'font-medium text-ink-soft'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {projectIds.length > 1 && (
          <div role="group" aria-label="Filter by project" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
            <button type="button" aria-pressed={projectId === null} onClick={() => setPicked(null)} className={chipClass(projectId === null)}>
              All projects
            </button>
            {projectIds.map((id) => {
              const title = all.find((i) => i.projectId === id)!.projectTitle;
              return (
                <button key={id} type="button" aria-pressed={projectId === id} onClick={() => setPicked(projectId === id ? null : id)} className={chipClass(projectId === id)}>
                  <ProjectTile project={look(id)} size={12} />
                  {title}
                </button>
              );
            })}
          </div>
        )}
        <TagFilter value={tag} onChange={setTag} />
      </header>
      <main className="flex flex-1 flex-col gap-3.5 px-4 pt-1 pb-28 md:px-8 md:pb-10">
        {buy.data ? <BuyLists data={buy.data} tab={tab} inView={inView} look={look} tag={tag} navigate={navigate} /> : <QueryFallback query={buy} />}
      </main>
    </>
  );
}

const chipClass = (on: boolean) =>
  `flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] whitespace-nowrap md:h-9 ${
    on ? 'bg-ink font-semibold text-surface' : 'border border-line bg-surface font-medium text-ink hover:border-line-strong'
  }`;

interface ListsProps {
  data: BuyOverview;
  tab: Tab;
  inView: (item: ItemWithContext) => boolean;
  look: Look;
  tag: string | null;
  navigate: Navigate;
}

function BuyLists({ data, tab, inView, look, tag, navigate }: ListsProps) {
  const groups = data.byShop.map((g) => ({ ...g, items: g.items.filter(inView) })).filter((g) => g.items.length > 0);
  const shops = groups.filter((g) => g.name !== null);
  const noShop = groups.find((g) => g.name === null)?.items ?? [];
  const orders = groupOrders(data.ordered.filter(inView));
  const ordered = orders.reduce((n, o) => n + o.items.length, 0);

  if (groups.length === 0 && orders.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-muted">
        {tag ? `Nothing to buy for #${tag}.` : 'Nothing to buy. Items on a “To buy” checklist will show up here.'}
      </p>
    );
  }

  const buyPane = tab === 'buy' ? 'flex' : 'hidden xl:flex';
  const wayPane = tab === 'way' ? 'flex' : 'hidden xl:flex';

  return (
    <div className="grid items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_400px]">
      <section aria-labelledby="buy-ready" className={`${buyPane} min-w-0 flex-col gap-2 xl:col-start-1 xl:row-start-1`}>
        <h2 id="buy-ready" className={`${heading} text-muted`}>
          Ready to order{shops.length > 0 && ` · ${shops.length} ${shops.length === 1 ? 'shop' : 'shops'}`}
        </h2>
        {shops.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-6 text-center text-sm text-muted">Items with a shop link show up here.</p>
        ) : (
          shops.map((group) => <ShopBasket key={group.key} group={group} look={look} navigate={navigate} />)
        )}
      </section>

      {noShop.length > 0 && (
        <section aria-labelledby="buy-noshop" className={`${buyPane} min-w-0 flex-col gap-2 xl:col-start-1 xl:row-start-2 2xl:col-start-2 2xl:row-start-1`}>
          <div className="mx-1 flex items-baseline justify-between gap-3">
            <h2 id="buy-noshop" className="text-xs font-semibold tracking-[0.06em] text-warning-ink uppercase">
              Needs a shop · {noShop.length}
            </h2>
            <span className="text-xs text-muted">add a link to price it</span>
          </div>
          <NeedsShop items={noShop} look={look} navigate={navigate} />
        </section>
      )}

      <section aria-labelledby="buy-way" className={`${wayPane} min-w-0 flex-col gap-2.5 xl:col-start-2 xl:row-span-2 xl:row-start-1 2xl:col-start-3 2xl:row-span-1`}>
        <h2 id="buy-way" className={`${heading} text-warning-ink`}>
          On the way · {ordered}
        </h2>
        {orders.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-6 text-center text-sm text-muted">Nothing on the way.</p>
        ) : (
          orders.map((order) => <OrderCard key={order.key} order={order} look={look} navigate={navigate} />)
        )}
      </section>
    </div>
  );
}

function ShopBasket({ group, look, navigate }: { group: BuyGroup; look: Look; navigate: Navigate }) {
  const [marking, setMarking] = useState(false);
  const name = group.name!;
  const urls = [...new Set(group.items.map((i) => preferredLink(i)?.url).filter((u): u is string => !!u))];
  const total = priceTotal(group.items);
  const projectCount = new Set(group.items.map((i) => i.projectId)).size;
  const openAll = () => urls.forEach((url) => window.open(url, '_blank', 'noopener'));

  return (
    <section aria-label={name} className={card}>
      <div className="flex items-center gap-3 border-b border-line-soft px-3.5 py-3">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-line-soft font-display text-[15px] font-bold text-ink-soft">
          {name[0]!.toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base font-semibold">{name}</span>
          <span className="text-xs text-muted">
            {countLabel(group.items.length)} · {projectCount} {projectCount === 1 ? 'project' : 'projects'}
            {group.unpriced > 0 && ` · ${group.unpriced} unpriced`}
          </span>
        </span>
        {total && <span className="text-right font-display text-lg font-semibold">{total}</span>}
      </div>
      <ul>
        {group.items.map((item) => (
          <BasketItem key={item.id} item={item} look={look} navigate={navigate} />
        ))}
      </ul>
      <div className="flex gap-2 px-3.5 py-3">
        <button type="button" onClick={() => setMarking(true)} className="h-11 flex-1 rounded-xl bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-strong xl:flex-none xl:px-4">
          Mark ordered…
        </button>
        {urls.length > 1 && (
          <button type="button" onClick={openAll} className="h-11 flex-1 rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:bg-ground xl:flex-none xl:px-4">
            Open {urls.length === 2 ? 'both' : `all ${urls.length}`} links
          </button>
        )}
      </div>
      {marking && <MarkOrderedSheet shop={name} items={group.items} look={look} onClose={() => setMarking(false)} />}
    </section>
  );
}

function BasketItem({ item, look, navigate }: { item: ItemWithContext; look: Look; navigate: Navigate }) {
  const link = preferredLink(item);
  const qty = formatQuantity(item.quantity, item.unit);
  return (
    <li className="flex items-start gap-2.5 border-b border-line-soft px-3.5 py-3">
      <span className="mt-[3px]">
        <ProjectTile project={look(item.projectId)} size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <a {...appLink(`/projects/${item.projectId}`, navigate)} className="text-[15px] leading-snug font-medium hover:underline">
          {item.text}
        </a>
        <span className="text-xs text-muted">{[item.projectTitle, qty].filter(Boolean).join(' · ')}</span>
        {item.note && <span className="line-clamp-2 text-xs text-ink-soft">{item.note}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end">
        {link?.price != null && <span className="text-sm font-semibold whitespace-nowrap">{formatPrice(link.price * (item.quantity ?? 1), link.currency)}</span>}
        {link && (
          <a href={link.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.text} at ${link.shop ?? 'the shop'}`} className="flex min-h-11 items-center gap-1 text-xs font-semibold text-accent-ink">
            Open
            <ExternalIcon width={13} height={13} />
          </a>
        )}
      </span>
    </li>
  );
}

function NeedsShop({ items, look, navigate }: { items: ItemWithContext[]; look: Look; navigate: Navigate }) {
  const ids = [...new Set(items.map((i) => i.projectId))];
  return (
    <div className={card}>
      {ids.map((id) => (
        <NeedsShopProject key={id} items={items.filter((i) => i.projectId === id)} project={look(id)} navigate={navigate} />
      ))}
    </div>
  );
}

function NeedsShopProject({ items, project, navigate }: { items: ItemWithContext[]; project: ReturnType<Look>; navigate: Navigate }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, COLLAPSED);
  const title = items[0]!.projectTitle;
  return (
    <div>
      <h3 className="flex items-center gap-2 bg-line-soft/60 px-3.5 py-2 text-[13px] font-semibold">
        <ProjectTile project={project} size={20} />
        {title}
        <span className="font-normal text-muted">{items.length}</span>
      </h3>
      <ul>
        {shown.map((item) => {
          const qty = formatQuantity(item.quantity, item.unit);
          const detail = item.note ?? qty;
          return (
            <li key={item.id} className="flex min-h-13 items-center gap-2.5 border-b border-line-soft py-1 pr-1.5 pl-3.5">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
                <span className="text-[15px] leading-snug font-medium">{item.text}</span>
                {detail && <span className="line-clamp-2 text-xs text-muted">{detail}</span>}
              </span>
              <a {...appLink(`/projects/${item.projectId}`, navigate)} aria-label={`Add shop link: ${item.text}`} className="flex h-11 shrink-0 items-center px-3 text-[13px] font-semibold whitespace-nowrap text-accent-ink">
                + Link
              </a>
            </li>
          );
        })}
      </ul>
      {items.length > COLLAPSED && (
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="h-12 w-full border-b border-line-soft text-[13px] font-semibold text-accent-ink">
          {expanded ? 'Show less' : `Show ${items.length - COLLAPSED} more from ${title}`}
        </button>
      )}
    </div>
  );
}

function OrderCard({ order, look, navigate }: { order: Order; look: Look; navigate: Navigate }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const received = useMarkReceived();
  const shown = expanded ? order.items : order.items.slice(0, COLLAPSED);
  const total = orderAmount(order);
  const titles = [...new Set(order.items.map((i) => i.projectTitle))];
  const name = order.shop ?? 'No shop';
  const meta = [order.orderedAt && `Ordered ${formatDue(order.orderedAt.slice(0, 10))}`, titles.length === 1 ? titles[0] : `${titles.length} projects`].filter(Boolean).join(' · ');
  const chip = (filled: boolean) =>
    `flex h-11 items-center gap-1.5 rounded-full border px-3 text-[13px] md:h-9 ${filled ? 'border-line font-semibold text-ink' : 'border-dashed border-control font-medium text-ink-soft'}`;

  return (
    <section aria-label={`${name} order`} className={`${card} ${received.isPending ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3 border-b border-line-soft px-3.5 py-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base font-semibold">
            {name} · {countLabel(order.items.length)}
          </span>
          <span className="text-xs text-muted">{meta}</span>
        </span>
        {total && <span className="text-sm font-semibold whitespace-nowrap">{total}</span>}
      </div>
      <div className="flex flex-wrap gap-2 border-b border-line-soft px-3.5 py-2.5">
        <button type="button" onClick={() => setEditing(true)} className={chip(!!order.orderRef)}>
          {order.orderRef ? `#${order.orderRef}` : '+ Order number'}
        </button>
        <button type="button" onClick={() => setEditing(true)} className={chip(!!order.expectedDate)}>
          {order.expectedDate ? (
            <>
              <CalendarIcon width={14} height={14} />
              <span className={dueToneClass[dueTone(order.expectedDate)]}>{formatDue(order.expectedDate)}</span>
            </>
          ) : (
            '+ Expected date'
          )}
        </button>
        {order.paidTotal === null && (
          <button type="button" onClick={() => setEditing(true)} className={chip(false)}>
            + Total paid
          </button>
        )}
      </div>
      <ul>
        {shown.map((item) => (
          <OrderItem key={item.id} item={item} navigate={navigate} />
        ))}
      </ul>
      {order.items.length > COLLAPSED && (
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="h-11 w-full border-b border-line-soft px-3.5 text-left text-[13px] font-semibold text-accent-ink">
          {expanded ? 'Show less' : `Show ${order.items.length - COLLAPSED} more`}
        </button>
      )}
      <div className="flex flex-col gap-1.5 px-3.5 py-3">
        <button
          type="button"
          disabled={received.isPending}
          onClick={() => received.mutate(order.items.map((i) => ({ id: i.id, projectId: i.projectId })))}
          className="h-11 w-full rounded-xl border border-line bg-surface text-sm font-semibold hover:bg-ground"
        >
          Mark whole order received
        </button>
        {received.isError && (
          <span role="alert" className="text-xs text-danger">
            {received.error.message}
          </span>
        )}
      </div>
      {editing && <OrderDetailsSheet order={order} onClose={() => setEditing(false)} />}
    </section>
  );
}

function OrderItem({ item, navigate }: { item: ItemWithContext; navigate: Navigate }) {
  const change = useItemState();
  return (
    <li className={`flex items-center gap-1 border-b border-line-soft py-0.5 pr-3.5 pl-1 ${change.isPending ? 'opacity-60' : ''}`}>
      <button
        type="button"
        disabled={change.isPending}
        onClick={() => change.mutate({ id: item.id, projectId: item.projectId, state: 'done' })}
        aria-label={`Mark as received: ${item.text}`}
        className="flex size-11 shrink-0 items-center justify-center"
      >
        <StateMark state="ordered" />
      </button>
      <a {...appLink(`/projects/${item.projectId}`, navigate)} className="min-w-0 flex-1 py-2 text-sm leading-snug hover:underline">
        {item.text}
      </a>
    </li>
  );
}
