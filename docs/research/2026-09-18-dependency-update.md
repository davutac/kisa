# Dependency update — 18 September 2026

Updated 29 direct catalog packages and pnpm. Existing prerelease channels and version-range styles are preserved.

## Direct version changes

| Package                          | Previous       | Updated        |
| -------------------------------- | -------------- | -------------- |
| `@anthropic-ai/claude-agent-sdk` | `^0.3.261`     | `^0.3.276`     |
| `@astrojs/react`                 | `^6.0.5`       | `^6.0.6`       |
| `@effect/vitest`                 | `4.0.0-rc.112` | `4.0.0-rc.115` |
| `@googleapis/gmail`              | `^18.0.0`      | `^22.0.0`      |
| `@opencode/client`               | `^2.0.2`       | `^2.0.8`       |
| `@oxlint/plugins`                | `^1.81.0`      | `^1.83.0`      |
| `@rolldown/plugin-babel`         | `^0.2.3`       | `^0.2.4`       |
| `@tanstack/react-router`         | `^1.170.32`    | `^1.170.38`    |
| `@tanstack/react-virtual`        | `^3.14.10`     | `^3.14.13`     |
| `@tanstack/router-plugin`        | `^1.168.35`    | `^1.168.40`    |
| `@types/node`                    | `^26.4.1`      | `^26.6.1`      |
| `@types/react`                   | `^19.2.18`     | `^19.3.0`      |
| `@types/react-dom`               | `^19.2.7`      | `^19.3.0`      |
| `astro`                          | `7.3.1`        | `7.3.3`        |
| `electron`                       | `^44.2.0`      | `^44.4.2`      |
| `effect`                         | `4.0.0-rc.112` | `4.0.0-rc.115` |
| `lucide-react`                   | `^1.41.0`      | `^1.47.0`      |
| `motion`                         | `^13.2.0`      | `^13.4.0`      |
| `oxfmt`                          | `^0.66.0`      | `^0.68.0`      |
| `react`                          | `^19.2.8`      | `^19.3.0`      |
| `react-dom`                      | `^19.2.8`      | `^19.3.0`      |
| `react-resizable-panels`         | `^4.12.3`      | `^4.12.4`      |
| `tailwind-merge`                 | `^3.6.0`       | `^3.7.0`       |
| `tldts`                          | `7.4.11`       | `7.4.13`       |
| `turbo`                          | `^2.10.12`     | `^2.10.13`     |
| `vite`                           | `^8.2.2`       | `^8.3.0`       |
| `vitest`                         | `^4.1.11`      | `^5.0.1`       |
| `wrangler`                       | `^4.129.0`     | `^4.135.0`     |
| `zod`                            | `^4.5.4`       | `^4.6.5`       |
| pnpm                             | `12.4.1`       | `12.4.2`       |

## Compatibility holds

The registry audit has four remaining updates, all in the existing protected compiler/lint toolchain:

| Package           | Retained   | Registry latest |
| ----------------- | ---------- | --------------- |
| `@effect/tsgo`    | `0.36.5`   | `0.45.0`        |
| `oxlint`          | `1.78.0`   | `1.83.0`        |
| `oxlint-tsgolint` | `7.0.2001` | `7.0.2002`      |
| `ultracite`       | `7.10.5`   | `7.12.0`        |

The attempted `@effect/tsgo` 0.45.0 / Oxlint 1.82.0 / Ultracite 7.12.0 combination produced 198 false redeclaration diagnostics for valid TypeScript value/type pairs and React Compiler diagnostics across existing code. Its native patch manifest supports Oxlint only through 1.82.0 and `oxlint-tsgolint` only through 7.0.2001. The previously verified toolchain remains in place, as required by the README, without adding lint suppressions.

TypeScript 7.0.2 is current. The separate Astro catalog remains on the latest TypeScript 6 release, 6.0.3, because Astro needs the JavaScript compiler API. Drizzle remains on plain RC 4 and electron-vite on beta 1; neither was promoted to a different channel or commit-suffixed release.

## OpenCode 2.0.8 migration

The client now targets 2.0.8. Its generation endpoint moved to `/api/experimental/generate`, and `plugin.awaitActivation` was removed. Catalog discovery opens the event stream before initializing its temporary location, waits for a matching `plugin.updated` event, then reads models and providers. The existing timeout, cancellation, location eviction, and temporary-directory cleanup remain in force. Tests exercise the real client HTTP serialization with synthetic responses, including cold activation and event-stream cancellation.

Scoped overrides align the OpenCode client, protocol, and schema packages with Effect RC 115, avoiding a second Effect runtime and resolving its exact RC 112 peer requirement. No global peer-warning suppression was added.

Upstream references: [OpenCode plugin handler](https://github.com/anomalyco/opencode/blob/v2.0.8/packages/server/src/handlers/plugin.ts), [plugin activation events](https://github.com/anomalyco/opencode/blob/v2.0.8/packages/core/src/plugin.ts), [Vitest 5 migration guide](https://vitest.dev/guide/migration/).

## Validation

- Ordinary and frozen-lockfile installation passed with the normal release-age policy. Exact-version exclusions cover the newly requested releases and their platform binaries; the global age gate remains enabled.
- `pnpm peers check`: no peer dependency issues.
- `pnpm typecheck`: all four workspace packages passed.
- Test suites: 962 tests passed across 155 files (934 desktop, 28 Gmail). During cleanup, the OAuth callback tests required a rerun outside the sandbox to bind their temporary localhost server.
- OpenCode focused verification: 27 tests passed, including activation isolation and event-stream cancellation.
- `pnpm check`: formatting and lint passed.
- `pnpm build`: desktop production build and preload-bundle validation passed.
- `pnpm build:marketing`: marketing production build passed.
- `git diff --check`: passed.

The installer still reports seven deprecated transitive dependencies: `@xmldom/xmldom@0.8.13`, `boolean@3.2.0`, `glob@7.2.3`, `inflight@1.0.6`, `lodash.isequal@4.5.0`, `node-domexception@1.0.0`, and `rimraf@2.6.3`. The desktop build reports Babel plugin timing information. No live Gmail actions, real AI generations, packaging, signing, or release were performed.
