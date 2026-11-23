import { eq } from 'drizzle-orm';
import { attachments } from '../schema.ts';
import type { ServiceContext } from './context.ts';

/** Deletes stored files that no attachment points to any more. Call after the transaction committed. */
export function releaseFiles(ctx: ServiceContext, hashes: Iterable<string>) {
  if (!ctx.files) return;
  for (const sha256 of new Set(hashes)) {
    const used = ctx.db.select({ id: attachments.id }).from(attachments).where(eq(attachments.sha256, sha256)).limit(1).get();
    if (!used) ctx.files.remove(sha256);
  }
}
