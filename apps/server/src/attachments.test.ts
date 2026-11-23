import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { addAttachmentFrom, createApiToken, FileStore, InvalidOperationError, openDb, type Db } from '@projectbench/core';
import type { Attachment, Note, ProjectDetail } from '@projectbench/core/schemas';
import { isPublicAddress } from '../../../packages/core/src/fetch-url.ts';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, SESSION_COOKIE } from './app.ts';

let close: () => void;
let db: Db;
let dir: string;
let app: ReturnType<typeof createApp>;
let cookie = '';
let projectId = '';

const HOST = 'http://bench.test';

beforeEach(async () => {
  const handle = openDb({ filename: ':memory:' });
  close = handle.close;
  db = handle.db;
  dir = mkdtempSync(join(tmpdir(), 'projectbench-files-'));
  app = createApp({ db, config: { secureCookies: false, webDist: '/nonexistent', filesDir: dir } });
  const res = await app.request('/api/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'workbench-2026' }),
  });
  cookie = `${SESSION_COOKIE}=${res.headers.get('set-cookie')!.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))![1]}`;
  projectId = (await json<ProjectDetail>('POST', '/api/projects', { title: 'Rack fan controller' })).id;
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

async function json<T>(method: string, path: string, payload?: unknown): Promise<T> {
  const res = await app.request(path, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return (await res.json()) as T;
}

function upload(bytes: Uint8Array, filename: string, fields: Record<string, string> = {}, target = projectId, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new File([Buffer.from(bytes)], filename, { type }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return app.request(
    new Request(`${HOST}/api/projects/${target}/attachments`, { method: 'POST', headers: { cookie, origin: HOST, host: 'bench.test' }, body: form }),
  );
}

const uploaded = async (bytes: Uint8Array, filename: string, fields?: Record<string, string>) => {
  const res = await upload(bytes, filename, fields);
  expect(res.status).toBe(201);
  return (await res.json()) as Attachment;
};

const get = (path: string, withCookie = true) => app.request(path, { headers: withCookie ? { cookie } : {} });
const storedFiles = () =>
  (readdirSync(dir, { recursive: true }) as string[]).filter((f) => /[0-9a-f]{64}$/.test(f) && !f.startsWith('thumbs'));

const jpeg = (color = '#2F5BEA') => sharp({ create: { width: 800, height: 600, channels: 3, background: color } }).jpeg().toBuffer();

/** A one-page PDF with the given text. */
function pdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 40 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('uploads', () => {
  it('stores an image, strips its metadata and serves a thumbnail', async () => {
    const withGps = await sharp(await jpeg())
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '47/1 22/1 0/1' } })
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const a = await uploaded(withGps, 'fit.jpg');
    expect(a).toMatchObject({ mime: 'image/jpeg', width: 800, height: 600, hasThumbnail: true });

    const file = await get(`/files/${a.id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('inline');
    expect(file.headers.get('cache-control')).toContain('private');
    expect((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).exif).toBeUndefined();

    const thumb = await get(`/files/${a.id}/thumb`);
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(480);
  });

  it('converts HEIC photos to JPEG', async () => {
    const heic = readFileSync(new URL('./__fixtures__/photo.heic', import.meta.url));
    const a = await uploaded(heic, 'IMG_0001.HEIC');
    expect(a).toMatchObject({ filename: 'IMG_0001.jpg', mime: 'image/jpeg', hasThumbnail: true });
    expect(a.width).toBeGreaterThanOrEqual(64);
  });

  it('decides the type from the content and never serves active content inline', async () => {
    const html = await uploaded(Buffer.from('<html><script>alert(1)</script></html>'), 'photo.jpg');
    expect(html.mime).not.toMatch(/^image\//);
    const served = await get(`/files/${html.id}`);
    expect(served.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(served.headers.get('content-security-policy')).toContain('sandbox');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');

    const svg = await uploaded(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg');
    expect((await get(`/files/${svg.id}`)).headers.get('content-disposition')).toMatch(/^attachment/);
  });

  it('cleans file names and encodes them in the header', async () => {
    const a = await uploaded(Buffer.from('hello'), '../../etc/Lötkolben "neu".txt');
    expect(a.filename).toBe('Lötkolben neu.txt');
    const header = (await get(`/files/${a.id}`)).headers.get('content-disposition')!;
    expect(header).toContain("filename*=UTF-8''L%C3%B6tkolben%20neu.txt");
    expect(header).not.toMatch(/[\r\n]/);
  });

  it('rejects broken images, empty files, and targets from another project', async () => {
    const broken = Buffer.concat([(await jpeg()).subarray(0, 40)]);
    expect((await upload(broken, 'broken.jpg')).status).toBe(409);
    expect((await upload(new Uint8Array(), 'empty.txt')).status).toBe(409);

    const other = await json<ProjectDetail>('POST', '/api/projects', { title: 'Other' });
    const note = await json<Note>('POST', `/api/projects/${other.id}/notes`, { body: 'Elsewhere' });
    expect((await upload(Buffer.from('x'), 'a.txt', { note_id: note.id })).status).toBe(404);
    expect(storedFiles()).toEqual([]);
  });

  it('needs a session and a same-site origin', async () => {
    const a = await uploaded(Buffer.from('secret'), 'a.txt');
    expect((await get(`/files/${a.id}`, false)).status).toBe(401);
    expect((await get(`/files/${a.id}/thumb`, false)).status).toBe(401);

    const form = new FormData();
    form.append('file', new File(['x'], 'x.txt'));
    const cross = await app.request(
      new Request(`${HOST}/api/projects/${projectId}/attachments`, { method: 'POST', headers: { cookie, origin: 'https://evil.example' }, body: form }),
    );
    expect(cross.status).toBe(403);
  });

  it('accepts uploads behind a TLS proxy', async () => {
    const form = new FormData();
    form.append('file', new File(['x'], 'x.txt'));
    const res = await app.request(
      new Request(`${HOST}/api/projects/${projectId}/attachments`, {
        method: 'POST',
        headers: { cookie, origin: 'https://bench.test', host: 'bench.test' },
        body: form,
      }),
    );
    expect(res.status).toBe(201);
  });

  it('keeps a shared file until its last attachment is gone', async () => {
    const bytes = await jpeg();
    const first = await uploaded(bytes, 'a.jpg');
    const second = await uploaded(bytes, 'b.jpg');
    expect(storedFiles()).toHaveLength(1);

    await app.request(`/api/attachments/${first.id}`, { method: 'DELETE', headers: { cookie, 'content-type': 'application/json' } });
    expect((await get(`/files/${second.id}`)).status).toBe(200);

    await app.request(`/api/attachments/${second.id}`, { method: 'DELETE', headers: { cookie, 'content-type': 'application/json' } });
    expect(storedFiles()).toEqual([]);
    expect((await get(`/files/${second.id}`)).status).toBe(404);
  });

  it('removes files with their project, but not files another project shares', async () => {
    const bytes = await jpeg('#00aa00');
    const other = await json<ProjectDetail>('POST', '/api/projects', { title: 'Other' });
    await uploaded(bytes, 'a.jpg');
    await uploaded(await jpeg('#aa0000'), 'b.jpg');
    const res = await upload(bytes, 'shared.jpg', {}, other.id);
    expect(res.status).toBe(201);
    expect(storedFiles()).toHaveLength(2);

    await app.request(`/api/projects/${projectId}`, { method: 'DELETE', headers: { cookie, 'content-type': 'application/json' } });
    expect(storedFiles()).toHaveLength(1);
  });
});

describe('notes', () => {
  it('lists pinned notes first with their attachments, and keeps files when a note goes', async () => {
    const older = await json<Note>('POST', `/api/projects/${projectId}/notes`, { body: 'Board spec' });
    const newer = await json<Note>('POST', `/api/projects/${projectId}/notes`, { body: 'Test fit' });
    const file = await uploaded(Buffer.from('hello'), 'spec.txt', { note_id: older.id });
    await json('PATCH', `/api/notes/${older.id}`, { pinned: true });

    const timeline = await json<Note[]>('GET', `/api/projects/${projectId}/notes`);
    expect(timeline.map((n) => n.id)).toEqual([older.id, newer.id]);
    expect(timeline[0]!.attachments.map((a) => a.id)).toEqual([file.id]);

    await json('PATCH', `/api/notes/${newer.id}`, { body: 'Tray clears the PSU' });
    expect((await json<Note[]>('GET', `/api/projects/${projectId}/notes`))[1]!.body).toBe('Tray clears the PSU');

    await app.request(`/api/notes/${older.id}`, { method: 'DELETE', headers: { cookie, 'content-type': 'application/json' } });
    const files = await json<Attachment[]>('GET', `/api/projects/${projectId}/attachments`);
    expect(files).toMatchObject([{ id: file.id, noteId: null }]);
  });
});

describe('MCP attachments', () => {
  async function connect() {
    const { token } = createApiToken({ db, actor: 'app' }, { name: 'test' });
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
        fetch: ((input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch,
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }
  type Result = { isError?: boolean; content: { type: string; text?: string; mimeType?: string; data?: string }[] };

  it('adds a base64 file and reads images and PDFs back', async () => {
    const client = await connect();
    const add = async (bytes: Buffer, filename: string) => {
      const r = (await client.callTool({ name: 'add_attachment', arguments: { project: 'Rack fan', base64: bytes.toString('base64'), filename } })) as Result;
      expect(r.isError ?? false, r.content[0]!.text).toBe(false);
      return JSON.parse(r.content[0]!.text!) as { id: string };
    };

    const image = await add(await jpeg(), 'fit.jpg');
    const readImage = (await client.callTool({ name: 'get_attachment', arguments: { attachment_id: image.id } })) as Result;
    expect(readImage.content[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });

    const doc = await add(pdf('Noctua NF-A4x20 datasheet'), 'datasheet.pdf');
    const readPdf = (await client.callTool({ name: 'get_attachment', arguments: { attachment_id: doc.id } })) as Result;
    expect(readPdf.content[1]!.text).toContain('Noctua NF-A4x20 datasheet');

    const project = (await client.callTool({ name: 'get_project', arguments: { project: projectId } })) as Result;
    expect(project.content[0]!.text).toContain(`id: ${doc.id}`);
    await client.close();
  });

  it('refuses private URLs', async () => {
    const client = await connect();
    for (const url of ['http://127.0.0.1:8787/api/health', 'http://localhost/', 'http://[::ffff:192.168.1.1]/', 'http://169.254.169.254/latest', 'file:///etc/passwd']) {
      const r = (await client.callTool({ name: 'add_attachment', arguments: { project: projectId, url } })) as Result;
      expect(r.isError, url).toBe(true);
    }
    await client.close();
  });
});

describe('address checks', () => {
  it('tells public from private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254', '100.100.1.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::7f00:1', '64:ff9b::a00:1', '2002:a00:1::']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it('needs exactly one source', async () => {
    const ctx = { db, actor: 'mcp' as const, files: new FileStore(dir) };
    await expect(addAttachmentFrom(ctx, projectId, {})).rejects.toBeInstanceOf(InvalidOperationError);
    await expect(addAttachmentFrom(ctx, projectId, { url: 'https://example.com/a', base64: 'aGk=', filename: 'a' })).rejects.toBeInstanceOf(InvalidOperationError);
    expect(existsSync(join(dir, 'thumbs'))).toBe(false);
  });
});
