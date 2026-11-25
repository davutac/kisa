# Dependency update — 21 November 2026

Updated every direct catalog package to its latest release, including the protected compiler/lint cohort that the 16 November update held back. The cohort upgrade required a React Compiler lint migration across the renderer and narrow plugin configuration for Effect's unstable APIs. The runtime upgrades needed no code changes. pnpm 12.21.0, TypeScript 7.0.2, and the Astro checker's TypeScript 6.0.3 were already the latest releases.

## Direct version changes

| Package                           | Previous   | Updated    |
| --------------------------------- | ---------- | ---------- |
| `@anthropic-ai/claude-agent-sdk`  | `^0.3.325` | `^0.3.330` |
| `@astrojs/sitemap`                | `^3.7.5`   | `^3.7.6`   |
| `@effect/tsgo`                    | `0.36.5`   | `0.73.2`   |
| `@effect/vitest`                  | `4.1.4`    | `4.1.5`    |
| `@opencode/client`                | `^2.3.0`   | `^2.3.2`   |
| `@oxlint/plugins`                 | `^1.93.0`  | `^1.94.0`  |
| `@tanstack/react-hotkeys`         | `^0.27.0`  | `^0.27.2`  |
| `@tiptap/*`                       | `^3.34.0`  | `^3.35.0`  |
| `astro`                           | `7.4.12`   | `7.4.13`   |
| `better-sqlite3-multiple-ciphers` | `13.1.1`   | `13.2.0`   |
| `effect`                          | `4.1.4`    | `4.1.5`    |
| `electron`                        | `^45.3.2`  | `^45.4.1`  |
| `lucide-react`                    | `^1.73.0`  | `^1.77.0`  |
| `oxfmt`                           | `^0.78.0`  | `^0.79.0`  |
| `oxlint`                          | `1.78.0`   | `1.94.0`   |
| `oxlint-tsgolint`                 | `7.0.2001` | `7.0.2007` |
| `react-resizable-panels`          | `^4.23.0`  | `^4.24.1`  |
| `recharts`                        | `^3.10.1`  | `^3.11.0`  |
| `tailwind-merge`                  | `^3.7.0`   | `^3.7.1`   |
| `tldts`                           | `7.5.4`    | `7.5.5`    |
| `turbo`                           | `^2.11.11` | `^2.11.13` |
| `ultracite`                       | `7.10.5`   | `8.3.1`    |
| `vitest`                          | `^5.1.0`   | `^5.1.1`   |
| `wrangler`                        | `^4.162.0` | `^4.166.0` |

Notable transitive changes: `@tanstack/hotkeys` moved from 0.32.0 to 0.33.1, `@opencode/protocol` and `@opencode/schema` moved to 2.3.2, and the driver's bundled SQLite3 Multiple Ciphers moved from 2.7.0 to 2.7.1. SQLite stays at 3.54.1.

## Compatibility holds

`oxlint-tsgolint` 7.0.2008 is published, but `effect-tsgo patch` in `@effect/tsgo` 0.73.2 rejects it and lists 7.0.2005, 7.0.2006, and 7.0.2007 as its supported versions. The cohort therefore uses 7.0.2007. `@effect/tsgo`, TypeScript, Oxlint, `oxlint-tsgolint`, and Ultracite stay in `update.ignoreDeps`, so `pnpm update --latest` leaves them alone and they still move together by hand. The comment above that list now records the 7.0.2007 limit.

## Migrations

**OpenCode overrides.** The three scoped overrides that keep OpenCode on the workspace Effect were re-keyed from `@opencode/*@2.3.0>effect` to `@2.3.2`. The client still declares an exact `effect` 4.1.0 peer. Without the re-key, `pnpm peers check` reported that peer as unmet against Effect 4.1.5.

**`@effect/tsgo` 0.73 unstable API diagnostics.** The new `unstableApiUsage` rule reports every use of an API tagged `@stability unstable` as a warning, and warnings fail `tsc`. The reports covered `@effect/vitest`'s `it` and `beforeEach` in the desktop and Gmail tests, and `effect/rpc` and `effect/workers` in the database utility process, its client, and `shared/database-rpc.ts`. Each tsconfig's plugin entry now sets `allowedUnstableApis` to the modules that project uses:

- `tsconfig.node.json`: `effect/rpc`, `effect/workers`.
- `tsconfig.web.json`: `effect/rpc`.
- `tsconfig.test.json`: `@effect/vitest`, `effect/rpc`, `effect/workers`.
- `packages/gmail/tsconfig.json`: `@effect/vitest`.

The database package needed none. A plugin entry is not merged through `extends`, so each project lists its own modules. Unlike a severity override, this keeps the warning for any other unstable module. The new `schemaClassObjectLiteral` warning found two object literals typed as the `Mailbox` Schema class in `mail-search.test.ts`; they are now `new Mailbox(...)`, matching the other tests. The new suggestion-level diagnostics `schemaClassMissingBrand` and `catchRefailToTapError` do not affect the exit code and were left for a separate change.

**Ultracite 8 and Oxlint 1.94.** Ultracite 8 replaces the single `react/react-compiler` rule with Oxlint's port of React Compiler's validations (`react/todo`, `react/exhaustive-effect-dependencies`, `react/rule-suppression`, `react/incompatible-library`, `react/purity`, `react/refs`, `react/set-state-in-effect`, and others). It also configures `Label` as a label component for `jsx-a11y`. The first check reported 262 errors:

- **`eslint(no-redeclare)` (198).** Oxlint 1.94 now reports each `const X = Schema…` paired with `type X = typeof X.Type`. A script classified every report: each name had exactly one `const` and one `type` declaration in its file, and none was a real duplicate. The rule's `ignoreDeclarationMerge` option does not cover value/type pairs, so `oxlint.config.ts` turns the rule off. TypeScript still rejects genuine redeclarations, and `no-var` covers the `var` case TypeScript allows.
- **`react(todo)` (35).** React Compiler cannot lower `try`/`finally`. Thirty-two handlers and effect loaders in 26 files now pass their cleanup to a module-level `runWithCleanup(task, cleanup)` in `renderer/src/lib/run-with-cleanup.ts` and keep their `try`/`catch` inside the task. Each converted block was the last statement of its function, so early returns inside the task end the handler exactly as before. The three blocks that returned values now `return await` the helper, as `typescript/return-await` requires. Moving `createReply`'s body into a closure lost property narrowing of `aiModel.selection`, so the handler reads it into a local first. `pdf-preview.tsx` loads `pdfjs-dist` through a module-level `loadPdfjs`, because the compiler cannot lower a dynamic `import()`. `MailLabelBadge` computes its remove label in the body instead of a default parameter that read another parameter. The unreachable-code report disappeared with its `finally`. `tests/run-with-cleanup.test.ts` covers value passthrough, cleanup ordering, and rethrow after cleanup.
- **`react(rule-suppression)` (2) and `react(purity)` (1).** The new-message dialog and the thread conversation created keyed stores with `useMemo(..., [])` behind `react-hooks/exhaustive-deps` suppressions. The custom schedule dialog read `new Date()` inside `useMemo(..., [])`. All three now use `useInstanceValue`, a `useState` initializer wrapper in `renderer/src/hooks/use-instance-value.ts`. It keeps the value for the component instance, which `useMemo` does not guarantee. The three obsolete `oxlint-disable react/react-compiler` file headers were removed.
- **`react(exhaustive-effect-dependencies)` (6).** Two were real fixes. The reply autosave effect now saves the `currentDraft` it depends on instead of reading the ref at fire time. The ref is synchronized by an earlier effect on the same change and written nowhere else, and each change clears the pending timer, so the saved value is unchanged. The titlebar search effect called a per-render `focusInput`; the focus logic is now a module-level `focusOnNextFrame(ref)`, which leaves the effect's dependencies, and therefore when it runs, unchanged. The other four are intentional re-run triggers that the body does not read. They keep their dependency arrays and carry line-level suppressions: the new-message draft ID, the search revision, the mailbox search reset key, and the template sidebar's selection and list.
- **`react(incompatible-library)` (2).** Both `useVirtualizer` calls carry suppressions explaining that TanStack Virtual returns a mutable instance and that React Compiler intentionally leaves those two functions uncompiled, which is unchanged behavior.
- **`react(refs)` (1).** `useTemplateWorkspace` wrote `draftRef.current` during render. It now writes the ref in a layout effect, so the comparison `save` makes after its reply arrives sees the committed draft. A passive effect could flush after that continuation and was not used.
- **`react(set-state-in-effect)` (1).** The clean template buffer follows template changes from other windows and account removal. It must remain local state because editing takes it over, so the first `setDraft` carries a line-level suppression in place of the old file-wide disable.
- **`jsx-a11y(label-has-associated-control)` (1).** The label dialog's "Color" caption was a `<label>` with no control. The caption is now a `<span>` that labels a `<fieldset aria-labelledby>` around the color controls, with `min-w-0` so the fieldset shrinks like the `<div>` it replaces.
- **`unicorn(consistent-function-scoping)` (7).** The draft attachment store's three pure path helpers, the titlebar search's `navigateAndBegin`, and the Gmail MIME test's sender-authentication helper moved out to the scope their captures come from. In `mail-backfill.ts`, `cancel` moved one scope up. The renderer-event fakes in `mail-drafts.test.ts` are now inline properties of the `vi.mock` factory result, because hoisted factories cannot reach module-scope functions. The factory's `Partial<typeof import(...)>` return type keeps them typed.
- **`unicorn(prefer-string-replace-all)` (5).** Calls with global regular expressions now use `replaceAll`, which behaves identically and throws only for non-global patterns.
- **`eslint(max-classes-per-file)` (2).** Oxlint now reports this rule at line 1, above the existing file-level suppressions in `ai/errors.ts` and `shared/database-rpc.ts`. Both comments moved to line 1 and now carry their reasons.
- **`promise(always-return)` (1).** The supervisor test's `.then` callback is now an awaited async function with the same ordering.

Suppressions added in this update, each with an inline reason: four `react/exhaustive-effect-dependencies`, two `react/incompatible-library`, one `react/hook-use-state` inside `useInstanceValue`, and one `react/set-state-in-effect`. Two file-level `max-classes-per-file` suppressions moved, and five obsolete suppressions were removed. Probes confirmed that suppressing these rules does not trigger `react/rule-suppression`. The production Babel compiler only skips functions marked with `eslint-disable` comments for `react-hooks/*`, so these comments do not change what it compiles.

Ultracite 8 also changed preset defaults that this update did not override. `sort-keys`, `no-negated-condition`, `unicorn/no-nested-ternary`, and `vitest/prefer-importing-vitest-globals` are off. `promise/prefer-await-to-then` is no longer enabled. `promise/always-return`, `promise/catch-or-return`, `import/no-commonjs`, `jsdoc/no-blank-blocks`, `vitest/consistent-test-it`, and `typescript/no-unsafe-enum-assignment` are on. New code in this update keeps the repository's `async`/`await` style.

Components and hooks that React Compiler previously skipped because of `try`/`finally` or the dynamic import should now be compiled in the production renderer. This follows from the lint port's diagnostics; the compiled bundle was not inspected.

Ultracite 8's upgrade guide also recommends `options: { typeAware: true }` in `oxlint.config.ts` when `oxlint-tsgolint` is installed. Ultracite 7 never turned type-aware linting on, and neither this repository's config, scripts, hooks, nor CI ever enabled it, so `pnpm check` did not run those rules before or after this update. Running `oxlint --type-aware` once reported 1,231 errors across 28 rules, led by `typescript/promise-function-async` (545), `typescript/no-confusing-void-expression` (156), and `typescript/strict-void-return` (85). It stays off pending a separate decision and migration.

**`better-sqlite3-multiple-ciphers` 13.2.0.** The driver merges better-sqlite3 13.2.0, which changes musl detection, prebuilt binary lookup, and `unsafeMode()` on closed databases, and SQLite3 Multiple Ciphers 2.7.1. The cipher release fixes `sqlite3_rekey` ignoring transient cipher parameters when the old and new schemes match. Kisa sets chacha20 `legacy = 0`, `kdf_iter = 64007`, and `plaintext_header_size = 0`, which are the chacha20 defaults, so the fix cannot change what Kisa's plaintext-to-encrypted rekey writes. A one-off check used the packaged 13.1.1 and 13.2.0 binaries with Kisa's exact pragmas on a temporary database:

- 13.2.0 opened an encrypted WAL database that 13.1.1 wrote, including uncheckpointed WAL frames from a process that exited without closing.
- Row counts, FTS5 matches, and `integrity_check` were intact before and after a new write.
- A wrong key failed with `SQLITE_NOTADB`.
- A database rekeyed from plaintext by 13.2.0 opened in 13.1.1, and one rekeyed by 13.1.1 opened in 13.2.0.

**OpenCode 2.3.2.** The client renamed the experimental schedule API to automation and added experimental blob and video-generation routes. The routes and operation types for the six calls Kisa makes are unchanged: event subscription, location lookup and eviction, model and provider lists, and `experimental.generate.text`. The model list's `types` filter now also accepts `"video"`.

**TanStack Hotkeys 0.27.2 (core 0.33.1).** Core 0.33.0 only adds keyboard-layout key types. Core 0.33.1 fixes layout-specific matching: digit-row symbols on AZERTY and Czech layouts, letters outside the Basic Multilingual Plane, pointed Hebrew letters, and the long s. It also stops lock and dead keys from resetting sequences, clears held keys when the page is hidden, and tightens keyup chords. None of these changes affects the `target` registration contract described in the 16 November notes. `react-hotkeys` 0.27.2 was published during this update; `@tanstack/*` is excluded from the release-age gate.

**Formatting.** oxfmt 0.79 did not reformat any existing file.

## Validation

- Ordinary and frozen-lockfile installation passed with the normal release-age policy, and `effect-tsgo patch` patched TypeScript, Oxlint, its type declarations, and `oxlint-tsgolint`.
- `pnpm peers check`: no peer dependency issues.
- `pnpm outdated -r`: nothing outdated.
- `pnpm typecheck`: all four workspace packages passed. Each desktop project (node, web, test) and the Gmail and database packages also passed individually, with only suggestion-level Effect diagnostics.
- Test suites: 1,058 tests passed across 167 files (1,030 desktop, 28 Gmail). One Windows-only desktop test was skipped on macOS.
- `pnpm check`: formatting and lint passed.
- `pnpm build`: desktop production build and preload-bundle validation passed.
- `pnpm build:marketing`: marketing production build passed.

The installer still reports the same six deprecated transitive dependencies. pnpm also reports agent skills awaiting approval from four packages; none were approved. The desktop app was not launched. No live Gmail actions, real sign-ins, AI generations, packaging, signing, or release were performed. The newly compiled components, the effect and focus changes, and the label dialog's color fieldset were verified by lint, types, and tests, not by using the running app.
