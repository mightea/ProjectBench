/**
 * Input schemas and API types shared by the server, the MCP server and the web app.
 * This file must stay browser-safe: no Node or database imports.
 */
import { z } from 'zod';

export const PROJECT_STATUSES = ['idea', 'planned', 'active', 'waiting', 'done', 'archived'] as const;
export const CHECKLIST_KINDS = ['buy', 'clarify', 'todo'] as const;
export const ITEM_STATES = ['open', 'ordered', 'done'] as const;
export const PRIORITIES = [1, 2, 3, 4] as const;
export const PROJECT_COLORS = ['teal', 'amber', 'rust', 'violet', 'blue', 'green', 'rose', 'slate'] as const;
export const PROJECT_ICONS = ['chip', 'light', 'motorcycle', 'power', 'wrench', 'home', 'garden', 'box'] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];
export type ProjectIcon = (typeof PROJECT_ICONS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];
export type ItemState = (typeof ITEM_STATES)[number];
export type Priority = (typeof PRIORITIES)[number];

/** Statuses shown under "Open" by default. */
export const OPEN_STATUSES: ProjectStatus[] = ['idea', 'planned', 'active', 'waiting'];

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();
const isoDate = z.iso.date().nullable();
const priority = z.number().int().min(1).max(4);

export const projectCreateSchema = z.object({
  title: trimmed(200),
  description: optionalText(20_000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  priority: priority.optional(),
  dueDate: isoDate.optional(),
  startDate: isoDate.optional(),
  color: z.enum(PROJECT_COLORS).nullable().optional(),
  icon: z.enum(PROJECT_ICONS).nullable().optional(),
  tags: z.array(trimmed(40)).max(20).optional(),
});

export const projectUpdateSchema = projectCreateSchema.partial().extend({
  /** An image attached to this project, or null for no cover. */
  coverAttachmentId: z.string().min(1).nullable().optional(),
  /** Move within its priority group, as an index among the other projects of that priority. */
  position: z.number().int().min(0).optional(),
});

export const linkCreateSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2000),
  shop: optionalText(80).optional(),
  price: z.number().nonnegative().max(1_000_000).nullable().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  note: optionalText(200).optional(),
  preferred: z.boolean().optional(),
});

export const linkUpdateSchema = linkCreateSchema.partial().extend({
  position: z.number().int().min(0).optional(),
});

export const itemCreateSchema = z.object({
  text: trimmed(500),
  quantity: z.number().positive().max(1_000_000).nullable().optional(),
  unit: optionalText(20).optional(),
  dueDate: isoDate.optional(),
  note: optionalText(5000).optional(),
  links: z.array(linkCreateSchema).max(20).optional(),
});

export const itemsCreateSchema = z.object({
  items: z.array(itemCreateSchema).min(1).max(200),
});

export const itemUpdateSchema = z.object({
  text: trimmed(500).optional(),
  state: z.enum(ITEM_STATES).optional(),
  quantity: z.number().positive().max(1_000_000).nullable().optional(),
  unit: optionalText(20).optional(),
  dueDate: isoDate.optional(),
  note: optionalText(5000).optional(),
  orderRef: optionalText(100).optional(),
  /** What the whole order cost. Items of one order carry the same amount. */
  paidTotal: z.number().nonnegative().max(1_000_000).nullable().optional(),
  paidCurrency: z.string().trim().length(3).toUpperCase().nullable().optional(),
  expectedDate: isoDate.optional(),
  /** Move to another checklist of the same project. */
  checklistId: z.string().min(1).optional(),
  /** Index among the other items of the (target) checklist. */
  position: z.number().int().min(0).optional(),
});

export const checklistCreateSchema = z.object({
  title: trimmed(120),
  kind: z.enum(CHECKLIST_KINDS).default('todo'),
});

export const checklistUpdateSchema = z.object({
  title: trimmed(120).optional(),
  kind: z.enum(CHECKLIST_KINDS).optional(),
  position: z.number().int().min(0).optional(),
});

export const projectListQuerySchema = z.object({
  status: z
    .union([z.enum(PROJECT_STATUSES), z.literal('open'), z.literal('all')])
    .default('open'),
  tag: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['priority', 'due', 'updated']).default('priority'),
});

export type ProjectCreate = z.input<typeof projectCreateSchema>;
export type ProjectUpdate = z.input<typeof projectUpdateSchema>;
export type LinkCreate = z.input<typeof linkCreateSchema>;
export type LinkUpdate = z.input<typeof linkUpdateSchema>;
export type ItemCreate = z.input<typeof itemCreateSchema>;
export type ItemUpdate = z.input<typeof itemUpdateSchema>;
export type ChecklistCreate = z.input<typeof checklistCreateSchema>;
export type ChecklistUpdate = z.input<typeof checklistUpdateSchema>;
export type ProjectListQuery = z.input<typeof projectListQuerySchema>;

export const noteCreateSchema = z.object({
  body: trimmed(20_000),
  pinned: z.boolean().optional(),
});

export const noteUpdateSchema = z
  .object({
    body: trimmed(20_000).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => v.body !== undefined || v.pinned !== undefined, { message: 'Provide body or pinned' });

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const apiTokenCreateSchema = z.object({
  name: trimmed(80),
});

export const itemLinksSetSchema = z
  .object({
    /** Replaces all links of the item. Cannot be combined with add or remove. */
    replace: z.array(linkCreateSchema).max(20).optional(),
    add: z.array(linkCreateSchema).max(20).optional(),
    remove: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine((v) => v.replace !== undefined || v.add !== undefined || v.remove !== undefined, {
    message: 'Provide replace, add or remove',
  })
  .refine((v) => v.replace === undefined || (v.add === undefined && v.remove === undefined), {
    message: 'replace cannot be combined with add or remove',
  });

export type NoteCreate = z.input<typeof noteCreateSchema>;
export type NoteUpdate = z.input<typeof noteUpdateSchema>;
export type ApiTokenCreate = z.input<typeof apiTokenCreateSchema>;
export type ItemLinksSet = z.input<typeof itemLinksSetSchema>;

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Returned once, when the token is created. */
export interface ApiTokenCreated extends ApiToken {
  token: string;
}

export interface Attachment {
  id: string;
  projectId: string;
  noteId: string | null;
  itemId: string | null;
  filename: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  hasThumbnail: boolean;
  createdAt: string;
}

export interface Note {
  id: string;
  projectId: string;
  body: string;
  pinned: boolean;
  source: 'app' | 'mcp';
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
}

// ---- API response shapes -------------------------------------------------------

export interface Progress {
  total: number;
  done: number;
  ordered: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  status: ProjectStatus;
  priority: number;
  dueDate: string | null;
  color: string | null;
  icon: string | null;
  coverAttachmentId: string | null;
  tags: string[];
  progress: Progress;
  /** The same counts, per checklist kind. */
  kinds: Record<ChecklistKind, Progress>;
  /** The first open item on a to-do list. */
  nextStep: NextStep | null;
  /** Earliest due date among open items, if any. */
  nextItemDue: string | null;
  updatedAt: string;
}

export interface NextStep {
  id: string;
  text: string;
  note: string | null;
}

export interface ItemLink {
  id: string;
  url: string;
  shop: string | null;
  price: number | null;
  currency: string | null;
  note: string | null;
  preferred: boolean;
}

export interface ChecklistItem {
  id: string;
  checklistId: string;
  text: string;
  state: ItemState;
  orderedAt: string | null;
  orderRef: string | null;
  paidTotal: number | null;
  paidCurrency: string | null;
  expectedDate: string | null;
  doneAt: string | null;
  dueDate: string | null;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  links: ItemLink[];
}

export interface Checklist {
  id: string;
  title: string;
  kind: ChecklistKind;
  items: ChecklistItem[];
}

export interface ProjectDetail extends ProjectSummary {
  description: string | null;
  startDate: string | null;
  completedAt: string | null;
  createdAt: string;
  checklists: Checklist[];
}

export interface ItemWithContext extends ChecklistItem {
  projectId: string;
  projectTitle: string;
  checklistTitle: string;
  checklistKind: ChecklistKind;
}

/** Tags are stored lower-case, without a leading #, with dashes for spaces. */
export const normalizeTag = (name: string) => name.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** "Galaxus", "galaxus.ch" and "www.galaxus.ch" are one shop. */
export function shopKey(name: string): string {
  const key = name.trim().toLowerCase();
  return DOMAIN.test(key) ? key.split('.').at(-2)! : key;
}

/** The name to show for one shop's spellings: a real name rather than a domain. */
export function shopLabel(names: string[]): string {
  return names.find((n) => !DOMAIN.test(n.trim().toLowerCase())) ?? names[0]!;
}

export interface SearchHit {
  entity: 'project' | 'item' | 'note';
  entityId: string;
  projectId: string;
  projectTitle: string;
  /** The tags of the hit's project. */
  tags: string[];
  title: string;
  snippet: string;
}

export interface Agenda {
  today: string;
  until: string;
  overdueItems: ItemWithContext[];
  upcomingItems: ItemWithContext[];
  lateDeliveries: ItemWithContext[];
  upcomingDeliveries: ItemWithContext[];
  overdueProjects: ProjectSummary[];
  upcomingProjects: ProjectSummary[];
  urgentProjects: ProjectSummary[];
  openQuestions: ItemWithContext[];
}

export interface BuyGroup {
  key: string;
  /** Shop or project name; null for items without a shop. */
  name: string | null;
  items: ItemWithContext[];
  /** Preferred-link price × quantity, per currency. */
  totals: { currency: string; amount: number }[];
  unpriced: number;
}

export interface BuyOverview {
  byShop: BuyGroup[];
  byProject: BuyGroup[];
  ordered: ItemWithContext[];
}
