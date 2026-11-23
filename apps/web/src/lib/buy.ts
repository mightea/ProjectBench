import { shopKey, shopLabel, type ChecklistItem, type ItemWithContext } from '@projectbench/core/schemas';
import { formatPrice } from './format.ts';

export const preferredLink = (item: ChecklistItem) => item.links.find((l) => l.preferred) ?? item.links[0];

/** Preferred-link price × quantity, per currency, as "CHF 12.00 + EUR 3.00". */
export function priceTotal(items: ChecklistItem[]): string {
  const cents = new Map<string, number>();
  for (const item of items) {
    const link = preferredLink(item);
    if (link?.price == null) continue;
    const currency = link.currency ?? 'CHF';
    cents.set(currency, (cents.get(currency) ?? 0) + Math.round(link.price * (item.quantity ?? 1) * 100));
  }
  return [...cents].map(([currency, amount]) => formatPrice(amount / 100, currency)).join(' + ');
}

/** "1'234,50" is 1234.5, empty is null, anything else is undefined. */
export function parseAmount(text: string): number | null | undefined {
  const clean = text.replace(/['’\s]/g, '').replace(',', '.');
  if (!clean) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return undefined;
  const amount = Number(clean);
  return amount <= 1_000_000 ? amount : undefined;
}

export const isCurrency = (text: string) => /^[a-z]{3}$/i.test(text.trim());

export const countLabel = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

export interface Order {
  key: string;
  shop: string | null;
  orderRef: string | null;
  orderedAt: string | null;
  /** The earliest delivery date of its items. */
  expectedDate: string | null;
  /** What the whole order cost, if recorded. */
  paidTotal: number | null;
  paidCurrency: string | null;
  items: ItemWithContext[];
}

/** The amount paid, or else the sum of the item prices. */
export const orderAmount = (order: Order) =>
  order.paidTotal !== null ? `${formatPrice(order.paidTotal, order.paidCurrency)} paid` : priceTotal(order.items);

/** Items bought together: same shop, order number and day. */
export function groupOrders(items: ItemWithContext[]): Order[] {
  const names = new Map<string, string[]>();
  for (const item of items) {
    const shop = preferredLink(item)?.shop;
    if (shop) names.set(shopKey(shop), [...(names.get(shopKey(shop)) ?? []), shop]);
  }
  // Some items have no link and only name their shop at the start of the note.
  const shopOf = (item: ItemWithContext) => {
    const shop = preferredLink(item)?.shop;
    if (shop) return shopKey(shop);
    const note = item.note?.toLowerCase() ?? '';
    return [...names.keys()].find((key) => note.startsWith(key)) ?? '';
  };

  const orders = new Map<string, Order>();
  for (const item of items) {
    const shop = shopOf(item);
    const key = [shop, item.orderRef ?? '', item.orderedAt?.slice(0, 10) ?? ''].join('|');
    const order = orders.get(key) ?? {
      key,
      shop: shop ? shopLabel(names.get(shop)!) : null,
      orderRef: item.orderRef,
      orderedAt: item.orderedAt,
      expectedDate: null,
      paidTotal: null,
      paidCurrency: null,
      items: [],
    };
    order.items.push(item);
    if (order.paidTotal === null && item.paidTotal !== null) Object.assign(order, { paidTotal: item.paidTotal, paidCurrency: item.paidCurrency });
    if (item.expectedDate && (!order.expectedDate || item.expectedDate < order.expectedDate)) order.expectedDate = item.expectedDate;
    orders.set(key, order);
  }
  return [...orders.values()];
}
