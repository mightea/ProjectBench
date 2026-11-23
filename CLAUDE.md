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

## Next: phase 4 — notes and attachments

Notes timeline in the app, multipart upload, sharp thumbnails and HEIC conversion, Files tab, camera button, and the `get_attachment` and `add_attachment` MCP tools.
