import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { attachmentFile, NotFoundError, type ServiceContext } from '@projectbench/core';
import { Hono, type Context } from 'hono';

/** Only these open in the browser. Everything else, HTML and SVG included, is a download. */
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

export function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function send(c: Context, path: string, headers: Record<string, string>) {
  if (!existsSync(path)) return c.json({ error: 'File not found' }, 404);
  const size = statSync(path).size;
  const stream = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      'Content-Length': String(size),
      // Ids never change their content, and only this browser may keep a copy.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

/** GET /files/:id and /files/:id/thumb. The caller checks the session. */
export function fileRoutes(ctx: ServiceContext) {
  const files = new Hono();

  files.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  files.get('/:id', (c) => {
    const { attachment, path } = attachmentFile(ctx, c.req.param('id'));
    const inline = INLINE_TYPES.has(attachment.mime) && c.req.query('download') === undefined;
    return send(c, path, {
      'Content-Type': attachment.mime,
      'Content-Disposition': contentDisposition(attachment.filename, inline),
      // Browsers can't show a PDF inside a sandbox; every other type gets one.
      ...(attachment.mime === 'application/pdf' ? {} : { 'Content-Security-Policy': "default-src 'none'; sandbox" }),
    });
  });

  files.get('/:id/thumb', (c) => {
    const { path } = attachmentFile(ctx, c.req.param('id'), 'thumb');
    return send(c, path, { 'Content-Type': 'image/webp', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  });

  return files;
}
