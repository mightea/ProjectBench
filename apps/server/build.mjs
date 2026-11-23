// Bundles the server (including @projectbench/core) into dist/index.js.
// Native and WASM modules stay external and are installed in the Docker image.
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist', { recursive: true, force: true });

const { version } = JSON.parse(readFileSync('../../package.json', 'utf8'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['better-sqlite3', 'sharp', 'heic-decode', 'unpdf'],
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || version) },
  banner: {
    // Some bundled CommonJS dependencies call require(); give them one.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

cpSync('../../packages/core/drizzle', 'dist/drizzle', { recursive: true });
console.log('Built dist/index.js and copied migrations to dist/drizzle');
