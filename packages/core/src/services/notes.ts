import { and, desc, eq, sql } from 'drizzle-orm';
import { NotFoundError } from '../errors.ts';
import { newId } from '../ids.ts';
import { notes, projects } from '../schema.ts';
import { noteCreateSchema, noteUpdateSchema, type Note, type NoteCreate, type NoteUpdate } from '../schemas.ts';
import { attachmentsForNotes } from './attachments.ts';
import { definedOnly, indexSearch, logActivity, nowIso, removeSearch, type ServiceContext } from './context.ts';
import { touchProject } from './projects.ts';

type NoteRow = typeof notes.$inferSelect;

const toNotes = (ctx: ServiceContext, rows: NoteRow[]): Note[] => {
  const files = attachmentsForNotes(ctx, rows.map((r) => r.id));
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    body: row.body,
    pinned: row.pinned,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    attachments: files.get(row.id) ?? [],
  }));
};

const noteTitle = (body: string) => body.split('\n', 1)[0]!.slice(0, 120);

function getNote(ctx: ServiceContext, id: string): Note {
  const row = ctx.db.select().from(notes).where(eq(notes.id, id)).get();
  if (!row) throw new NotFoundError('Note', id);
  return toNotes(ctx, [row])[0]!;
}

export function addNote(ctx: ServiceContext, projectId: string, input: NoteCreate): Note {
  const data = noteCreateSchema.parse(input);
  const id = newId();
  const now = nowIso(ctx);
  ctx.db.transaction((tx) => {
    if (!tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
      throw new NotFoundError('Project', projectId);
    }
    tx.insert(notes)
      .values({ id, projectId, body: data.body, pinned: data.pinned ?? false, source: ctx.actor, createdAt: now, updatedAt: now })
      .run();
    indexSearch(tx, { entity: 'note', entityId: id, projectId, title: noteTitle(data.body), body: data.body });
    touchProject(tx, ctx, projectId);
    logActivity(tx, ctx, { projectId, entity: 'note', entityId: id, action: 'create' });
  });
  return getNote(ctx, id);
}

export function updateNote(ctx: ServiceContext, id: string, input: NoteUpdate): Note {
  const data = noteUpdateSchema.parse(input);
  ctx.db.transaction((tx) => {
    const current = tx.select().from(notes).where(eq(notes.id, id)).get();
    if (!current) throw new NotFoundError('Note', id);
    tx.update(notes).set({ ...definedOnly(data), updatedAt: nowIso(ctx) }).where(eq(notes.id, id)).run();
    if (data.body !== undefined) {
      indexSearch(tx, { entity: 'note', entityId: id, projectId: current.projectId, title: noteTitle(data.body), body: data.body });
    }
    touchProject(tx, ctx, current.projectId);
    logActivity(tx, ctx, { projectId: current.projectId, entity: 'note', entityId: id, action: 'update', diff: data });
  });
  return getNote(ctx, id);
}

/** Deletes a note. Its attachments stay in the project's files. */
export function deleteNote(ctx: ServiceContext, id: string): void {
  ctx.db.transaction((tx) => {
    const current = tx.select().from(notes).where(eq(notes.id, id)).get();
    if (!current) throw new NotFoundError('Note', id);
    tx.delete(notes).where(eq(notes.id, id)).run();
    removeSearch(tx, 'note', id);
    touchProject(tx, ctx, current.projectId);
    logActivity(tx, ctx, { projectId: current.projectId, entity: 'note', entityId: id, action: 'delete' });
  });
}

/** Newest first. */
export function listNotes(ctx: ServiceContext, projectId: string, limit = 10): Note[] {
  const rows = ctx.db
    .select()
    .from(notes)
    .where(eq(notes.projectId, projectId))
    .orderBy(desc(notes.createdAt), desc(notes.id))
    .limit(limit)
    .all();
  return toNotes(ctx, rows);
}

/** The timeline: pinned notes first, then newest first. */
export function noteTimeline(ctx: ServiceContext, projectId: string): Note[] {
  if (!ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
    throw new NotFoundError('Project', projectId);
  }
  const rows = ctx.db
    .select()
    .from(notes)
    .where(and(eq(notes.projectId, projectId)))
    .orderBy(sql`${notes.pinned} desc`, desc(notes.createdAt), desc(notes.id))
    .all();
  return toNotes(ctx, rows);
}
