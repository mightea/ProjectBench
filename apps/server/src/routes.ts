import {
  addAttachment,
  addItems,
  addLink,
  addNote,
  createApiToken,
  createChecklist,
  createProject,
  deleteAttachment,
  deleteChecklist,
  deleteItem,
  deleteLink,
  deleteNote,
  deleteProject,
  getProject,
  InvalidOperationError,
  itemsCreateSchema,
  listApiTokens,
  listAttachments,
  listProjects,
  listTags,
  MAX_UPLOAD_BYTES,
  noteTimeline,
  NotFoundError,
  revokeApiToken,
  updateChecklist,
  updateItem,
  updateLink,
  updateNote,
  updateProject,
  type Db,
  type FileStore,
  type ServiceContext,
} from '@projectbench/core';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';

/** Reads a JSON body; a missing or malformed body becomes an empty object so validation reports it. */
async function body(c: Context): Promise<unknown> {
  return c.req.json().catch(() => ({}));
}

export function apiRoutes(db: Db, files?: FileStore) {
  const ctx: ServiceContext = { db, actor: 'app', files };
  const api = new Hono();

  api.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof InvalidOperationError) return c.json({ error: err.message }, 409);
    if (err instanceof ZodError) {
      return c.json({ error: 'Invalid input', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400);
    }
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  // Projects
  api.get('/projects', (c) =>
    c.json(
      listProjects(ctx, {
        status: c.req.query('status') as never,
        tag: c.req.query('tag'),
        q: c.req.query('q'),
        sort: c.req.query('sort') as never,
      }),
    ),
  );
  api.post('/projects', async (c) => c.json(createProject(ctx, (await body(c)) as never), 201));
  api.get('/projects/:id', (c) => c.json(getProject(ctx, c.req.param('id'))));
  api.patch('/projects/:id', async (c) => c.json(updateProject(ctx, c.req.param('id'), (await body(c)) as never)));
  api.delete('/projects/:id', (c) => {
    deleteProject(ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  // Checklists
  api.post('/projects/:id/checklists', async (c) =>
    c.json(createChecklist(ctx, c.req.param('id'), (await body(c)) as never), 201),
  );
  api.patch('/checklists/:id', async (c) => c.json(updateChecklist(ctx, c.req.param('id'), (await body(c)) as never)));
  api.delete('/checklists/:id', (c) => {
    deleteChecklist(ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  // Items: accepts a single item or { items: [...] }
  api.post('/checklists/:id/items', async (c) => {
    const raw = (await body(c)) as Record<string, unknown>;
    const { items } = itemsCreateSchema.parse(Array.isArray(raw.items) ? raw : { items: [raw] });
    return c.json(addItems(ctx, c.req.param('id'), items), 201);
  });
  api.patch('/items/:id', async (c) => c.json(updateItem(ctx, c.req.param('id'), (await body(c)) as never)));
  api.delete('/items/:id', (c) => {
    deleteItem(ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  // Links
  api.post('/items/:id/links', async (c) => c.json(addLink(ctx, c.req.param('id'), (await body(c)) as never), 201));
  api.patch('/links/:id', async (c) => c.json(updateLink(ctx, c.req.param('id'), (await body(c)) as never)));
  api.delete('/links/:id', (c) => {
    deleteLink(ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  // Notes
  api.get('/projects/:id/notes', (c) => c.json(noteTimeline(ctx, c.req.param('id'))));
  api.post('/projects/:id/notes', async (c) => c.json(addNote(ctx, c.req.param('id'), (await body(c)) as never), 201));
  api.patch('/notes/:id', async (c) => c.json(updateNote(ctx, c.req.param('id'), (await body(c)) as never)));
  api.delete('/notes/:id', (c) => {
    deleteNote(ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  // Attachments
  api.get('/projects/:id/attachments', (c) => c.json(listAttachments(ctx, c.req.param('id'))));
  api.post(
    '/projects/:id/attachments',
    bodyLimit({
      // Room for the multipart framing around a file of the maximum size.
      maxSize: MAX_UPLOAD_BYTES + 1024 * 1024,
      onError: (c) => c.json({ error: 'Files can be at most 50 MB' }, 413),
    }),
    async (c) => {
      const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
      const file = form.file;
      if (!(file instanceof File)) return c.json({ error: 'Choose a file to upload' }, 400);
      if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'Files can be at most 50 MB' }, 413);
      const field = (name: string) => (typeof form[name] === 'string' && form[name] ? (form[name] as string) : undefined);
      const attachment = await addAttachment(ctx, c.req.param('id'), {
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
        noteId: field('note_id'),
        itemId: field('item_id'),
        caption: field('caption'),
      });
      return c.json(attachment, 201);
    },
  );
  api.delete('/attachments/:id', (c) => {
    deleteAttachment(ctx, c.req.param('id'));
    return c.body(null, 204);
  });

  // Tags
  api.get('/tags', (c) => c.json(listTags(db)));

  // MCP tokens
  api.get('/tokens', (c) => c.json(listApiTokens(ctx)));
  api.post('/tokens', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(createApiToken(ctx, (await body(c)) as never), 201);
  });
  api.delete('/tokens/:id', (c) => c.json(revokeApiToken(ctx, c.req.param('id'))));

  return api;
}
