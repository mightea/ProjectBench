/**
 * Input schemas and API types shared by the server, the MCP server and the web app.
 * This file must stay browser-safe: no Node or database imports.
 */
import { z } from 'zod';

export const PROJECT_STATUSES = ['idea', 'planned', 'active', 'waiting', 'done', 'archived'] as const;
export const CHECKLIST_KINDS = ['buy', 'clarify', 'todo'] as const;
export const ITEM_STATES = ['open', 'ordered', 'done'] as const;
export const PRIORITIES = [1, 2, 3, 4] as const;

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
  color: optionalText(32).optional(),
  tags: z.array(trimmed(40)).max(20).optional(),
});

export const projectUpdateSchema = projectCreateSchema.partial().extend({
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
  tags: string[];
  progress: Progress;
  /** Earliest due date among open items, if any. */
  nextItemDue: string | null;
  updatedAt: string;
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
