import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Content-addressed file storage: <root>/ab/cd/<sha256>, thumbnails under <root>/thumbs.
 * Writes are synchronous so a write and its database transaction can't interleave with a delete.
 */
export class FileStore {
  constructor(private readonly root: string) {}

  private at(base: string, sha256: string, suffix = ''): string {
    if (!SHA256.test(sha256)) throw new Error('Invalid file hash');
    return join(base, sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}${suffix}`);
  }

  filePath(sha256: string): string {
    return this.at(this.root, sha256);
  }

  thumbPath(sha256: string): string {
    return this.at(join(this.root, 'thumbs'), sha256, '.webp');
  }

  private write(path: string, bytes: Uint8Array) {
    if (existsSync(path)) return;
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(temp, bytes);
      renameSync(temp, path);
    } catch (err) {
      rmSync(temp, { force: true });
      throw err;
    }
  }

  put(sha256: string, bytes: Uint8Array, thumbnail?: Uint8Array | null) {
    this.write(this.filePath(sha256), bytes);
    if (thumbnail) this.write(this.thumbPath(sha256), thumbnail);
  }

  remove(sha256: string) {
    rmSync(this.filePath(sha256), { force: true });
    rmSync(this.thumbPath(sha256), { force: true });
  }
}
