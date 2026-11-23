/// <reference path="./heic-decode.d.ts" />
import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import decodeHeic from 'heic-decode';
import sharp from 'sharp';
import { extractText, getDocumentProxy } from 'unpdf';
import { InvalidOperationError } from './errors.ts';
import { MAX_UPLOAD_BYTES } from './schemas.ts';

const MAX_PIXELS = 100_000_000;
const THUMB_SIZE = 480;
const MCP_IMAGE_SIZE = 1568;
const MCP_TEXT_LIMIT = 100_000;

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
/** Re-encoded on upload, which also removes EXIF data such as GPS positions. */
const REENCODED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_TYPES = new Set([...REENCODED, 'image/gif']);

export interface ProcessedFile {
  bytes: Buffer;
  sha256: string;
  filename: string;
  mime: string;
  width: number | null;
  height: number | null;
  thumbnail: Buffer | null;
}

export const isPreviewableImage = (mime: string) => IMAGE_TYPES.has(mime);

/** Keeps only the base name, without control or path characters. */
export function cleanFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim().replace(/^\.+/, '');
  if (!clean) return 'file';
  if (clean.length <= 200) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : '';
  return clean.slice(0, 200 - ext.length) + ext;
}

function looksLikeText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    // Streaming mode tolerates a multi-byte character cut off at the end of the sample.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 1024 * 1024), { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** Decides the type from the content. The name and the type the client claims are ignored. */
async function sniff(bytes: Buffer): Promise<string> {
  const detected = await fileTypeFromBuffer(bytes);
  if (detected) return detected.mime;
  return looksLikeText(bytes) ? 'text/plain' : 'application/octet-stream';
}

async function heicToJpeg(input: Buffer): Promise<Buffer> {
  const images = await decodeHeic.all({ buffer: input });
  try {
    const first = images[0];
    if (!first) throw new InvalidOperationError('This HEIC file has no image');
    if (first.width * first.height > MAX_PIXELS) throw new InvalidOperationError('This image is too large');
    const { width, height, data } = await first.decode();
    return await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  } finally {
    images.dispose();
  }
}

async function reencode(input: Buffer, mime: string): Promise<Buffer> {
  // sharp drops metadata unless asked to keep it; rotate() first applies the EXIF orientation.
  const image = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();
  if (mime === 'image/jpeg') return image.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  if (mime === 'image/png') return image.png().toBuffer();
  return image.webp({ quality: 88 }).toBuffer();
}

/** Validates an upload, converts HEIC to JPEG, strips image metadata and renders a thumbnail. */
export async function processUpload(input: Uint8Array, filename: string): Promise<ProcessedFile> {
  if (input.byteLength === 0) throw new InvalidOperationError('The file is empty');
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new InvalidOperationError('Files can be at most 50 MB');

  let bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let name = cleanFilename(filename);
  let mime = await sniff(bytes);
  let width: number | null = null;
  let height: number | null = null;
  let thumbnail: Buffer | null = null;

  try {
    if (HEIC_TYPES.has(mime)) {
      bytes = await heicToJpeg(bytes);
      mime = 'image/jpeg';
      name = `${name.replace(/\.(heic|heif)$/i, '')}.jpg`;
    } else if (REENCODED.has(mime)) {
      bytes = await reencode(bytes, mime);
    }
    if (IMAGE_TYPES.has(mime)) {
      const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
      width = meta.width;
      height = meta.pageHeight ?? meta.height;
      thumbnail = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 76 })
        .toBuffer();
    }
  } catch (err) {
    if (err instanceof InvalidOperationError) throw err;
    throw new InvalidOperationError('This image could not be read');
  }

  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), filename: name, mime, width, height, thumbnail };
}

/** A JPEG small enough to hand to a model. */
export async function resizeForModel(path: string): Promise<Buffer> {
  return sharp(path, { limitInputPixels: MAX_PIXELS })
    .resize(MCP_IMAGE_SIZE, MCP_IMAGE_SIZE, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer();
}

const limitText = (value: string) =>
  value.length > MCP_TEXT_LIMIT ? `${value.slice(0, MCP_TEXT_LIMIT)}\n\n[Truncated at ${MCP_TEXT_LIMIT} characters]` : value;

export async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text: limitText(text.trim()) };
}

export const plainText = (bytes: Uint8Array) => limitText(new TextDecoder().decode(bytes));
