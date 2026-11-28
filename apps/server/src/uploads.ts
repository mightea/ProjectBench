import { randomBytes } from 'node:crypto';
import {
  addAttachment,
  InvalidOperationError,
  MAX_UPLOAD_BYTES,
  NotFoundError,
  type Attachment,
  type ServiceContext,
} from '@projectbench/core';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

const TICKET_TTL_MS = 15 * 60 * 1000;
const MAX_TICKETS = 200;

export interface UploadTarget {
  projectId: string;
  filename: string;
  noteId?: string;
  itemId?: string;
  caption?: string;
}

interface Ticket {
  target: UploadTarget;
  expiresAt: number;
}

/**
 * One-time upload links handed out by the start_upload MCP tool, so a client can send a local file
 * directly instead of passing it through the model as base64. A restart only means asking again.
 */
export class UploadTickets {
  private readonly open = new Map<string, Ticket>();

  add(target: UploadTarget, now = Date.now()): { id: string; expiresAt: number } {
    for (const [id, entry] of this.open) if (entry.expiresAt <= now) this.open.delete(id);
    while (this.open.size >= MAX_TICKETS) this.open.delete(this.open.keys().next().value!);
    const id = randomBytes(32).toString('base64url');
    const expiresAt = now + TICKET_TTL_MS;
    this.open.set(id, { target, expiresAt });
    return { id, expiresAt };
  }

  /** Removes the ticket, so a link works once. */
  take(id: string, now = Date.now()): Ticket | undefined {
    const entry = this.open.get(id);
    this.open.delete(id);
    return entry && entry.expiresAt > now ? entry : undefined;
  }

  /** Puts a ticket back after a failed upload, so the same link can be tried again. */
  restore(id: string, entry: Ticket): void {
    this.open.set(id, entry);
  }
}

/** Creates upload links for the MCP server. */
export interface UploadLinks {
  create(target: UploadTarget): { url: string; expiresAt: string };
}

export const uploadLinks = (tickets: UploadTickets, origin: string): UploadLinks => ({
  create(target) {
    const { id, expiresAt } = tickets.add(target);
    return { url: `${origin}/mcp/upload/${id}`, expiresAt: new Date(expiresAt).toISOString() };
  },
});

export const attachmentInfo = ({ id, filename, mime, sizeBytes, width, height, caption, noteId, itemId, createdAt }: Attachment) => ({
  id,
  filename,
  mime,
  size_bytes: sizeBytes,
  width,
  height,
  caption,
  note_id: noteId,
  item_id: itemId,
  created_at: createdAt,
});

/** PUT or POST the raw file to /:ticket. The ticket is the only credential, so it is checked before the body is read. */
export function uploadRoutes(ctx: ServiceContext, tickets: UploadTickets) {
  const uploads = new Hono<{ Variables: { ticket: Ticket } }>();

  uploads.on(
    ['PUT', 'POST'],
    '/:ticket',
    async (c, next) => {
      const id = c.req.param('ticket');
      const entry = tickets.take(id);
      if (!entry) return c.json({ error: 'This upload link is unknown, already used or expired. Ask for a new one with start_upload.' }, 404);
      c.set('ticket', entry);
      let failed = true;
      try {
        await next();
        failed = c.res.status >= 400;
      } finally {
        if (failed) tickets.restore(id, entry);
      }
      return;
    },
    bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => c.json({ error: 'Files can be at most 50 MB' }, 413) }),
    async (c) => {
      const { target } = c.get('ticket');
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength === 0) return c.json({ error: 'The request body is empty. Send the file as the body, for example with curl -T.' }, 400);
      try {
        const attachment = await addAttachment(ctx, target.projectId, { ...target, bytes });
        return c.json(attachmentInfo(attachment), 201);
      } catch (err) {
        if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
        if (err instanceof InvalidOperationError) return c.json({ error: err.message }, 400);
        console.error(err);
        return c.json({ error: 'Internal error' }, 500);
      }
    },
  );

  uploads.all('/*', (c) => c.json({ error: 'Not found' }, 404));
  return uploads;
}
