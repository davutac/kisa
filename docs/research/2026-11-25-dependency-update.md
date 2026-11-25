# Dependency update — 25 November 2026

The first update since the move from pnpm to Bun. Direct catalog packages moved to the newest release the release-age gate allows. Drizzle moved from release candidate 4 to 6, which needed the remote database client rewritten; nothing else needed a code change. Oxlint is held at 1.94.0 because `effect-tsgo patch` rejects 1.95.0. Bun 1.4.5, TypeScript 7.0.2, Ultracite 8.3.1, and the Astro checker's TypeScript 6.0.3 were already the latest releases.

## Direct version changes

| Package                          | Previous        | Updated         |
| -------------------------------- | --------------- | --------------- |
| `@anthropic-ai/claude-agent-sdk` | `^0.3.330`      | `^0.3.331`      |
| `@effect/tsgo`                   | `0.73.2`        | `0.73.4`        |
| `@opencode/client`               | `^2.3.2`        | `^2.4.1`        |
| `@types/node`                    | `^26.6.6`       | `^26.6.7`       |
| `@types/react`                   | `^19.3.0`       | `^19.3.1`       |
| `@ui-sdk/core`, `@ui-sdk/react`  | `0.1.0-beta.16` | `0.1.0-beta.17` |
| `drizzle-orm`, `drizzle-kit`     | `1.0.0-rc.4`    | `1.0.0-rc.6`    |
| `electron`                       | `^45.4.1`       | `^45.5.0`       |
| `lucide-react`                   | `^1.77.0`       | `^1.79.0`       |
| `nodemailer`                     | `10.6.0`        | `10.6.1`        |
| `oxfmt`                          | `^0.79.0`       | `^0.80.0`       |
| `oxlint-tsgolint`                | `7.0.2007`      | `7.0.2008`      |

Transitive changes: `@opencode/protocol` and `@opencode/schema` moved to 2.4.1, `@anthropic-ai/sdk` moved from 1.12.0 to 1.14.0, and the platform binary packages moved with their parents. `drizzle-kit` rc.6 no longer depends on `esbuild` 0.25, `@drizzle-team/brocli`, `@js-temporal/polyfill`, `get-tsconfig`, or `jsbi`, so those left the lockfile. Nothing else in the lockfile moved, for the reason below.

## How the update ran under Bun

The exact pins and the override keys were edited by hand in the root `package.json` catalog, followed by one plain `bun update`. `bun update --latest` was not used: it rewrites every catalog entry, including the compiler and lint pins and the Astro checker's TypeScript 6.

`bun.lock` was migrated from `pnpm-lock.yaml`, and the migration recorded each transitive dependency as the exact version pnpm had resolved rather than the range its manifest declares: 1,827 exact specifiers and no ranges before this update. `bun update` therefore moves a transitive package only when its parent moves. One visible effect is that `@types/node` 26.6.6 stays installed for the `@types/*` packages that had resolved it, beside the workspace's 26.6.7.

Resolving the lockfile from scratch restores the declared ranges. Measured on a scratch copy of the manifests, and not applied in this update, it would:

- change the resolved versions of 34 packages, a few of them to older versions, such as `@babel/runtime` 8.1.3 to 7.29.15 for Base UI;
- remove 22 packages: `jsdom`, `immer`, and `@date-fns/tz`, which pnpm had installed as optional peers of Vitest, Zustand, and Base UI, and their dependencies. No source file imports them and none is in the packaged app;
- touch three packages that ship in the app: `fs-extra` (one fewer copy), `isbot` 5.2.3 to 5.2.4, and `prosemirror-view` 1.43.0 to 1.44.0.

## Compatibility holds

`effect-tsgo patch` in `@effect/tsgo` 0.73.4 rejects Oxlint 1.95.0 and lists 1.91.0 through 1.94.0 as its supported versions, so Oxlint stays at 1.94.0. The same release now accepts `oxlint-tsgolint` 7.0.2008, the version 0.73.2 refused. The `prepare` script passes `--skip-missing`, which logs an unsupported version and carries on with an unpatched binary, so the check that matters is the patch run without that flag.

The release-age gate filters out versions published less than a day ago. When it blocks a version, Bun also skips releases that were published close together just outside the gate and picks an older one, unless the version is requested exactly. That is why `bun outdated` reports `cf` 1.0.0-rc.4 as the newest eligible release although rc.5, the exact pin, was 29 hours old. When the update ran, the gate held `@anthropic-ai/claude-agent-sdk` 0.3.332, `lucide-react` 1.80.0, `tldts` 7.6.0, `vitest` 5.1.2, `cf` 1.0.0-rc.6, and newer `@types/node` and `@types/react` releases. No exclusion was added to pull them in.

## Migrations

**Drizzle 1.0.0-rc.6.** `drizzle-orm` and `drizzle-kit` moved from rc.4 past rc.5 (21 October) to rc.6 (20 November). Both are published under the `rc` dist-tag while `latest` is 0.45.4, and `bun outdated` compares against `latest`, which is why neither it nor the earlier updates listed them.

- **Proxy transport.** Release candidate 5 replaced the `sqlite-proxy` callback with three executors, `run`, `all`, and `get`, and a row mode. `packages/database/src/remote-client.ts` now takes one Kisa-owned function, `RemoteDatabaseExecute`, which sends a statement as `run` or `all` and gets rows back as arrays, and maps the executors onto it. It refuses `get` and object row mode there. Before, the refusal of `get` lived in the desktop's process client, and five of the six test doubles answered `get` in their own ways. The database RPC's `method` lost `"values"`, which nothing can send now that `values()` goes through `all`.
- **Decoding.** The rc.6 proxy driver decodes nothing by itself: with the transport alone, a plain select returned JSON columns as text and booleans as 0 and 1, which failed 174 tests. The remote client passes Drizzle's `better-sqlite3` codecs, because its rows are what that driver returned in the database process. They come from `drizzle-orm/better-sqlite3/codecs`, which does not load the native module.
- **Existing databases.** A one-off check used scratch databases and the repository's migrations folder. A database the rc.4 migrator had fully migrated opened under rc.6 with nothing applied again: the same nine bookkeeping rows, the same `__drizzle_migrations` table, and the same schema. A database rc.4 had left at the baseline was brought through the other eight migrations by rc.6 to the identical schema, with its data intact. A fresh rc.6 database has that schema too. In the other direction, rc.4 opened both a database rc.6 had created and the one rc.6 had brought forward, applying nothing, so a development database survives a switch back to a branch on rc.4. The bookkeeping format did not change, so no permanent test was added.
- **Kit.** `drizzle-kit check` passes on the existing folder, `generate` against a scratch copy reports no changes, and `drizzle-kit up` reports nothing to upgrade. The incremental snapshots announced with rc.5 are PostgreSQL's. For SQLite, rc.6 still writes the full schema into every snapshot, in the same format 7 the folder already has; two migrations generated from a scratch schema confirmed it.
- **Changes the types do not show.** A relational filter whose value is `undefined` now throws where it used to be skipped, and the types still accept one. A compiler-API pass over the main-process sources found 32 filters with 43 values, none of which can be `undefined`; it flagged a planted `string | undefined` filter. Non-positive `limit` values are no longer dropped; every computed limit in the mail engine and scheduled mail is a positive constant. The direct `better-sqlite3` driver now reads integers as `bigint` for mapped queries, so an unmapped integer `sql` field is a `bigint` there; production uses that driver only to run migrations, and the database process still reads rows for the proxy without safe integers. Query errors no longer carry parameters unless `paramsInErrors` is set, which Kisa leaves off.

Two tests were added to `database-process-client.test.ts`: that each column kind the schema uses is decoded through the process client, and that a raw query asking for rows as objects is refused. Each fails when the codecs or the guard are removed.

**OpenCode overrides.** The three scoped overrides that keep OpenCode on the workspace Effect were re-keyed from `@opencode/*@2.3.2` to `@2.4.1`. The catalog range `^2.3.2` already admitted 2.4.1, and with the old keys a fresh resolve installed a second `effect` 4.1.0 under the protocol and schema packages, which still depend on exactly 4.1.0. After the re-key the lockfile holds one `effect`, 4.1.5, and the installed protocol and schema packages resolve it.

**OpenCode 2.4.1.** The client's generated endpoint definitions for the six calls Kisa makes are identical in 2.3.2 and 2.4.1: event subscription, location lookup and eviction, model and provider lists, and `experimental.generate.text`. The release adds a `video` kind to several schemas and removes `ForbiddenError` from the video and blob routes' errors, neither of which Kisa uses. Kisa's requirement of an OpenCode 2.2 or later service is unchanged.

**nodemailer 10.6.1.** The release changes DKIM signing, which now signs `List-Unsubscribe-Post` by default, the cookie jar of nodemailer's own fetch client, and the well-known services list. Kisa imports only `nodemailer/lib/smtp-connection` and `nodemailer/lib/xoauth2`, and neither file changed.

**ui-sdk 0.1.0-beta.17.** The documented component changes are that a drawer closes once a swipe down takes it off screen, a popover with no trigger returns focus on Shift+Tab to where it opened from, and a toast stays above a dialog opened after it. Most of the release reworks the agent-facing layer, which Kisa does not use. The renderer has no tests, and these were not exercised in the running app.

**Electron 45.5.0.** Chromium moves to 156.0.8078.109. The release fixes two renderer crashes, `dialog.showMessageBox()` omitting `response` after an aborted signal, and the `prefers-contrast` media query ignoring the system setting. The downloaded binary reports 45.5.0.

**`@effect/tsgo` 0.73.4 and oxfmt 0.80.** Typecheck reported no new diagnostics, and oxfmt did not reformat any existing file.

## Validation

- `bun install` and `bun install --lockfile-only` left `bun.lock` unchanged after the update, and a clean `bun install --frozen-lockfile` passed with the normal release-age policy.
- `effect-tsgo patch --typescript --oxlint`, run without `--skip-missing`, exited 0, and the clean install patched TypeScript, Oxlint, its type declarations, and `oxlint-tsgolint`.
- Bun has no equivalent of `pnpm peers check`. The installs printed no peer or deprecation warnings, and the lockfile holds a single `effect`.
- `bun outdated -r`, when the update ran: only the held packages above and the Astro checker's TypeScript 6. `@anthropic-ai/claude-agent-sdk` 0.3.332 passed the gate a few hours later and was left for the next update.
- `bun run typecheck`: all four workspace packages passed.
- Test suites: 999 tests passed across 97 files (944 desktop, 55 mail), with one expected failure and one skipped test. The two new tests are the only change in the counts.
- `bun run check`: formatting and lint passed.
- `bun run build`: desktop production build and preload-bundle validation passed.
- `bun run build:marketing`: marketing production build passed.

The desktop app was not launched. No live mail actions, real sign-ins, AI generations, packaging, signing, or release were performed, and nothing ran on Windows or Linux.
