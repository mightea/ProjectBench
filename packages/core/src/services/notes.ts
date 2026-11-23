import { desc, eq } from 'drizzle-orm';
import { NotFoundError } from '../errors.ts';
import { newId } from '../ids.ts';
import { notes, projects } from '../schema.ts';
import { noteCreateSchema, type Note, type NoteCreate } from '../schemas.ts';
import { indexSearch, logActivity, nowIso, type ServiceContext } from './context.ts';
import { touchProject } from './projects.ts';

const toNote = (row: typeof notes.$inferSelect): Note => ({
  id: row.id,
  projectId: row.projectId,
  body: row.body,
  pinned: row.pinned,
  source: row.source,
  createdAt: row.createdAt,
});

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
    const title = data.body.split('\n', 1)[0]!.slice(0, 120);
    indexSearch(tx, { entity: 'note', entityId: id, projectId, title, body: data.body });
    touchProject(tx, ctx, projectId);
    logActivity(tx, ctx, { projectId, entity: 'note', entityId: id, action: 'create' });
  });
  return toNote(ctx.db.select().from(notes).where(eq(notes.id, id)).get()!);
}

/** Newest first. */
export function listNotes(ctx: ServiceContext, projectId: string, limit = 10): Note[] {
  return ctx.db
    .select()
    .from(notes)
    .where(eq(notes.projectId, projectId))
    .orderBy(desc(notes.createdAt), desc(notes.id))
    .limit(limit)
    .all()
    .map(toNote);
}
