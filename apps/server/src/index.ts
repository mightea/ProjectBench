import { serve } from '@hono/node-server';
import { deleteExpiredSessions, hasPassword, openDb, pruneOAuth, setPassword } from '@projectbench/core';
import { createApp } from './app.ts';
import { loadConfig, VERSION } from './config.ts';

const config = loadConfig();
const { db, close } = openDb({ filename: config.dbFile, migrationsFolder: config.migrationsDir });

if (config.initialPassword && !hasPassword(db)) {
  await setPassword(db, config.initialPassword);
  console.log('Login password set from INITIAL_PASSWORD.');
}

const app = createApp({ db, config });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`ProjectBench ${VERSION} listening on http://localhost:${info.port}`);
  console.log(`Data directory: ${config.dataDir}`);
  if (!hasPassword(db)) console.log(`No password set yet. Open ${config.publicUrl} to choose one.`);
});

const cleanup = setInterval(() => {
  deleteExpiredSessions(db);
  pruneOAuth(db);
}, 60 * 60_000);
cleanup.unref();

const shutdown = () => {
  clearInterval(cleanup);
  server.close(() => {
    close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
