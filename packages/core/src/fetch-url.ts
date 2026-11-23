import { lookup } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { InvalidOperationError } from './errors.ts';
import { MAX_UPLOAD_BYTES } from './schemas.ts';

const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 30_000;

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, bits, 'ipv6');
}

/** Dotted IPv4 inside an IPv4-mapped or IPv4-compatible IPv6 address, if any. */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1]!;
  const hex = lower.match(/^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = parseInt(hex[1]!, 16);
  const low = parseInt(hex[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  const mapped = embeddedIpv4(address);
  if (mapped) return !blocked.check(mapped, 'ipv4');
  return !blocked.check(address, 'ipv6');
}

const refused = () => new InvalidOperationError('That address is not a public web address');

/** Resolves a host and rejects private addresses. The socket connects to the address checked here. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(refused() as NodeJS.ErrnoException, '', 0);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

function open(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, { lookup: publicLookup, signal, headers: { accept: '*/*', 'user-agent': 'ProjectBench' } }, resolve);
    req.on('error', reject);
    req.end();
  });
}

async function readBody(res: IncomingMessage): Promise<Buffer> {
  if (Number(res.headers['content-length'] ?? 0) > MAX_UPLOAD_BYTES) {
    res.destroy();
    throw new InvalidOperationError('Files can be at most 50 MB');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) {
      res.destroy();
      throw new InvalidOperationError('Files can be at most 50 MB');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function nameFrom(res: IncomingMessage, url: URL): string {
  const header = res.headers['content-disposition'] ?? '';
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the plain name.
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i)?.[1];
  if (plain) return plain;
  try {
    return decodeURIComponent(url.pathname.split('/').pop() ?? '') || url.hostname;
  } catch {
    return url.hostname;
  }
}

/** Fetches a small JSON document from a public HTTPS URL. Redirects are not followed. */
export async function fetchPublicJson(address: string, maxBytes = 16_384, timeoutMs = 5_000): Promise<unknown> {
  const url = new URL(address);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password) throw refused();
  if (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !isPublicAddress(host))) throw refused();
  const res = await open(url, AbortSignal.timeout(timeoutMs));
  if (res.statusCode !== 200) {
    res.resume();
    throw new InvalidOperationError(`The server answered with status ${res.statusCode}`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {
      res.destroy();
      throw new InvalidOperationError('The document is too large');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Downloads a public http(s) URL. Private and local addresses are refused, also after redirects. */
export async function fetchPublicUrl(address: string): Promise<{ bytes: Buffer; filename: string }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new InvalidOperationError('Invalid URL');
  }
  try {
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new InvalidOperationError('Only http(s) URLs can be fetched');
      if (url.username || url.password) throw new InvalidOperationError('URLs with credentials are not allowed');
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) throw refused();
      if (isIP(host) && !isPublicAddress(host)) throw refused();

      const res = await open(url, signal);
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        url = new URL(res.headers.location, url);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new InvalidOperationError(`The server answered with status ${status}`);
      }
      return { bytes: await readBody(res), filename: nameFrom(res, url) };
    }
  } catch (err) {
    if (err instanceof InvalidOperationError) throw err;
    throw new InvalidOperationError('The file could not be downloaded');
  }
  throw new InvalidOperationError('Too many redirects');
}
