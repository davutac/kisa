# Kisa

Kisa is a minimal Gmail desktop client built with Electron, React, TypeScript, Effect, SQLite, and Cloudflare Workers.

## Workspaces

- `apps/desktop` — the Electron host and React renderer.
- `apps/auth-worker` — the Cloudflare OAuth handoff worker, deployed with Alchemy.
- `packages/database` — the Drizzle/SQLite client, runtime, schemas, and migrations.
- `packages/gmail` — reusable Gmail domain models and service boundaries.

The desktop main process owns privileged capabilities. The sandboxed renderer accesses them only through the typed `window.desktopBridge` preload API. IPC payloads and results are validated with Effect Schema. See [`docs/architecture/desktop.md`](docs/architecture/desktop.md) for the module layout and communication flow.

## Setup

Use pnpm 11.20.0, as pinned by `packageManager`.

```bash
pnpm install
pnpm dev
```

Run only the desktop app with:

```bash
pnpm --dir apps/desktop dev
```

Development launches use `<userData>/database/app.dev.sqlite`, keeping local development mail data separate from the installed app's `app.sqlite` database.

The OAuth worker has separate configuration and deployment requirements; see [`apps/auth-worker/README.md`](apps/auth-worker/README.md).

## Verification

The repository checks are:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

## Packaging and releases

Build platform packages with `pnpm build:mac`, `pnpm build:win`, or `pnpm build:linux`. `pnpm build:unpack` creates an unpacked application.

Create a release with an exact version or bump type:

```bash
pnpm release patch
pnpm release 0.1.0
```

The helper requires a clean tree, checks the repository, updates `apps/desktop/package.json`, creates the release commit and tag, and pushes unless `--no-push` is supplied.
