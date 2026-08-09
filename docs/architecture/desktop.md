# Desktop architecture

Kisa follows the Electron boundary used by t3code: shared runtime contracts, a narrow preload bridge, schema-validated main-process methods, a central handler installer, and renderer adapters that hide the host transport.

The comparison and source links are recorded in [`../research/t3code-electron-architecture.md`](../research/t3code-electron-architecture.md).

## Main-to-renderer communication

```text
React feature / hook
  -> renderer platform/desktop.ts
  -> window.desktopBridge
  -> preload capability module
  -> ipcRenderer.invoke
  -> main/ipc/desktop-ipc.ts
       decode request with Effect Schema
       run capability method
       encode result with Effect Schema
  -> renderer
```

Events take the reverse path. `main/electron/renderer-events.ts` encodes the payload before sending it; `preload/subscribe.ts` decodes it before notifying a renderer listener. Every subscription returns an exact unsubscribe function.

Conversation popouts use the same boundary. The main mailbox requests an account-scoped thread window through a schema-validated IPC method, and only closes its inline conversation after the new window's renderer has loaded. Each popout loads the dedicated `/thread/$accountId/$threadId` hash route, reuses the existing mail bridge, and has minimal window chrome. A second request for the same account and Gmail thread focuses the existing popout; the main window remains the explicit target for app activation, OAuth handoff, and notification-click fallback.

## Ownership

```text
apps/desktop/src/
  main/
    app/        lifecycle and protocol registration
    auth/       Google authorization and credential access
    electron/   Electron adapters used by capabilities
    ipc/        transport runtime, method definitions, central installer
    mail/       Gmail synchronization and message presentation adapters
    updates/    updater state machine and Electron updater integration
    window/     native window state
  preload/      the only renderer exposure of privileged capabilities
  renderer/     React application, feature UI, state, and host adapters
  shared/ipc/   channels, Effect Schema codecs, and DesktopBridge contract
```

Feature services do not register `ipcMain` handlers. Each public operation is a declarative method under `main/ipc/methods`, and `desktop-ipc-handlers.ts` is the single reviewable list of privileged calls.

The renderer does not import main or preload modules and does not call Electron directly. Components use feature hooks or `platform/desktop.ts`; browser mode is represented by an absent optional bridge.

## Renderer organization and routing

The renderer follows the same broad shape as t3code's web app: feature-oriented component folders, domain logic outside React components, a `state` folder for application-wide context, and a small `platform` adapter around the host bridge.

```text
renderer/src/
  components/
    accounts/   authentication and account controls
    mail/       mailbox and conversation presentation
    shell/      title bar, theme, and app chrome
    startup/    startup boundary and splash UI
    updates/    update presentation
    ui/         generated design-system primitives
  mail/         mailbox model, queries, and feature hooks
  platform/     environment-neutral access to desktop capabilities
  routes/       TanStack Router file routes
  startup/      startup session model
  state/        renderer-wide providers
  updates/      update state presentation model
```

`main.tsx` selects TanStack Router history before rendering: hash history inside Electron and browser history for the web fallback. `router.ts` owns router construction and type registration, and `App` mounts `RouterProvider` immediately.

As in t3code, route lifecycle code is reserved for navigation gates and initial bootstrap state. The root route's `beforeLoad` starts the desktop runtime and resolves the initial authentication state; its pending and error components own the startup splash. Live product data remains in renderer state modules and feature hooks: the mailbox list uses `useMailboxThreads`, and the thread route uses `useMailThread`. This keeps routes declarative while allowing IPC events to update mounted screens without invalidating router loaders.

## Security boundary

The renderer is sandboxed with context isolation. Preload exposes only the application-owned `desktopBridge`; the generic Electron toolkit API is not available to page code. Unknown renderer inputs are decoded in main, and main-to-renderer event values are decoded again in preload.

The sandbox preload is emitted as CommonJS and bundles its non-Electron dependencies. Sandboxed Electron preloads cannot load the application's ESM entrypoint or resolve arbitrary package imports at runtime. If Electron starts without the bridge, the root route now reports a startup failure instead of silently rendering the browser fallback with an empty account list.

On quit, the main process sends a typed closing event before stopping mail synchronization and waiting for the database and IPC runtimes to dispose. The renderer keeps a route-independent closing overlay mounted so cleanup remains visible even when quit is requested during startup or from a non-mail route.

## Scope relative to t3code

t3code also has an HTTP/WebSocket RPC plane because its web client connects to local, SSH, WSL, and remote environments. Kisa has one desktop host, so adding a local server would duplicate Electron IPC without adding an environment boundary. If Kisa gains a standalone web client or remote mailbox backend, that is the point to introduce a shared RPC contract.
