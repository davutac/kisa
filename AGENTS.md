# Kisa

Kisa is a minimal, local-first desktop mail client for Gmail, iCloud, and other IMAP accounts, built with Electron, React, TypeScript, Effect, and SQLite.

## What Kisa Must Not Compromise

### 1. A calm, minimal mail experience

Kisa should make reading and acting on mail feel obvious. Prefer a small, coherent interaction model over adding controls, modes, or abstractions. Preserve native desktop expectations, keyboard access, useful loading and empty states, and clear feedback for destructive or remote actions.

### 2. Responsiveness at mailbox scale

Users notice slow startup, a blocked window, jumping thread selection, and stale mail immediately. Keep synchronous SQLite work in the database utility process, virtualize long lists, avoid unnecessary renderer work, and keep foreground mail actions ahead of background indexing. Backfills and synchronization must remain bounded, resumable, and safe to interrupt.

### 3. Privacy by default

Email is hostile, private input. Credentials stay encrypted in the main process and never cross into the renderer. Message HTML stays isolated, remote images remain blocked until the user permits them, and links and attachments are handled through narrow capabilities. Never trade these properties for convenience.

### 4. Correctness across accounts and restarts

Kisa is multi-account and local-first. Every mailbox, cache, index, progress record, event, and mutation must be scoped to the correct account. Work should survive restarts without skipping data, duplicating user-visible state, or silently diverging from Gmail.

## Working Approach

Understand the real constraint, then implement the smallest model that makes the correct behavior unsurprising. Do not preserve complexity solely because it exists, and do not introduce machinery for hypothetical needs. Measure before optimizing, but treat obvious main-thread blocking, unbounded work, and mailbox-scale renderer loops as design problems rather than future cleanup.

These are strong defaults, not a substitute for the developer's explicit direction. If a rule conflicts with the task, explain the conflict before departing from it.

## Glossary

- **user**: the person reading and managing mail in Kisa.
- **account**: one connected mail account, identified internally by its email.
- **thread**: a conversation containing one or more messages: Gmail's own thread, or one built from `References` for other providers.
- **mailbox**: the visible, account-filtered thread collection in the renderer.
- **cache**: the local SQLite representation used for fast mailbox reads.
- **index**: the resumable background work (the skeleton walk, then bodies) that caches and indexes the whole mailbox for local search.
- **bridge**: the typed `window.desktopBridge` capability API exposed by preload.
- **app password**: the provider-issued password an account signs in to IMAP and SMTP with, typed once into the Add account window and kept sealed in main.
- **Microsoft sign-in**: how an Outlook.com or Microsoft 365 account connects, since Microsoft's servers take no passwords: OAuth in the system browser, yielding a refresh token kept sealed in main.

## Sharp Edges

1. **Do not damage live mail data.** `bun run --cwd apps/desktop dev` uses Electron's real `app.getPath("userData")`; the database is `<userData>/database/mail.dev.sqlite` (`mail.sqlite` when packaged); the older `app.sqlite` and `app.dev.sqlite` files from before the mail engine are left untouched. Never delete, reset, migrate by hand, or open that database read-write outside Kisa. Tests must use temporary databases. Do not connect or disconnect accounts, send mail, trash mail, or change read state in a real account unless the developer explicitly asks.
2. **Do not expose secrets or message content.** Never print, commit, fixture, screenshot, or paste real app passwords, OAuth codes or tokens, encrypted credential blobs, private email bodies, or the contents of local app data. Redact boundary errors and logs.
3. **Do not kill by pattern.** Never use `pkill -f` or a name/path match that can select unrelated Electron, Vite, Codex, or worker processes. Stop only a PID captured from a process you started, or a verified listener owning the exact port you started.
4. **Do not mutate external infrastructure casually.** `deploy`, the release helper, tags, pushes, GitHub releases, and changes to a real mail account require an explicit request.

## Check Every Applicable Path

The common Kisa defect is a change that works in one view or account but leaves another path stale. Before calling a feature complete, decide which of these apply:

- **Interaction paths.** Mouse controls, keyboard commands, focus behavior, accessible labels, tooltips, and settings must describe and invoke the same behavior. Central hotkey definitions live in `renderer/src/hotkeys`; do not add ad-hoc global key listeners for product commands.
- **Account views.** Check one selected account, All Accounts, account switching, disconnected accounts, and two accounts with colliding message or thread ids. Persisted and in-memory keys must include account identity where needed.
- **Mail state.** Consider the local cache, FTS search, the foreground IMAP result, incremental sync, the background skeleton and body work, unread badge, renderer subscriptions, and optimistic UI. A mutation is incomplete if another mounted view stays stale.
- **Runtime boundaries.** Renderer, preload, main, and the database utility process have different APIs and security properties. A cross-boundary change needs matching contracts, codecs, implementations, and tests.
- **Lifecycle states.** Startup, no accounts, loading, empty, partial index, offline/error, retry, cancellation, disconnect, quit, restart, and packaged paths should remain coherent.
- **Reverse states.** If a behavior can be entered, define how it is exited and observed. Mark read needs mark unread; trust sender needs account cleanup; optimistic state needs rollback or authoritative refresh.
- **Privacy surfaces.** Treat sender-controlled headers, HTML, URLs, filenames, MIME structure, and image sources as untrusted at every boundary.
- **Documentation.** User-visible behavior, architecture decisions, schema invariants, hotkeys, indexing, and release changes belong in the relevant `README.md` or `docs/` document.

## Repository Shape

Kisa is a Bun/Turborepo workspace:

- `apps/desktop` - Electron main, preload, database utility process, and React renderer.
- `packages/database` - Drizzle/SQLite schemas, clients, runtime, and migrations.
- `packages/mail` - the mail engine: provider dialects, sync, thread changes, labels, MIME planning, typed failures, and the IMAP, SMTP and store ports.
- `docs/architecture` - current architectural contracts and feature designs.
- `docs/research` - dated research and rationale, not necessarily current product behavior.
- `repos` - vendored read-only reference repositories.

Workspace packages are only `apps/*` and `packages/*`. Dependency versions live in the catalog of the root `package.json`; use `bun.lock` as the sole application dependency lockfile.

## Vendored Repositories

- Treat everything under `~/.local/share/effect-solutions/effect/` as read-only reference material. Do not edit it or import application code from it unless explicitly asked.
- Prefer the vendored version's APIs and patterns over memory or generic web examples.
- Before writing Effect code, read `~/.local/share/effect-solutions/effect/LLMS.md` completely and inspect nearby Effect v4 source and tests for the relevant API.

## Commands

Bun is the package manager and script runner; the tools it starts (Electron, electron-vite, Vitest, `tsc`) still run on Node.js. Always write `bun run <script>`: bare `bun test`, `bun build`, and `bun check` are Bun's own test runner, bundler, and typechecker, not Kisa's scripts.

- Install: `bun install`; CI uses `bun install --frozen-lockfile`.
- Develop all persistent tasks: `bun run dev`.
- Develop only Electron: `bun run --cwd apps/desktop dev`.
- Develop with sample mail and no account: `bun run --cwd apps/desktop dev:demo`. Demo mode uses a temporary profile and in-memory mail servers, so it never opens the live database; see `docs/architecture/demo-mode.md`.
- Typecheck: `bun run typecheck`; a narrower example is `bun run --cwd apps/desktop typecheck`.
- Focused desktop test: `bun run --cwd apps/desktop vitest run tests/<name>.test.ts`.
- Focused mail package test: `bun run --cwd packages/mail vitest run tests/<name>.test.ts`.
- Full verification: `bun run check`, `bun run typecheck`, `bun run test`, and `bun run build`.
- Apply Ultracite fixes: `bun run fix`.
- Generate a database migration after schema changes: `bun run --cwd packages/database generate`.
- Package: `bun run build:mac`, `bun run build:win`, `bun run build:linux`, or `bun run build:unpack`.

Start with the smallest proof that exercises the changed behavior, then widen verification in proportion to risk. Do not use a real mail account, browser automation, or the running desktop app as a test fixture without explicit permission. Pre-commit runs the repository tests and Ultracite, and may restage formatted staged files.

## How the Desktop App Works

```text
React feature or hook
  -> renderer platform/desktop.ts
  -> window.desktopBridge
  -> preload capability
  -> ipcRenderer.invoke
  -> main/ipc/desktop-ipc.ts (decode request, run method, encode reply)
  -> main service
     -> mail servers over IMAP and SMTP, or
     -> database RPC -> Electron utility process -> SQLite
```

Main-to-renderer events travel back through encoded renderer events and decoded preload subscriptions. Every subscription must return an exact unsubscribe function.

The main process owns privileged capabilities, including account sign-in and sealed credentials. The renderer is sandboxed with context isolation and no Node integration; treat it as an untrusted web page. The database utility process owns synchronous `better-sqlite3` work so it cannot block Electron's main thread.

## Desktop Code Rules

- Entrypoints are `apps/desktop/src/main/index.ts`, `src/preload/index.ts`, `src/utility/database-process/entry.ts`, and `src/renderer/src/main.tsx`.
- Main-process ownership is feature-oriented: `app`, `auth`, `database-process`, `demo`, `electron`, `ipc`, `mail`, `settings`, `updates`, and `window`.
- Renderer components use feature hooks or `apps/desktop/src/renderer/src/platform/desktop.ts`. They must not import main or preload internals, call Electron directly, or grow a second transport API.
- Public IPC methods are declared under `main/ipc/methods` and installed only by `desktop-ipc-handlers.ts`. Contracts and Effect Schema codecs live under `src/shared/ipc`; preload exposes the typed bridge.
- Validate unknown renderer inputs in main and encode main results before they cross back. Keep IPC methods narrow; never expose arbitrary filesystem, shell, database, Gmail URL, or Gmail query access.
- Router construction lives in `renderer/src/router.ts`; file routes live in `renderer/src/routes`. Electron uses hash history and the web fallback uses browser history. Route lifecycle code is for navigation gates and startup; live mail data belongs in state modules and feature hooks.
- Aliases `@/*` and `@/renderer/*` point at the renderer source; `@/constants` points at `src/constants.ts`, and `@/shared` points at `src/shared`.
- `renderer/src/routeTree.gen.ts` is generated by the TanStack Router plugin. Do not edit it unless the task specifically requires it.
- Interface behavior comes from ui-sdk (`@ui-sdk/react` and `@ui-sdk/core`). `renderer/src/components/ui` holds Kisa's styled wrappers over ui-sdk components, and `renderer/src/primitives` holds Kisa's own primitives built from ui-sdk behaviors; feature code imports from those, not from `@ui-sdk/react` directly, and never hand-rolls a widget role or its keys. Follow `docs/architecture/ui.md`. Before using ui-sdk, follow the ui-sdk skill if it's installed and read `apps/desktop/node_modules/@ui-sdk/react/docs/llms.txt`; to build a primitive, also search `docs/core.md` there by heading and read `docs/rendering.md`.
- Hotkey commands, scopes, platform display, and collision validation are centralized in `renderer/src/hotkeys`. Follow `docs/architecture/hotkeys.md`.
- Auto-update is best-effort and disabled in development and unpackaged builds. Linux self-update only works for AppImage executions with `APPIMAGE` set.

## Database Rules

- `@repo/database` exports `./client`, `./remote-client`, `./runtime`, and `./schemas`. The desktop database process imports it through the workspace.
- Schema source lives in `packages/database/src/schemas`. Generate migrations after schema changes and commit the schema, SQL migration, and metadata as one coherent change.
- Never edit generated Drizzle `snapshot.json` files by hand. Hand-written SQL is appropriate only for features Drizzle cannot model, such as FTS virtual tables and triggers; protect those with migration tests.
- Drizzle uses SQLite with `snake_case` casing. Preserve composite account keys, foreign-key cleanup, transaction boundaries, FTS synchronization, and keyset ordering invariants.
- Do not move synchronous SQLite access back into Electron main or the renderer. A complete async Drizzle transaction must remain serialized in the utility process so unrelated RPC calls cannot interleave inside it.
- Electron Builder copies migrations to `resources/database/drizzle`; packaged code resolves them through `process.resourcesPath`.

## Mail Engine, Credentials, and Mail Content

- `packages/mail` owns the engine's rules: dialects, sync, changes, labels, MIME planning, ports, and typed failures. Keep Electron, imapflow, nodemailer, SQLite, and renderer concerns out of it. See `docs/architecture/mail-engine.md`.
- `apps/desktop/src/main/mail` owns the IMAP and SMTP adapters, the SQLite store, the engine runtime and its background loop, sending, search, MIME presentation, notifications, and sender trust. Renderer DTOs stay at the shared IPC boundary.
- Keep mail work account-scoped. Foreground operations get their own connection and take priority over background work; progress and data writes that guarantee resume safety belong in the same transaction. Disconnect must cancel account work before deleting all account credentials, cached mail, index rows, progress, settings, and trust.
- An account signs in to IMAP and SMTP with an app password, or through Microsoft sign-in where the provider takes no passwords (Outlook.com and Microsoft 365). Either sign-in stays in main, sealed with Electron `safeStorage`; reject insecure Linux `basic_text` storage. Never put a password, token, or credential blob in a URL, IPC payload, log, renderer state, or test fixture. The one exception is the app password a user types into the dedicated Add account window: it crosses IPC exactly once, from that window's renderer to main, write-only. Main decodes the request with an Effect Schema at the boundary, wraps the password in `Redacted` at once, and keeps it only in the sealed credential blob; it is never returned, echoed in an error, logged, or held in renderer state beyond its input element. No other window or channel may carry a credential.
- Microsoft sign-in never hands a credential to a window at all: the Add account window sends only the address. Main opens Microsoft's page in the system browser, protects the flow with PKCE and a validated `state`, and receives the redirect on a temporary listener bound only to `127.0.0.1` on an operating-system-assigned port, closed when the sign-in ends however it ends. Only the refresh token is stored, sealed; access tokens are renewed from it and held in memory. Ask for the least scopes that IMAP and SMTP need. A sign-in service that is busy or unreachable is a connection failure, never a reason to ask the user to sign in again.
- Email HTML is not trusted application markup. Preserve iframe isolation and CSP, sender-controlled URL checks, remote-image stripping and opt-in flow, external navigation policy, safe filenames, and the on-demand attachment boundary.
- Mail failures such as a refused sign-in, throttling, a lost connection, a rejected or unknown send outcome, malformed MIME, and store failure remain distinct typed domain errors. Do not collapse them into a misleading generic success or retry loop.

## Effect and TypeScript

- Backend and non-renderer boundary code uses Effect v4 for expected failures, resources, concurrency, and lifecycle.
- Prefer named `Effect.fn` functions, `Effect.gen` for sequencing, `Schema.TaggedError` for domain failures, and `Effect.try` or `Effect.tryPromise` only at throwing boundaries.
- Run effects at application, framework, adapter, or test boundaries. Preserve scopes and interruption; do not launch untracked promises or fibers for work that owns resources or mutates account state.
- Prefer inferred types and boundary schemas over duplicate annotations. Avoid `any`, unsafe casts, non-null assertions, and stringly typed cross-process contracts.
- Comments should explain ownership, invariants, or non-obvious tradeoffs, not narrate line-by-line behavior.

## Testing and Verification

- Backend behavior changes require focused tests at the owning layer. Prefer testing a domain service through fake gateway/store ports over mocking Effect internals.
- IPC changes should test request decoding, result/error encoding, handler installation, and subscription cleanup where applicable.
- Database tests use temporary directories and exercise migrations from an older schema when compatibility is involved. Check insert, update, delete, restart, and account isolation for cache/index changes.
- Mail synchronization tests must cover partial pages, duplicate/replayed work, cancellation or disconnect, rate-limit/reauth paths, and renderer events when those behaviors change.
- Tests cover only what can lose, duplicate or mis-send mail, corrupt or mis-migrate the store, cross accounts, or leak credentials and message content: the mail engine, IMAP and SMTP adapters, sending and scheduled sending, the database, sign-in and credentials, every IPC method's channel, decoding and encoding (for any feature), and message privacy. Do not add tests for renderer views, renderer state, or the behavior behind settings, AI, updates or window chrome, and do not add a test that cannot fail. Avoid timers or arbitrary sleeps as a way to make asynchronous tests pass.
- For a user-visible change, manually exercise the real desktop surface only when the developer requests or approves it. Report which account, lifecycle, and interaction paths were not exercised.

## Tooling, Documentation, and Releases

- Ultracite config lives in `oxlint.config.ts` and `oxfmt.config.ts`. `routeTree.gen.ts`, Drizzle snapshots, and `repos` are intentionally excluded.
- Never run `bun update --latest`: it rewrites every catalog entry, including the exact pins for `@effect/tsgo`, TypeScript, Oxlint, `oxlint-tsgolint`, and Astro's TypeScript 6, which must move together as the README describes. Use a plain `bun update` or edit catalog entries.
- Keep architecture docs aligned with implementation. `docs/research` preserves dated investigation; do not silently rewrite historical facts to describe a later design.
- macOS packages are signed and notarized when credentials are present; Windows and Linux artifacts are unsigned. See `docs/releasing/macos-signing.md`.
- Never create a pull request, deploy, tag, publish, or run a release unless the developer explicitly asks.
- `bun run release [major|minor|patch|x.y.z]` requires a clean tree, updates only `apps/desktop/package.json` and the version `bun.lock` records for it, runs `bun run check` unless `--skip-check`, commits `Release vX.Y.Z`, tags it, and pushes unless `--no-push` is supplied.
- Keep commits focused and written in plain language. UI changes should include before/after evidence when a pull request is requested; animation or timing changes are better demonstrated with a short recording.
