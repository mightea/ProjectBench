# ProjectBench

Self-hosted, phone-first app for personal projects: checklists (to buy, to clarify, to do), notes, files, priorities and due dates, plus an MCP server so Claude can read and update projects. Single user, runs as one Docker container on TrueNAS.

- Design & implementation plan: https://claude.ai/artifact/VnZbjusNut8jUFbijt6xMR (data model, REST API, MCP tools, phases)
- UX design (phone + desktop screens): https://claude.ai/artifact/T1vPTN7qmYdXox68z3nYak
- Roadmap and status: README.md

## Layout

```
packages/core   SQLite schema (Drizzle), migrations, auth, services, shared Zod schemas
apps/server     Hono: /api/* REST routes, /mcp (stateless Streamable HTTP), serves the built PWA
apps/web        React + Vite + TanStack Query + Tailwind PWA
apps/mcp-stdio  stdio bridge to /mcp; never opens the database
```

- All business rules live in `packages/core/src/services/`. REST routes and MCP tools (`apps/server/src/mcp.ts`) are thin adapters that call these services, so app and Claude behave the same.
- MCP uses revocable bearer tokens (`api_tokens`, SHA-256 hashed). Keep destructive tools out of MCP.
- `packages/core/src/schemas.ts` holds input schemas and API types. It must stay browser-safe (no Node/db imports); the web app imports it via `@projectbench/core/schemas`.
- Every write runs in a transaction that also updates the FTS `search` table and the `activity` log (`actor: 'app' | 'mcp'`).
- Manual ordering uses fractional-index `sort_key` strings (`keyAt()` in `services/context.ts`); moves take a `position` index among siblings.
- Sub-projects: `projects.parent_id`, one level deep (checked in `assertValidParent()`). A sub-project is a full project with its own lists, notes and files; it starts with its parent's color, icon and tags. Deleting a parent frees its sub-projects (`ON DELETE SET NULL`). The overview and sidebar nest them under the parent.
- Buy items have three states: `open → ordered → done`; `ordered` only on buy lists. Items can have several shop links, one `preferred`.

## Commands

```sh
pnpm install
pnpm dev          # server :8787 (tsx watch) + Vite :5173 with /api proxy
pnpm test         # vitest in all packages
pnpm typecheck
pnpm build        # web build + bundled server in apps/server/dist
pnpm db:generate  # new migration after editing packages/core/src/schema.ts
```

Run `pnpm test` and `pnpm typecheck` before committing; the pre-commit hook runs typecheck.

## Conventions

- Conventional Commits, enforced by commitlint: no scopes, body lines ≤ 100 characters.
- Releases via release-please with calendar versions (`YYYY.M.patch`); merging the release PR tags it and publishes `ghcr.io/mightea/projectbench`.
- Never commit real host names: CI fails on `*.herrmann.ltd`. Use `example.com` placeholders.
- Work on a feature branch and open a pull request; don't push to `main` directly.
- Keep `better-sqlite3` on 12.x: 13.x ships no prebuilt binaries and needs Xcode Command Line Tools to install.
- UI: Inter + Space Grotesk, accent `#2F5BEA`, tokens in `apps/web/src/index.css`. Touch targets ≥ 44 px; real buttons and labels.

## Attachments

- Files are content-addressed under `<DATA_DIR>/files`; delete rows through the services so unreferenced files are removed.
- Types are sniffed from content. Only raster images and PDFs are served inline.
- `sharp`, `heic-decode` and `unpdf` stay external in the server bundle and are installed in the Dockerfile.
- `add_attachment` URL fetches must keep refusing private addresses (`packages/core/src/fetch-url.ts`).
- `start_upload` hands out one-time links to `PUT /mcp/upload/<ticket>` (`apps/server/src/uploads.ts`). The ticket is the only credential: keep it single-use, short-lived and in memory.
- Note bodies are Markdown, rendered by `apps/web/src/components/Markdown.tsx`. It must not render raw HTML or load remote images.

## Offline reading

- Read queries persist to IndexedDB (`apps/web/src/lib/offline.ts`, allowlist of query keys). Never add API tokens to it.
- Cached data and thumbnails are wiped when the session ends. Writes fail fast offline; they are not queued.

## Theming and tags

- Colors are semantic tokens in `apps/web/src/index.css`, redefined for `data-theme="dark"`. Don't use raw hex values or `text-white` on surfaces that change with the theme.
- Tags are part of the FTS index on project rows. `#tag` in a search query limits results to that tag, and Today, Buy and Projects filter through `?tag=`.

## Shelved: phase 6 — extras

iCal feed, reminders and export are on hold until picked up again.
