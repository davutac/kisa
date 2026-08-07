# t3code Electron Architecture

Research date: 2026-08-07. The primary source is `pingdotgg/t3code` at commit [`a1762fdd7482728800f1f4fd260c632f01a30b1f`](https://github.com/pingdotgg/t3code/commit/a1762fdd7482728800f1f4fd260c632f01a30b1f). **Fact** describes that snapshot; **Recommendation** is an implementation choice for this repository.

## Decision

**Recommendation:** Copy t3code's boundaries, not its scale. Keep Electron IPC for narrowly scoped host capabilities, put runtime-validated request/result contracts at the boundary, centralize handler installation, and keep preload subscriptions disposable. Do **not** add t3code's local HTTP/WebSocket RPC server to this app: t3code needs that second transport because the same web client connects to local, SSH, WSL, and remote environments, whereas this repository is currently a single desktop application whose Gmail and database capabilities already belong in Electron main.

The most valuable immediate structural changes are to split the growing `src/shared/ipc.ts` by feature, separate IPC method definitions from mail/auth implementation services, turn `src/main/index.ts` into a small composition root, enable Electron's renderer sandbox if compatibility tests pass, and remove the unused broad `window.electron` exposure.

## Repository and Module Organization

**Fact:** t3code separates deployable processes from reusable boundaries:

- `apps/desktop` is the Electron host. Its source is grouped by responsibility (`app`, `backend`, `electron`, `ipc`, `preview`, `settings`, `shell`, `ssh`, `updates`, `window`, and `wsl`) rather than keeping every main-process module in one flat directory ([desktop source tree](https://github.com/pingdotgg/t3code/tree/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src)).
- `apps/web` is the renderer/browser application, while `apps/server` is the environment backend. The desktop package consumes the built web client instead of owning a second renderer implementation ([apps tree](https://github.com/pingdotgg/t3code/tree/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps)).
- `packages/contracts` owns transport-facing schemas and public interfaces; `packages/client-runtime` owns environment connection, authorization, RPC session, and client state behavior ([contracts tree](https://github.com/pingdotgg/t3code/tree/a1762fdd7482728800f1f4fd260c632f01a30b1f/packages/contracts/src), [client-runtime tree](https://github.com/pingdotgg/t3code/tree/a1762fdd7482728800f1f4fd260c632f01a30b1f/packages/client-runtime/src)).

**Recommendation:** This repository does not need new workspaces solely to imitate that layout. Preserve `apps/desktop/src/main`, `preload`, `renderer`, and `shared`, but introduce feature-oriented subdirectories once a concern has more than one file. A proportionate target is:

```text
apps/desktop/src/
  main/
    app/                 # lifecycle, startup, composition
    electron/            # BrowserWindow/protocol/updater adapters
    ipc/
      handlers.ts        # one installation point
      methods/           # auth.ts, mail.ts, updates.ts, ...
    auth/
    mail/                # sync, thread content, read state, sender brand
  preload/
    index.ts
    auth-api.ts
    mail-api.ts
    update-api.ts
  shared/ipc/
    channels.ts
    app.ts
    auth.ts
    mail.ts
    updates.ts
    index.ts
  renderer/src/
```

Keep the current domain-split preload modules. t3code's single `preload.ts` is already large; its architectural value is the narrow bridge, not the file size.

## Renderer Routing and Data Loading

**Fact:** t3code uses TanStack Router with generated file routes. `main.tsx` selects hash history for Electron and browser history otherwise, constructs the router through `router.ts`, and passes it into `AppRoot` ([renderer entrypoint](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/web/src/main.tsx), [router factory](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/web/src/router.ts), [`AppRoot`](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/web/src/AppRoot.tsx)).

**Fact:** Its routes use `beforeLoad` for bootstrap state, authentication gates, and redirects. Live product entities are not fetched into route loaders: route components select them from state modules and environment query hooks, so subscription updates flow directly to mounted UI ([root bootstrap](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/web/src/routes/__root.tsx#L59-L83), [chat authentication gate](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/web/src/routes/_chat.tsx#L186-L197), [thread route state selection](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/web/src/routes/_chat.$environmentId.$threadId.tsx#L15-L96)).

**Recommendation:** Use the same division here: root `beforeLoad` owns desktop startup and initial authentication, while mail list/thread data stays in event-aware renderer hooks. Avoid treating continuously synchronized mailbox entities as one-shot router loader data.

## Two Communication Planes

**Fact:** t3code has two deliberately different communication planes.

1. **Electron shell IPC** handles dialogs, menus, window state, updates, local settings, backend bootstrapping, SSH/WSL control, and embedded preview operations. The renderer sees these through `window.desktopBridge` ([bridge contract](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/packages/contracts/src/ipc.ts#L997-L1136)).
2. **Environment HTTP/WebSocket RPC** handles the application's core stateful backend operations, including projects, orchestration, terminals, VCS, and subscriptions. The contracts explicitly distinguish APIs bound to the local shell from APIs bound to a selected backend environment ([`LocalApi` and `EnvironmentApi`](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/packages/contracts/src/ipc.ts#L1138-L1240)).

This means “main to renderer” is not one mechanism in t3code. Native shell messages use Electron IPC, while most product data reaches the renderer from a backend server over WebSocket RPC.

## Electron Main, Preload, and Renderer Boundary

### Channels and contracts

**Fact:** Electron channel strings are centralized in `apps/desktop/src/ipc/channels.ts` and consistently namespaced with `desktop:` ([channels](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/ipc/channels.ts#L1-L81)). Payload/result types and Effect `Schema` codecs live in the shared contracts package, including the `DesktopBridge` interface. The preload object ends with `satisfies DesktopBridge`, so TypeScript checks that the exposed surface matches the shared interface ([preload bridge](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/preload.ts#L30-L251)). The renderer declares the bridge as an optional `Window` property because the same client also runs in a browser ([window declaration](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/web/src/vite-env.d.ts#L20-L27)).

**Fact:** This is strongly typed but not a generated, single-definition RPC contract for Electron IPC. Channel constants, the `DesktopBridge` method signatures, preload forwarding code, and main method registration remain separate definitions. The `satisfies` check covers the preload object's shape; it does not statically prove that a given channel's main handler uses the corresponding bridge payload and result.

### Main-side validation and registration

**Fact:** t3code wraps `ipcMain` in an Effect service. `makeIpcMethod` decodes unknown renderer input with the declared payload schema, runs the feature handler, then encodes its result with the result schema. Registration is scoped: an acquired handler is removed during release, and registration/unregistration failures carry the handler kind and channel ([IPC service and method builder](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/ipc/DesktopIpc.ts#L70-L228)).

**Fact:** Feature modules export declarative method values containing `channel`, `payload`, `result`, and `handler`; a single `installDesktopIpcHandlers` function installs them ([window method examples](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/ipc/methods/window.ts#L146-L278), [central installer](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/ipc/DesktopIpcHandlers.ts#L48-L101)). This keeps transport registration out of feature services and makes the complete exposed main-process surface reviewable in one place.

**Recommendation:** Introduce the same small abstraction here using Effect v4 and `Schema`: decode every renderer payload in main, encode every result/event DTO, and register every method centrally. This can replace repeated ad hoc `unknown` checks and reduce drift among `shared/ipc.ts`, preload interfaces, and `ipcMain.handle` callbacks. Keep expected domain failures explicit—either schema-encoded tagged results or a consistent bridge error envelope—rather than depending on Electron's serialization of arbitrary thrown errors.

### Renderer calls and events

**Fact:** Preload maps bridge methods to `ipcRenderer.invoke` (with a few synchronous bootstrap reads), and renderer-facing event methods wrap `ipcRenderer.on` and return a closure that removes the exact wrapped listener. This pattern is used for SSH prompts, menu actions, fullscreen changes, update state, and preview events ([preload calls and subscriptions](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/preload.ts#L30-L251)). Main sends event state through a window adapter; update state is broadcast with `sendAll`, for example ([update event send](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/updates/DesktopUpdates.ts#L265-L275)).

**Fact:** The web layer often wraps `window.desktopBridge` again behind a smaller environment-neutral API with browser fallbacks, so React code does not need to know whether dialogs, links, menus, or settings come from Electron ([renderer `LocalApi`](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/web/src/localApi.ts#L1-L72)).

**Recommendation:** Retain this repository's existing subscription cleanup convention; it already matches t3code. Add runtime decoding for main-to-renderer event payloads as well. Renderer features should preferably depend on small domain clients/hooks rather than reaching for `window.api` throughout the component tree.

### Security boundary

**Fact:** t3code's main window enables `contextIsolation`, disables Node integration, and enables the Electron sandbox. It also denies new windows, sends safe external URLs to the OS shell, and blocks cross-origin top-level navigation ([window security options](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/window/DesktopWindow.ts#L329-L349), [navigation policy](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/window/DesktopWindow.ts#L502-L522)).

**Recommendation:** Change this app's `sandbox: false` to `sandbox: true` after its preload and packaged builds pass. Remove `contextBridge.exposeInMainWorld("electron", electronAPI)` and the corresponding `window.electron` declaration if a repository-wide search still finds no consumer; exposing only the application-owned `window.api` is narrower and removes redundant surface.

## RPC: Where t3code Uses It and Why

**Fact:** t3code does use RPC, but not as a wrapper around Electron IPC. `packages/contracts/src/rpc.ts` declares Effect RPC methods with payload, success, error, and optional streaming schemas, then combines them into `WsRpcGroup` ([RPC method examples](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/packages/contracts/src/rpc.ts#L270-L390), [`WsRpcGroup`](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/packages/contracts/src/rpc.ts#L805-L886)). The client is generated from that group, connected through a JSON-serialized WebSocket protocol, and supervised as an environment session ([protocol client](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/packages/client-runtime/src/rpc/protocol.ts#L1-L8), [WebSocket session](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/packages/client-runtime/src/rpc/session.ts#L69-L121)). The server mounts the same group on `/ws` using Effect's WebSocket RPC server and JSON serialization ([server transport](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/server/src/ws.ts#L2144-L2165)).

**Fact:** Renderer operations call typed unary methods or subscribe to typed streams through `packages/client-runtime`; subscription streams switch when the selected environment session changes and clean up observations when they terminate ([client request/subscription facade](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/packages/client-runtime/src/rpc/client.ts#L89-L248)).

**Recommendation:** Do not introduce a local server or WebSocket RPC layer for Gmail, database, updates, or OAuth. Electron IPC is already the correct trust boundary. Revisit shared RPC only if this renderer must later run independently in a browser or connect to remote backends.

## Composition Roots and Testing

**Fact:** `apps/desktop/src/main.ts` acts primarily as a composition root. It builds Electron adapter layers, desktop foundation layers, feature layers, and the final runtime layer, then provides them to `DesktopApp.program` ([desktop composition](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/main.ts#L66-L217)). `DesktopApp` owns startup order: configure pre-ready concerns, await Electron readiness, register IPC, start the backend, and keep cleanup scoped ([desktop startup program](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/app/DesktopApp.ts#L184-L220)). Electron itself is wrapped behind small services, allowing feature methods to depend on capabilities rather than globals.

**Fact:** Boundary tests are layered rather than relying only on end-to-end Electron tests:

- `DesktopIpc.test.ts` checks registration errors and scoped unregistration behavior with a fake `ipcMain` ([IPC adapter tests](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/ipc/DesktopIpc.test.ts#L14-L79)).
- Method tests invoke exported handlers directly with test/mocked Effect layers ([IPC method test](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/ipc/methods/window.test.ts#L51-L148)).
- The Electron window adapter tests native creation and main-to-renderer send failures without launching a real renderer ([window adapter tests](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/src/electron/ElectronWindow.test.ts#L43-L205)).
- RPC session tests use a fake WebSocket, while the desktop smoke test launches the built app and scans startup output for fatal failures ([RPC session tests](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/packages/client-runtime/src/rpc/session.test.ts), [desktop smoke test](https://github.com/pingdotgg/t3code/blob/a1762fdd7482728800f1f4fd260c632f01a30b1f/apps/desktop/scripts/smoke-test.mjs#L1-L58)).

I did not find a dedicated test that executes the complete `contextBridge` preload mapping against matching real main handlers at this commit. The compile-time `satisfies DesktopBridge` check and lower-level tests cover much of the seam, but a small contract-parity test would still catch missing/mismatched registrations.

**Recommendation:** For this repository, test three layers: schema decode/encode for every public method, each handler against mocked service layers, and a compact bridge parity test that verifies every declared invoke/event channel is represented in preload and main registration. Keep one packaged Electron smoke test for preload loading, sandbox compatibility, and startup.

## Adopt, Adapt, Avoid

| t3code pattern | Choice here | Reason |
| --- | --- | --- |
| Responsibility/feature folders | Adopt | The current flat main directory and large `mail-sync.ts` obscure boundaries. |
| One central IPC installer | Adopt | Makes the privileged surface auditable and removes registration from services. |
| Shared bridge interface plus runtime schemas | Adopt | Compile-time types alone do not validate hostile or stale renderer data. |
| Disposable event subscriptions | Keep | The current preload APIs already return unsubscribe closures. |
| Small Electron capability adapters | Adapt gradually | Highest value around windows, shell, safe storage, and updater; avoid wrapper ceremony for trivial constants. |
| One giant preload file | Avoid | Existing per-domain preload modules are easier to navigate. |
| Local HTTP/WebSocket Effect RPC backend | Avoid for now | It solves t3code's multi-environment/web-client requirement, which this app does not have. |
| Separate `packages/contracts` workspace | Defer | Split `shared/ipc` first; extract a workspace only when another app/package consumes it. |
