# ProjectBench

[![CI](https://github.com/mightea/ProjectBench/actions/workflows/ci.yml/badge.svg)](https://github.com/mightea/ProjectBench/actions/workflows/ci.yml)

A small self-hosted app for personal projects: checklists for things to buy and questions to clarify, notes, photos and files, priorities and due dates. It is built phone-first as an installable web app (PWA), and an MCP server lets Claude read and update projects.

**Status:** phase 5 done, phase 6 shelved. You can manage projects and checklists (to buy, to clarify, to do) with shop links, an ordered state and drag-to-reorder, keep a notes timeline with photos and files, and connect Claude through MCP. Today, Buy and Search give a view across all projects and can be filtered by tag, projects you have opened stay readable offline, and the app has a light and a dark theme.

## Stack

| Part | Choice |
| --- | --- |
| Server | Node 26, [Hono](https://hono.dev), TypeScript |
| Database | SQLite (WAL) via better-sqlite3 and [Drizzle ORM](https://orm.drizzle.team) |
| Web app | React, Vite, TanStack Query, Tailwind CSS, vite-plugin-pwa |
| Tests | Vitest |

```
packages/core   database schema, migrations, auth, services and input schemas (shared by REST API and MCP)
apps/server     Hono server: /api/*, /mcp, serves the built PWA
apps/web        React PWA
apps/mcp-stdio  stdio bridge to /mcp for MCP clients that don't speak HTTP
```

## Development

Requirements: Node 22 or newer (26 recommended) and pnpm. pnpm switches to the version pinned in `package.json` on its own.

```sh
pnpm install
cp .env.example .env      # optional
pnpm dev                  # server on :8787, web app with hot reload on :5173
```

Open http://localhost:5173. On the first visit you choose the login password.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Server (tsx watch) and Vite dev server; Vite proxies `/api` and `/mcp` to the server |
| `pnpm test` | All tests |
| `pnpm typecheck` | TypeScript checks for every package |
| `pnpm build` | Builds the PWA and bundles the server and stdio bridge into their `dist` folders |
| `pnpm start` | Runs the built server, serving the PWA on :8787 |
| `pnpm db:generate` | Creates a new SQL migration after changing `packages/core/src/schema.ts` |

Migrations run automatically when the server starts.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Folder for `projectbench.db` and uploaded files (`files/`) |
| `PORT` | `8787` | HTTP port |
| `PUBLIC_URL` | `http://localhost:8787` | Public address; an `https://` URL turns on Secure cookies and passkeys (a domain name, not an IP). Passkeys stop working if the domain changes |
| `INITIAL_PASSWORD` | – | Sets the login password on first start instead of the setup screen |

## Connecting Claude (MCP)

Create a token under **Settings → Claude access**. It is shown once and stored only as a hash; revoke it there at any time.

Claude Code, over HTTP:

```sh
claude mcp add --transport http projectbench https://projectbench.example.com/mcp \
  --header "Authorization: Bearer pb_your_token"
```

Clients that need stdio, such as Claude Desktop, can use the bridge after `pnpm build`:

```json
{
  "mcpServers": {
    "projectbench": {
      "command": "node",
      "args": ["/path/to/ProjectBench/apps/mcp-stdio/dist/index.js"],
      "env": {
        "PROJECTBENCH_URL": "https://projectbench.example.com",
        "PROJECTBENCH_TOKEN": "pb_your_token"
      }
    }
  }
}
```

Tools: `list_projects`, `get_project`, `create_project`, `update_project`, `add_items`, `update_item`, `set_item_links`, `add_note`, `get_attachment`, `add_attachment`, `search`, `agenda`, `shopping_list` and `open_questions`. Projects can be named by id or title. Claude can't delete projects, checklists, items or files, and its changes are logged with the actor `mcp`. `add_attachment` takes base64 or a public URL; it refuses private and local network addresses.

A custom connector in the Claude phone app needs public HTTPS and OAuth, which ProjectBench doesn't offer yet.

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please), using calendar versions (`YYYY.M.patch`, e.g. `2026.11.1`) like MotoManager:

1. Commit to `main` with [Conventional Commits](https://www.conventionalcommits.org) (`feat: …`, `fix: …`). A commit-msg hook checks this locally.
2. release-please keeps a release pull request open with the next version and the changelog.
3. Merging that pull request tags the release, creates the GitHub release and updates `CHANGELOG.md`.
4. The tag triggers **Publish Container Image**, which pushes `ghcr.io/mightea/projectbench:<version>` and `:latest`.

The first commit of a new month starts a new `YYYY.M.0` line automatically.

One-time setup: add a fine-grained personal access token as the repository secret `RELEASE_PLEASE_PAT` (contents and pull requests: read/write). Tags created with the default `GITHUB_TOKEN` do not trigger other workflows, so without it the image is not published.

## Deploying on TrueNAS

1. Create a dataset for the data, e.g. `/mnt/tank/apps/projectbench`, writable by user 568 (`apps`).
2. Install the app with `docker-compose.yml` (Apps → Discover → Install via YAML). It uses `ghcr.io/mightea/projectbench:latest`; adjust `PUBLIC_URL` and the volume path.
3. Open the app and choose a password.
4. To update after a release, pull the new image and restart the app (in TrueNAS: the app's *Update* / *Pull image* action). Pin a version tag instead of `latest` if you want to update deliberately.

If the GitHub package is private, log TrueNAS in to `ghcr.io` with a token that can read packages, or make the package public in its GitHub settings.

To build an image locally instead (e.g. on an Apple Silicon Mac for an x86 server):

```sh
docker buildx build --platform linux/amd64 -t projectbench:latest --load .
docker save projectbench:latest | ssh root@truenas.example.com docker load
```

Back up the dataset with TrueNAS snapshots, which cover the database and the `files/` folder together. A safe copy of the database while the app runs: `sqlite3 projectbench.db ".backup backup.db"`.

## Roadmap

1. **Skeleton** – schema, server, login, PWA shell, Docker ← *done*
2. **Projects and checklists** ← *done*
3. **MCP server** ← *done*
4. **Notes and attachments** ← *done*
5. **Daily-use polish** (Today, Buy, search, offline reading) ← *done*
6. Extras (iCal feed, reminders, export) ← *shelved*

## License

[PolyForm Noncommercial 1.0.0](LICENSE)
