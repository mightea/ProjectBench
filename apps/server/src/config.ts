import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultMigrationsFolder } from '@projectbench/core';

declare const __APP_VERSION__: string | undefined;

/** Release version: APP_VERSION from the Docker build, else the version baked in at build time. */
export const VERSION =
  process.env.APP_VERSION || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev');

const here = dirname(fileURLToPath(import.meta.url));

export interface Config {
  port: number;
  dataDir: string;
  dbFile: string;
  filesDir: string;
  publicUrl: string;
  secureCookies: boolean;
  webDist: string;
  migrationsDir: string;
  initialPassword?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env.DATA_DIR ?? './data');
  const publicUrl = env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 8787}`;
  // The bundled build ships its migrations next to dist/index.js; in dev they come from packages/core.
  const bundledMigrations = resolve(here, 'drizzle');
  return {
    port: Number(env.PORT ?? 8787),
    dataDir,
    dbFile: resolve(dataDir, 'projectbench.db'),
    filesDir: resolve(dataDir, 'files'),
    publicUrl,
    secureCookies: publicUrl.startsWith('https://'),
    webDist: resolve(env.WEB_DIST ?? resolve(here, '../../web/dist')),
    migrationsDir: env.MIGRATIONS_DIR ?? (existsSync(bundledMigrations) ? bundledMigrations : defaultMigrationsFolder),
    initialPassword: env.INITIAL_PASSWORD || undefined,
  };
}
