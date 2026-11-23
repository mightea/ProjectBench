import type { ChecklistKind, ProjectStatus } from '@projectbench/core/schemas';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local "today" as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const parse = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

export function daysUntil(iso: string, now = new Date()): number {
  return Math.round((parse(iso).getTime() - parse(todayIso(now)).getTime()) / DAY);
}

/** "Today", "Tomorrow", "Tue 24", "30 Nov", "30 Nov 2027". */
export function formatDue(iso: string, now = new Date()): string {
  const days = daysUntil(iso, now);
  const date = parse(iso);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${sameYear ? '' : ` ${date.getFullYear()}`}`;
}

export type DueTone = 'overdue' | 'soon' | 'normal';

export function dueTone(iso: string, now = new Date()): DueTone {
  const days = daysUntil(iso, now);
  if (days < 0) return 'overdue';
  if (days <= 2) return 'soon';
  return 'normal';
}

export const dueToneClass: Record<DueTone, string> = {
  overdue: 'text-danger',
  soon: 'text-warning',
  normal: 'text-muted',
};

export const PRIORITY_META: Record<number, { short: string; label: string; className: string }> = {
  1: { short: 'P1', label: 'Urgent', className: 'bg-danger-soft text-danger' },
  2: { short: 'P2', label: 'High', className: 'bg-warning-soft text-warning-ink' },
  3: { short: 'P3', label: 'Normal', className: 'bg-accent-soft text-accent-ink' },
  4: { short: 'P4', label: 'Someday', className: 'bg-line-soft text-ink-soft' },
};

export const STATUS_META: Record<ProjectStatus, { label: string; dot: string }> = {
  idea: { label: 'Idea', dot: 'bg-status-idea' },
  planned: { label: 'Planned', dot: 'bg-control' },
  active: { label: 'Active', dot: 'bg-success' },
  waiting: { label: 'Waiting', dot: 'bg-warning' },
  done: { label: 'Done', dot: 'bg-accent' },
  archived: { label: 'Archived', dot: 'bg-faint' },
};

export const KIND_META: Record<ChecklistKind, { label: string; defaultTitle: string; iconClass: string }> = {
  buy: { label: 'To buy', defaultTitle: 'To buy', iconClass: 'bg-accent-soft text-accent-ink' },
  clarify: { label: 'To clarify', defaultTitle: 'To clarify', iconClass: 'bg-warning-soft text-warning-ink' },
  todo: { label: 'To do', defaultTitle: 'To do', iconClass: 'bg-success-soft text-success' },
};

export function formatPrice(price: number | null, currency: string | null): string {
  if (price === null) return '';
  return `${currency ?? 'CHF'} ${price.toFixed(2)}`;
}

export function formatQuantity(quantity: number | null, unit: string | null): string {
  if (quantity === null) return '';
  const q = Number.isInteger(quantity) ? String(quantity) : String(quantity);
  return unit ? `${q} ${unit}` : `×${q}`;
}
