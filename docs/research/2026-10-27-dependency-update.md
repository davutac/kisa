# Dependency update — 27 October 2026

Updated every direct catalog package except the protected compiler/lint cohort, moved Effect from the v4 release candidate to the stable release, and moved to Electron 45. Deprecated APIs reported by the new type definitions were replaced with their current equivalents.

## Direct version changes

| Package                          | Previous       | Updated     |
| -------------------------------- | -------------- | ----------- |
| `@anthropic-ai/claude-agent-sdk` | `^0.3.276`     | `^0.3.310`  |
| `@astrojs/check`                 | `^0.9.10`      | `^0.9.12`   |
| `@astrojs/react`                 | `^6.0.6`       | `^7.1.1`    |
| `@base-ui/react`                 | `^1.8.0`       | `^1.9.0`    |
| `@dnd-kit/dom`                   | `^0.5.0`       | `^0.5.1`    |
| `@dnd-kit/react`                 | `^0.5.0`       | `^0.5.1`    |
| `@effect/vitest`                 | `4.0.0-rc.115` | `4.0.6`     |
| `@googleapis/gmail`              | `^22.0.0`      | `^22.0.2`   |
| `@opencode/client`               | `^2.0.8`       | `^2.1.4`    |
| `@oxlint/plugins`                | `^1.83.0`      | `^1.89.0`   |
| `@tanstack/react-hotkeys`        | `^0.10.0`      | `^0.17.0`   |
| `@tanstack/react-router`         | `^1.170.38`    | `^1.170.46` |
| `@tanstack/react-virtual`        | `^3.14.13`     | `^3.14.23`  |
| `@tanstack/router-plugin`        | `^1.168.40`    | `^1.168.48` |
| `@tiptap/*`                      | `^3.31.3`      | `^3.32.0`   |
| `@types/node`                    | `^26.6.1`      | `^26.6.5`   |
| `@vitejs/plugin-react`           | `^6.1.1`       | `^6.1.2`    |
| `astro`                          | `7.3.3`        | `7.4.2`     |
| `effect`                         | `4.0.0-rc.115` | `4.0.6`     |
| `electron`                       | `^44.4.2`      | `^45.0.0`   |
| `electron-builder`               | `26.15.3`      | `26.18.0`   |
| `electron-updater`               | `^6.8.9`       | `^6.8.11`   |
| `electron-vite`                  | `6.0.0-beta.1` | `6.0.0`     |
| `lucide-react`                   | `^1.47.0`      | `^1.61.0`   |
| `motion`                         | `^13.4.0`      | `^14.6.0`   |
| `oxfmt`                          | `^0.68.0`      | `^0.74.0`   |
| `pdfjs-dist`                     | `^6.3.289`     | `^6.4.299`  |
| `react`, `react-dom`             | `^19.3.0`      | `^19.3.1`   |
| `react-day-picker`               | `^10.0.1`      | `^10.0.2`   |
| `react-resizable-panels`         | `^4.12.4`      | `^4.15.0`   |
| `shadcn`                         | `^4.21.0`      | `^4.22.1`   |
| `sharp`                          | `^0.35.4`      | `^0.35.5`   |
| `tldts`                          | `7.4.13`       | `7.4.19`    |
| `turbo`                          | `^2.10.13`     | `^2.11.10`  |
| `vite`                           | `^8.3.0`       | `^8.3.5`    |
| `vitest`                         | `^5.0.1`       | `^5.0.5`    |
| `wrangler`                       | `^4.135.0`     | `^4.153.0`  |
| `zod`                            | `^4.6.5`       | `^4.6.7`    |
| `zustand`                        | `^5.0.15`      | `^5.0.16`   |

## Compatibility holds

`@effect/tsgo` 0.36.5, TypeScript 7.0.2, Oxlint 1.78.0, `oxlint-tsgolint` 7.0.2001, and Ultracite 7.10.5 stay on the verified toolchain listed in the README and protected by `update.ignoreDeps`.

## Migrations

**Effect 4.0.** The RPC and worker modules left `effect/unstable/`; imports now use `effect/rpc/*` and `effect/workers/*`. No other source changes were required.

**OpenCode 2.1.4.** The client now peers on stable Effect 4.0.1. The scoped overrides were re-keyed to 2.1.4 so the client, protocol, and schema packages share the workspace Effect runtime.

**TanStack Hotkeys 0.17 (core 0.18).** `normalizeRegisterableHotkey` was removed; `normalizeHotkey` now accepts the same chord strings and still emits `Mod`, which the ARIA label path resolves per platform. macOS display now follows Apple's modifier order, so `Mod+Shift+U` renders as `⇧ ⌘ U`. `ignoreInputs: true` is broader than before: besides text fields and contenteditable, it skips keys a focused control owns by WAI-ARIA convention, such as Enter and Space on buttons and arrow keys inside `role="toolbar"`, `listbox`, `menu`, or `grid`. Mailbox thread rows and label toggles are plain buttons that own no navigation keys, so list and label navigation are unchanged. Enter on a focused button now activates that button instead of `mailbox.openThread`, and left/right arrows inside the selection toolbar no longer move between labels.

**Motion 14.** The major release only removes internal APIs kept for `framer-motion` 13.0–13.4 compatibility.

**Electron 45.** Sandboxed preloads no longer receive `Buffer`, `setImmediate`, `clearImmediate`, or the `events`, `timers`, and `url` shims. Neither preload bundle references them; Effect's scheduler detects `setImmediate` and falls back to `setTimeout`. `better-sqlite3-multiple-ciphers` rebuilds against the Electron 45 ABI. The synchronous `safeStorage` methods are deprecated and will be removed in Electron 46, so account and OAuth client credentials now use `isAsyncEncryptionAvailable`, `encryptStringAsync`, and `decryptStringAsync`, matching the database key protector. Existing blobs decrypt unchanged. Encryption failures during sign-in or token refresh surface as `GoogleAuthError` instead of a defect.

**Other deprecations.** A type-aware `typescript/no-deprecated` pass now reports nothing. React form handlers use `SubmitEvent` instead of `FormEvent`, the BIMI DNS lookup uses `order: "verbatim"` instead of `verbatim: true`, and the email iframe drops the obsolete `scrolling` attribute because its document stylesheet already sets `overflow: hidden !important` on `html` and `body`.

## Validation

- Ordinary and frozen-lockfile installation passed with the normal release-age policy.
- `pnpm peers check`: no peer dependency issues.
- `pnpm typecheck`: all four workspace packages passed.
- Test suites: 971 tests passed across 155 files (943 desktop, 28 Gmail).
- `pnpm check`: formatting and lint passed.
- `pnpm build`: desktop production build and preload-bundle validation passed.
- `pnpm build:marketing`: marketing production build passed.
- `git diff --check`: passed.

The installer still reports six deprecated transitive dependencies: `boolean@3.2.0`, `glob@7.2.3`, `inflight@1.0.6`, `lodash.isequal@4.5.0`, `node-domexception@1.0.0`, and `rimraf@2.6.3`. The desktop app was not launched; no live Gmail actions, real sign-ins, AI generations, packaging, signing, or release were performed.
