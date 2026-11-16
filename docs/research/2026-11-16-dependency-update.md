# Dependency update — 16 November 2026

Updated every direct catalog package except the protected compiler/lint cohort, moved Effect to 4.1, and moved pnpm to 12.21.0. Two upgrades changed runtime behavior that the existing tests did not catch, so this update includes code changes for TanStack Hotkeys and OpenCode.

## Direct version changes

| Package                            | Previous    | Updated    |
| ---------------------------------- | ----------- | ---------- |
| `pnpm` (`packageManager`)          | `12.4.2`    | `12.21.0`  |
| `@anthropic-ai/claude-agent-sdk`   | `^0.3.310`  | `^0.3.325` |
| `@astrojs/react`                   | `^7.1.1`    | `^7.1.9`   |
| `@astrojs/sitemap`                 | `^3.7.4`    | `^3.7.5`   |
| `@dnd-kit/dom`, `@dnd-kit/react`   | `^0.5.1`    | `^0.5.3`   |
| `@effect/vitest`                   | `4.0.6`     | `4.1.4`    |
| `@googleapis/gmail`                | `^22.0.2`   | `^22.1.0`  |
| `@opencode/client`                 | `^2.1.4`    | `^2.3.0`   |
| `@oxlint/plugins`                  | `^1.89.0`   | `^1.93.0`  |
| `@rolldown/plugin-babel`           | `^0.2.4`    | `^0.3.1`   |
| `@tailwindcss/vite`, `tailwindcss` | `^4.3.3`    | `^4.3.5`   |
| `@tanstack/react-hotkeys`          | `^0.17.0`   | `^0.27.0`  |
| `@tanstack/react-virtual`          | `^3.14.23`  | `^3.14.26` |
| `@tanstack/router-plugin`          | `^1.168.48` | `^1.169.0` |
| `@tiptap/*`                        | `^3.32.0`   | `^3.34.0`  |
| `@types/node`                      | `^26.6.5`   | `^26.6.6`  |
| `@vitejs/plugin-react`             | `^6.1.2`    | `^6.3.0`   |
| `astro`                            | `7.4.2`     | `7.4.12`   |
| `better-sqlite3-multiple-ciphers`  | `13.0.3`    | `13.1.1`   |
| `effect`                           | `4.0.6`     | `4.1.4`    |
| `electron`                         | `^45.0.0`   | `^45.3.2`  |
| `lucide-react`                     | `^1.61.0`   | `^1.73.0`  |
| `motion`                           | `^14.6.0`   | `^14.14.0` |
| `oxfmt`                            | `^0.74.0`   | `^0.78.0`  |
| `pdfjs-dist`                       | `^6.4.299`  | `^6.5.438` |
| `react-resizable-panels`           | `^4.15.0`   | `^4.23.0`  |
| `shadcn`                           | `^4.22.1`   | `^4.23.0`  |
| `tldts`                            | `7.4.19`    | `7.5.4`    |
| `turbo`                            | `^2.11.10`  | `^2.11.11` |
| `vite`                             | `^8.3.5`    | `^8.3.8`   |
| `vitest`                           | `^5.0.5`    | `^5.1.0`   |
| `wrangler`                         | `^4.153.0`  | `^4.162.0` |
| `zustand`                          | `^5.0.16`   | `^5.1.0`   |

The transitive `@astrojs/astro2tsx` moved from 0.1.3 to 0.1.4.

## Compatibility holds

`@effect/tsgo` 0.36.5, TypeScript 7.0.2, Oxlint 1.78.0, `oxlint-tsgolint` 7.0.2001, and Ultracite 7.10.5 stay on the verified toolchain listed in the README and protected by `update.ignoreDeps`.

## Migrations

**pnpm 12.21.0.** `better-sqlite3-multiple-ciphers` 13.1.1 failed to install under pnpm 12.4.2 with `node-gyp: command not found`. The package ships N-API prebuilds and sets `gypfile: false`. pnpm 12.4.2 still synthesized a `node-gyp rebuild` install script for it, and its standalone executable could not find the bundled `node-gyp`. pnpm 12.7.0 and 12.8.0 fixed both problems. 13.0.3 had installed only because the store held a build produced by pnpm 11.

**SQLite3 Multiple Ciphers 2.7.0.** `better-sqlite3-multiple-ciphers` 13.1.1 bundles SQLite 3.54.1 and SQLite3 Multiple Ciphers 2.7.0, whose release notes include compatibility changes. None of the listed changes apply to Kisa's configuration: WAL legacy mode, `aes256cbc` `kdf_iter`, VLE, and UTF-16 passphrases. Kisa uses `chacha20` with `legacy = 0`. Rekey handling was reworked upstream, so a one-off check used the packaged 13.0.3 and 13.1.1 libraries with Kisa's exact pragmas:

- 13.1.1 opened an encrypted WAL database that 13.0.3 had written, including uncheckpointed WAL frames left by a process that exited without closing.
- Row counts, FTS5 matches, and `integrity_check` were intact before and after a new write.
- A wrong key failed with `SQLITE_NOTADB`.
- The plaintext-to-encrypted `rekey` migration still worked.

**TanStack Hotkeys 0.27 (core 0.32).** Since core 0.26, an option object that contains a `target` key registers nothing while that target is unset. Only an omitted key listens on the document. Since 0.32, a `null` target registers nothing at the manager level as well. `useAppCommand` always passed `target: options.target`, so every command without an element target would have stopped firing. The registration is now built by `getAppCommandHotkeys`, which omits the key unless a ref is supplied, and a regression test covers both cases. The repository's `anti-slop/no-conditional-empty-object-spread` autofix rewrites a conditional `...(target ? { target } : {})` back into `target,`, which reintroduces the defect, so the options are built in separate statements.

Other Hotkeys behavior changes since 0.17 were reviewed:

- **Escape (0.31).** Page-level Escape hotkeys now skip while focus is inside `role="dialog"`, `role="alertdialog"`, `role="menu"`, or an expanded popup button. The only Kisa Escape command that closes a dialog-like surface is `threadComposer.close` for the reply popover, and that popover's open state is wired to Base UI's `onOpenChange`, so Base UI's own Escape handling still closes it.
- **Element targets (0.24).** Element-target hotkeys now run after framework key handlers.
- **Keyup chords.** These now fire only for a matching press.
- **Recorder, keyboard layout, and SSR.** These APIs are unused.

The React adapter's `formatForDisplay` re-export is now marked deprecated in favor of `useFormatForDisplay()` inside components. Its documentation says to keep calling it outside components and pass `platform`, which `getHotkeyDisplay` does, so the `typescript/no-deprecated` report on it is intentional.

**OpenCode 2.3.0.** The client's deprecated `client.generate.text` now calls `/api/experimental/generate/text`, a route that first shipped in OpenCode 2.2.0. The legacy `/api/experimental/generate` route remains as a deprecated server alias. Kisa now calls `client.experimental.generate.text` and requires an OpenCode 2.2 or later service within 2.x for discovery, the CLI check before `opencode service start`, and provider status. Older 2.x installations get the update message instead of a failed generation. Request and response schemas are unchanged, as are the location, event, model, provider, and debug paths Kisa uses. The scoped overrides were re-keyed to 2.3.0. That package declares an exact `effect` 4.1.0 peer, and the overrides keep it on the workspace Effect 4.1.4.

**Astro check.** Vite 8.3.8 brings `@rolldown/binding-wasm32-wasi`, which depends on `@emnapi/*` 2.0.0-beta.2. pnpm resolved `@astrojs/astro2tsx` 0.1.3's `@emnapi/runtime` peer to that beta while the package pinned `@emnapi/core` 1.11.3, and `astro check` crashed with `this.bridge.setLastError is not a function`. `@astrojs/astro2tsx` 0.1.4 declares `@emnapi/runtime` 1.11.3 directly.

**Formatting.** oxfmt 0.78 reflowed one arrow function in `mail-search.ts`.

## Validation

- Ordinary and frozen-lockfile installation passed with the normal release-age policy.
- `pnpm peers check`: no peer dependency issues.
- `pnpm typecheck`: all four workspace packages passed.
- Test suites: 981 tests passed across 156 files (953 desktop, 28 Gmail).
- `pnpm check`: formatting and lint passed.
- `pnpm build`: desktop production build and preload-bundle validation passed.
- `pnpm build:marketing`: marketing production build passed.
- `git diff --check`: passed.

The installer still reports the same six deprecated transitive dependencies. The desktop app was not launched; no live Gmail actions, real sign-ins, AI generations, packaging, signing, or release were performed. Keyboard behavior was verified through the registry and registration tests, not by pressing keys in the running app.
