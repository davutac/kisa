# Kisa

**A fast, local-first mail client for Gmail, iCloud, and other IMAP accounts, built for the desktop.**

Kisa caches and indexes mail locally for fast search, handles multiple accounts, each connected over IMAP and SMTP with an app password, and isolates untrusted content behind a narrow Electron security boundary.

> Kisa is under active development.

## Download

Download the latest release:

| Platform | Download |
| --- | --- |
| macOS (Apple silicon) | [DMG](https://github.com/davutac/kisa/releases/latest/download/Kisa-mac-arm64.dmg) |
| Windows | [Installer](https://github.com/davutac/kisa/releases/latest/download/Kisa-windows-setup.exe) |
| Linux | [AppImage](https://github.com/davutac/kisa/releases/latest/download/Kisa-linux-x86_64.AppImage) |

See the [latest release](https://github.com/davutac/kisa/releases/latest) for release notes and checksums.

## Add an account

Every account connects in Kisa's **Add account** window. Most sign in with an app password: a separate password your provider issues for one app, not the password you sign in to its website with. Outlook signs in with Microsoft in your browser instead. Kisa checks the sign-in against the mail servers before saving it, encrypted, on your device. Kisa runs no server of its own.

- **Gmail** (`gmail.com`, `googlemail.com`): turn on 2-Step Verification for your Google Account, then create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Google shows it in groups of four; paste it with or without the spaces. Google doesn't offer app passwords to accounts that use only security keys for 2-Step Verification, to work, school or other organization accounts, or to accounts with Advanced Protection ([Google's help](https://support.google.com/accounts/answer/185833)), so those accounts can't connect to Kisa for now.
- **iCloud** (`icloud.com`, `me.com`, `mac.com`): create an app-specific password as [Apple describes](https://support.apple.com/en-us/102654).
- **Outlook** (`outlook.com`, `hotmail.com`, `live.com`, `msn.com` and their country domains): choose **Sign in with Microsoft** and finish in your browser. Outlook.com has IMAP off by default: turn it on under **Settings › Mail › Forwarding and IMAP** first. A Microsoft 365 work or school address on its own domain uses **Sign in with Microsoft instead**; your organization may need to allow Kisa, or have sending from mail apps turned off.
- **Any other address**: create an app password with your provider, then enter its IMAP and SMTP servers. Kisa offers TLS and STARTTLS only.

The optional Name is the sender name your outgoing mail carries; change it any time under **Settings**, on the account's page. Disconnecting an account deletes its sign-in and everything Kisa cached for it on this device; revoke the app password, or Kisa's access to your Microsoft account, in your provider's settings if you no longer want it to work.

## Why Kisa

I started Kisa when Notion announced that [Notion Mail will shut down on September 22, 2026](https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next). Rather than return to Gmail in a browser, I began building the fast, keyboard-first client I wanted.

- **Mailbox-scale performance.** Local caching, full-text search, virtualized lists, and resumable indexing keep large mailboxes responsive.
- **Recoverable spam.** A dedicated Spam mailbox surfaces newly classified mail without adding notifications or Inbox noise. **Report spam** moves a conversation there, with Undo, and leaves your own replies in Sent; **Not spam** returns false positives to Inbox.
- **Keyboard-first workflow.** Switch accounts, search, compose, and navigate without the mouse.
- **Privacy by default.** App passwords and Microsoft sign-ins are sealed in the main process and never reach the mail window, and the local database is encrypted. Message HTML is isolated, and remote images are blocked until allowed.
- **Built for multiple accounts.** Caches, indexes, sync state, and mutations stay account-scoped, with an All Accounts view across them.

## Tech stack

| Area | Technology |
| --- | --- |
| Desktop | [Electron](https://github.com/electron/electron) |
| Interface | [React](https://github.com/react/react), [TypeScript](https://github.com/microsoft/TypeScript), [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss), [ui-sdk](https://ui-sdk.dev) |
| Application runtime | [Effect](https://github.com/Effect-TS/effect) |
| Routing and state | [TanStack Router](https://github.com/TanStack/router), [Zustand](https://github.com/pmndrs/zustand) |
| Local data | [better-sqlite3-multiple-ciphers](https://github.com/m4heshd/better-sqlite3-multiple-ciphers), [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm), FTS5 |
| Mail transport | IMAP with [ImapFlow](https://github.com/postalsys/imapflow), SMTP with [Nodemailer](https://github.com/nodemailer/nodemailer) |
| Tooling | [pnpm](https://github.com/pnpm/pnpm), [Turborepo](https://github.com/vercel/turborepo), [Vite](https://github.com/vitejs/vite), [Vitest](https://github.com/vitest-dev/vitest), [Ultracite](https://github.com/haydenbleasel/ultracite) |

## Architecture

Privileged capabilities stay in Electron's main process. The sandboxed renderer accesses them only through the typed `window.desktopBridge`; Effect Schema validates every IPC request, result, and event.

Synchronous database work runs in a utility process, keeping Electron's main thread unblocked. Mail sync and indexing are bounded, resumable, and yield to foreground actions.

```text
React feature or hook
  -> renderer platform adapter
  -> typed preload bridge
  -> schema-validated Electron IPC
  -> main-process service
     -> mail server over IMAP and SMTP, or
     -> database utility process -> SQLite
```

See the [desktop architecture](docs/architecture/desktop.md) and the [mail engine](docs/architecture/mail-engine.md) for details.

## Repository

- `apps/desktop` — Electron main, preload, database process, and React renderer.
- `packages/database` — database client, runtime, schemas, and migrations.
- `packages/mail` — the mail engine: provider dialects, sync, changes, MIME planning, and the IMAP, SMTP and store ports.
- `docs/architecture` — current architecture and feature contracts.

## Run from source

pnpm 12.21.0 is pinned through `packageManager`.

Dependency versions live in `pnpm-workspace.yaml`. Effect and `@effect/vitest` use the same stable v4 release (currently 4.1.5) with Vitest 5. Astro's checker uses the separate TypeScript 6 catalog because it requires the JavaScript compiler API. Upgrade `@effect/tsgo`, TypeScript, Oxlint, and `oxlint-tsgolint` together after checking the matching patch artifacts.

The verified compiler and lint toolchain is `@effect/tsgo` 0.73.2, TypeScript 7.0.2, Oxlint 1.94.0, `oxlint-tsgolint` 7.0.2007, and Ultracite 8.3.1. `effect-tsgo patch` in that release accepts `oxlint-tsgolint` only up to 7.0.2007, so `update.ignoreDeps` keeps this cohort out of `pnpm update --latest`. Each tsconfig allows only the unstable Effect modules its code uses (`effect/rpc`, `effect/workers`, and `@effect/vitest`), so any other unstable API still fails the typecheck. Ultracite 8 adds React Compiler diagnostics; the [desktop architecture](docs/architecture/desktop.md#renderer-organization-and-routing) describes the renderer patterns they require. The migration added line-level suppressions, each with its reason, for intentional effect triggers, TanStack Virtual, the store-once idiom, and one buffer synchronized from other windows. `no-redeclare` is off because schema values share names with their `typeof X.Type` aliases.

OpenCode uses the 2.3.2 client and requires an OpenCode 2.2 or later service. Scoped overrides keep its Effect peer and schema/protocol dependencies on the workspace Effect catalog. See [AI writing](docs/architecture/ai-writing.md) for provider lifecycle and isolation details.

```bash
pnpm install
pnpm dev
```

To run only the desktop:

```bash
pnpm --dir apps/desktop dev
```

Outlook accounts need Kisa's Microsoft Entra client ID at build time: copy `apps/desktop/.env.example` to `apps/desktop/.env.local` and fill in `MAIN_VITE_MICROSOFT_CLIENT_ID`, or set it in the shell. Without it, everything else works and Microsoft sign-in is not offered. Release builds take it from the `MICROSOFT_CLIENT_ID` secret of the GitHub `Prod` environment.

Development uses `<userData>/database/mail.dev.sqlite` and its own sealed key, separate from the installed app's `mail.sqlite` database and key. Databases from before the mail engine (`app.sqlite`, `app.dev.sqlite`) are left as they are and never opened.

Running from source needs no provider setup: accounts connect with an app password as described in [Add an account](#add-an-account).

Auto-update is off when running from source. To see the sidebar's update button go through its states anyway, start with `KISA_SIMULATE_UPDATE=1 pnpm --dir apps/desktop dev`: a pretend update to 99.0.0 appears a few seconds after launch and can be downloaded and "installed" without contacting the update server or changing the app.

## Verification

Run all checks with:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

## Packaging and releases

Build packages with `pnpm build:mac`, `pnpm build:win`, or `pnpm build:linux`. `pnpm build:unpack` creates an unpacked app.

To build a signed production app and install it in `/Applications` on this Mac, run `scripts/install-mac.sh` (add `--notarize` to require notarization). See [macOS signing](docs/releasing/macos-signing.md#installing-a-signed-build-on-this-mac).

Release by exact version or bump type:

```bash
pnpm release patch
pnpm release 0.1.0
```

The helper requires a clean tree, runs checks, updates `apps/desktop/package.json`, commits, tags, and pushes unless `--no-push` is supplied.

## Inspiration

Kisa borrows [T3 Code's](https://github.com/pingdotgg/t3code) narrow, typed Electron boundaries, adapted to a local-first mail client without its server and RPC layer. See the [detailed comparison](docs/research/t3code-electron-architecture.md).

## License

Kisa is [MIT licensed](LICENSE).
