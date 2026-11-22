import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema>;

export interface OpenDbOptions {
  /** Path to the SQLite file, or ':memory:' for tests. */
  filename: string;
  /** Folder with the drizzle-kit SQL migrations. Defaults to this package's ./drizzle folder. */
  migrationsFolder?: string;
}

export const defaultMigrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

/** Opens (and creates if needed) the database, applies pragmas and runs pending migrations. */
export function openDb({ filename, migrationsFolder = defaultMigrationsFolder }: OpenDbOptions) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });

  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });

  return { db, sqlite, close: () => sqlite.close() };
}
