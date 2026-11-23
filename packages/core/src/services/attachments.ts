import { readFileSync } from 'node:fs';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { InvalidOperationError, NotFoundError } from '../errors.ts';
import { fetchPublicUrl } from '../fetch-url.ts';
import type { FileStore } from '../files.ts';
import { newId } from '../ids.ts';
import { isPreviewableImage, pdfText, plainText, processUpload, resizeForModel } from '../media.ts';
import { attachments, checklistItems, checklists, notes, projects } from '../schema.ts';
import { MAX_UPLOAD_BYTES, type Attachment } from '../schemas.ts';
import { logActivity, nowIso, type ServiceContext } from './context.ts';
import { releaseFiles } from './file-refs.ts';
import { touchProject } from './projects.ts';

type AttachmentRow = typeof attachments.$inferSelect;

export const toAttachment = (row: AttachmentRow): Attachment => ({
  id: row.id,
  projectId: row.projectId,
  noteId: row.noteId,
  itemId: row.itemId,
  filename: row.filename,
  mime: row.mime,
  sizeBytes: row.sizeBytes,
  width: row.width,
  height: row.height,
  caption: row.caption,
  hasThumbnail: isPreviewableImage(row.mime),
  createdAt: row.createdAt,
});

function store(ctx: ServiceContext): FileStore {
  if (!ctx.files) throw new InvalidOperationError('File storage is not configured');
  return ctx.files;
}

export interface AttachmentInput {
  bytes: Uint8Array;
  filename: string;
  noteId?: string | null;
  itemId?: string | null;
  caption?: string | null;
}

export async function addAttachment(ctx: ServiceContext, projectId: string, input: AttachmentInput): Promise<Attachment> {
  const files = store(ctx);
  const assertTargets = (db: ServiceContext['db']) => {
    if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
      throw new NotFoundError('Project', projectId);
    }
    if (input.noteId && !db.select({ id: notes.id }).from(notes).where(and(eq(notes.id, input.noteId), eq(notes.projectId, projectId))).get()) {
      throw new NotFoundError('Note', input.noteId);
    }
    if (input.itemId) {
      const item = db
        .select({ id: checklistItems.id })
        .from(checklistItems)
        .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
        .where(and(eq(checklistItems.id, input.itemId), eq(checklists.projectId, projectId)))
        .get();
      if (!item) throw new NotFoundError('Item', input.itemId);
    }
  };
  assertTargets(ctx.db);

  const file = await processUpload(input.bytes, input.filename);
  const id = newId();
  const caption = input.caption?.trim().slice(0, 500) || null;

  // Everything from here on is synchronous, so a concurrent delete can't remove the file in between.
  files.put(file.sha256, file.bytes, file.thumbnail);
  try {
    ctx.db.transaction((tx) => {
      assertTargets(tx as unknown as ServiceContext['db']);
      tx.insert(attachments)
        .values({
          id,
          projectId,
          noteId: input.noteId ?? null,
          itemId: input.itemId ?? null,
          filename: file.filename,
          mime: file.mime,
          sizeBytes: file.bytes.byteLength,
          sha256: file.sha256,
          width: file.width,
          height: file.height,
          caption,
          createdAt: nowIso(ctx),
        })
        .run();
      touchProject(tx, ctx, projectId);
      logActivity(tx, ctx, {
        projectId,
        entity: 'attachment',
        entityId: id,
        action: 'create',
        diff: { filename: file.filename, mime: file.mime, sizeBytes: file.bytes.byteLength },
      });
    });
  } catch (err) {
    releaseFiles(ctx, [file.sha256]);
    throw err;
  }
  return toAttachment(ctx.db.select().from(attachments).where(eq(attachments.id, id)).get()!);
}

/** Attaches a file given as a public URL or as base64. */
export async function addAttachmentFrom(
  ctx: ServiceContext,
  projectId: string,
  source: { url?: string; base64?: string; filename?: string; noteId?: string; itemId?: string; caption?: string },
): Promise<Attachment> {
  if (Boolean(source.url) === Boolean(source.base64)) throw new InvalidOperationError('Provide either url or base64');
  if (source.base64) {
    if (!source.filename) throw new InvalidOperationError('A filename is required with base64');
    const clean = source.base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) throw new InvalidOperationError('Invalid base64');
    if ((clean.length / 4) * 3 > MAX_UPLOAD_BYTES + 2) throw new InvalidOperationError('Files can be at most 50 MB');
    return addAttachment(ctx, projectId, { ...source, bytes: Buffer.from(clean, 'base64'), filename: source.filename });
  }
  if (!ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
    throw new NotFoundError('Project', projectId);
  }
  const { bytes, filename } = await fetchPublicUrl(source.url!);
  return addAttachment(ctx, projectId, { ...source, bytes, filename: source.filename ?? filename });
}

/** Newest first. */
export function listAttachments(ctx: ServiceContext, projectId: string): Attachment[] {
  if (!ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
    throw new NotFoundError('Project', projectId);
  }
  return ctx.db
    .select()
    .from(attachments)
    .where(eq(attachments.projectId, projectId))
    .orderBy(desc(attachments.createdAt), desc(attachments.id))
    .all()
    .map(toAttachment);
}

export function attachmentsForNotes(ctx: ServiceContext, noteIds: string[]): Map<string, Attachment[]> {
  const byNote = new Map<string, Attachment[]>();
  if (noteIds.length === 0) return byNote;
  const rows = ctx.db.select().from(attachments).where(inArray(attachments.noteId, noteIds)).orderBy(attachments.createdAt, attachments.id).all();
  for (const row of rows) byNote.set(row.noteId!, [...(byNote.get(row.noteId!) ?? []), toAttachment(row)]);
  return byNote;
}

export function deleteAttachment(ctx: ServiceContext, id: string): void {
  const row = ctx.db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!row) throw new NotFoundError('Attachment', id);
  ctx.db.transaction((tx) => {
    tx.delete(attachments).where(eq(attachments.id, id)).run();
    tx.update(projects).set({ coverAttachmentId: null }).where(and(eq(projects.id, row.projectId), eq(projects.coverAttachmentId, id))).run();
    touchProject(tx, ctx, row.projectId);
    logActivity(tx, ctx, { projectId: row.projectId, entity: 'attachment', entityId: id, action: 'delete', diff: { filename: row.filename } });
  });
  releaseFiles(ctx, [row.sha256]);
}

export interface StoredFile {
  attachment: Attachment;
  path: string;
}

export function attachmentFile(ctx: ServiceContext, id: string, variant: 'file' | 'thumb' = 'file'): StoredFile {
  const files = store(ctx);
  const row = ctx.db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!row) throw new NotFoundError('Attachment', id);
  if (variant === 'thumb' && !isPreviewableImage(row.mime)) throw new NotFoundError('Thumbnail', id);
  return { attachment: toAttachment(row), path: variant === 'thumb' ? files.thumbPath(row.sha256) : files.filePath(row.sha256) };
}

export type AttachmentContent =
  | { kind: 'image'; attachment: Attachment; base64: string; mime: 'image/jpeg' }
  | { kind: 'text'; attachment: Attachment; text: string; pages?: number }
  | { kind: 'binary'; attachment: Attachment };

/** The attachment in a form a model can read: a resized image, extracted text, or only its details. */
export async function readAttachmentContent(ctx: ServiceContext, id: string): Promise<AttachmentContent> {
  const { attachment, path } = attachmentFile(ctx, id);
  if (isPreviewableImage(attachment.mime)) {
    return { kind: 'image', attachment, base64: (await resizeForModel(path)).toString('base64'), mime: 'image/jpeg' };
  }
  if (attachment.mime === 'application/pdf') {
    try {
      const { pages, text } = await pdfText(readFileSync(path));
      return { kind: 'text', attachment, pages, text };
    } catch {
      throw new InvalidOperationError('The text of this PDF could not be read');
    }
  }
  if (attachment.mime.startsWith('text/')) return { kind: 'text', attachment, text: plainText(readFileSync(path)) };
  return { kind: 'binary', attachment };
}
