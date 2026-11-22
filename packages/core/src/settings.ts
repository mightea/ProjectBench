import { eq, sql } from 'drizzle-orm';
import type { Db } from './db.ts';
import { settings } from './schema.ts';

export function getSetting(db: Db, key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` },
    })
    .run();
}
