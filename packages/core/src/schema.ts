import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { CHECKLIST_KINDS, ITEM_STATES, PROJECT_STATUSES } from './schemas.ts';

/** ISO-8601 timestamp set by SQLite when a row is inserted. */
const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

/** ISO-8601 timestamp; the service layer updates it on every write. */
const updatedAt = () =>
  text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: PROJECT_STATUSES }).notNull().default('planned'),
    /** 1 = urgent … 4 = someday */
    priority: integer('priority').notNull().default(3),
    dueDate: text('due_date'),
    startDate: text('start_date'),
    color: text('color'),
    coverAttachmentId: text('cover_attachment_id'),
    sortKey: text('sort_key').notNull(),
    completedAt: text('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_status_priority_idx').on(t.status, t.priority, t.sortKey)],
);

export const checklists = sqliteTable(
  'checklists',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: text('kind', { enum: CHECKLIST_KINDS }).notNull().default('todo'),
    sortKey: text('sort_key').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('checklists_project_idx').on(t.projectId, t.sortKey)],
);

export const checklistItems = sqliteTable(
  'checklist_items',
  {
    id: text('id').primaryKey(),
    checklistId: text('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    /** 'ordered' is only used on buy lists */
    state: text('state', { enum: ITEM_STATES }).notNull().default('open'),
    orderedAt: text('ordered_at'),
    orderRef: text('order_ref'),
    expectedDate: text('expected_date'),
    doneAt: text('done_at'),
    dueDate: text('due_date'),
    quantity: real('quantity'),
    unit: text('unit'),
    /** Answer for 'clarify' items, or a short remark */
    note: text('note'),
    sortKey: text('sort_key').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('items_checklist_idx').on(t.checklistId, t.sortKey),
    index('items_due_idx').on(t.dueDate),
  ],
);

/** Where to buy an item: one or more links per item. */
export const itemLinks = sqliteTable(
  'item_links',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => checklistItems.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    shop: text('shop'),
    price: real('price'),
    currency: text('currency').default('CHF'),
    note: text('note'),
    preferred: integer('preferred', { mode: 'boolean' }).notNull().default(false),
    sortKey: text('sort_key').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('item_links_item_idx').on(t.itemId, t.sortKey)],
);

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    source: text('source', { enum: ['app', 'mcp'] }).notNull().default('app'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('notes_project_idx').on(t.projectId, t.createdAt)],
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    noteId: text('note_id').references(() => notes.id, { onDelete: 'set null' }),
    itemId: text('item_id').references(() => checklistItems.id, { onDelete: 'set null' }),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** File is stored at <DATA_DIR>/files/ab/cd/<sha256> */
    sha256: text('sha256').notNull(),
    width: integer('width'),
    height: integer('height'),
    caption: text('caption'),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_project_idx').on(t.projectId), index('attachments_sha_idx').on(t.sha256)],
);

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),
});

export const projectTags = sqliteTable(
  'project_tags',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.tagId] })],
);

/** Audit trail; also shows what Claude changed via MCP. */
export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id'),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    actor: text('actor', { enum: ['app', 'mcp'] }).notNull(),
    /** JSON */
    diff: text('diff'),
    createdAt: createdAt(),
  },
  (t) => [index('activity_project_idx').on(t.projectId, t.createdAt)],
);

/** Key/value settings, e.g. the login password hash. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
});

/** Login sessions. Only a SHA-256 hash of the cookie token is stored. */
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: text('expires_at').notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  lastSeenAt: text('last_seen_at'),
});

/** Bearer tokens for the MCP server. Only a SHA-256 hash of the token is stored. */
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  /** First characters of the token, so it can be recognised in the settings. */
  prefix: text('prefix').notNull(),
  createdAt: createdAt(),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
});
