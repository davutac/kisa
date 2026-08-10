# Kisa

**A fast, local-first Gmail client built for the desktop.**

Kisa caches and indexes mail locally for fast search, handles multiple Google
accounts, and isolates untrusted content behind a narrow Electron security
boundary.

> Kisa is under active development and currently runs from source.

## Why Kisa

I started Kisa when Notion announced that
[Notion Mail will shut down on September 22, 2026](https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next).
Rather than return to Gmail in a browser, I began building the fast,
keyboard-first client I wanted.

- **Mailbox-scale performance.** Local caching, full-text search, virtualized
  lists, and resumable indexing keep large mailboxes responsive.
- **Keyboard-first workflow.** Switch accounts, search, compose, and navigate
  without the mouse.
- **Privacy by default.** OAuth credentials stay in the main process, and the
  local database is encrypted. Message HTML is isolated, and remote images are
  blocked until allowed.
- **Built for multiple accounts.** Caches, indexes, sync state, and mutations
  stay account-scoped, with an All Accounts view across them.

## Tech stack

| Area | Technology |
| --- | --- |
| Desktop | [Electron](https://github.com/electron/electron) |
| Interface | [React](https://github.com/react/react), [TypeScript](https://github.com/microsoft/TypeScript), [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss), [shadcn](https://github.com/shadcn-ui/ui) |
| Application runtime | [Effect](https://github.com/Effect-TS/effect) |
| Routing and state | [TanStack Router](https://github.com/TanStack/router), [Zustand](https://github.com/pmndrs/zustand) |
| Local data | [better-sqlite3-multiple-ciphers](https://github.com/m4heshd/better-sqlite3-multiple-ciphers), [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm), FTS5 |
| Gmail integration | [Gmail API client](https://github.com/googleapis/google-api-nodejs-client), OAuth 2.0 with PKCE |
| OAuth handoff | [Cloudflare Workers](https://github.com/cloudflare/workers-sdk), [Alchemy](https://github.com/alchemy-run/alchemy-async) |
| Tooling | [pnpm](https://github.com/pnpm/pnpm), [Turborepo](https://github.com/vercel/turborepo), [Vite](https://github.com/vitejs/vite), [Vitest](https://github.com/vitest-dev/vitest), [Ultracite](https://github.com/haydenbleasel/ultracite) |

## Architecture

Privileged capabilities stay in Electron's main process. The sandboxed renderer
accesses them only through the typed `window.desktopBridge`; Effect Schema
validates every IPC request, result, and event.

Synchronous database work runs in a utility process, keeping Electron's main
thread unblocked. Gmail sync and indexing are bounded, resumable, and yield to
foreground actions.

```text
React feature or hook
  -> renderer platform adapter
  -> typed preload bridge
  -> schema-validated Electron IPC
  -> main-process service
     -> Gmail API, or
     -> database utility process -> SQLite
```

See the [desktop architecture](docs/architecture/desktop.md) for details.

## Repository

- `apps/desktop` — Electron main, preload, database process, and React renderer.
- `apps/auth-worker` — Cloudflare OAuth handoff worker, deployed with Alchemy.
- `packages/database` — database client, runtime, schemas, and migrations.
- `packages/gmail` — Gmail domain models, services, and boundaries.
- `docs/architecture` — current architecture and feature contracts.

## Run from source

pnpm 11.20.0 is pinned through `packageManager`.

```bash
pnpm install
pnpm dev
```

To run only the desktop:

```bash
pnpm --dir apps/desktop dev
```

Development uses `<userData>/database/app.dev.sqlite` and its own sealed key,
separate from the installed app's `app.sqlite` database and key.

Configure the [OAuth worker](apps/auth-worker/README.md) before connecting an
account.

## Verification

Run all checks with:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

## Packaging and releases

Build packages with `pnpm build:mac`, `pnpm build:win`, or `pnpm build:linux`.
`pnpm build:unpack` creates an unpacked app.

Release by exact version or bump type:

```bash
pnpm release patch
pnpm release 0.1.0
```

The helper requires a clean tree, runs checks, updates
`apps/desktop/package.json`, commits, tags, and pushes unless `--no-push` is
supplied.

## Inspiration

Kisa borrows [T3 Code's](https://github.com/pingdotgg/t3code) narrow, typed
Electron boundaries, adapted to a local-first mail client without its server
and RPC layer. See the [detailed comparison](docs/research/t3code-electron-architecture.md).

## License

Kisa is [MIT licensed](LICENSE).
