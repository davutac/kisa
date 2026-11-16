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

Conversation popouts use the same boundary. The main mailbox requests an account-scoped thread window through a schema-validated IPC method, and only closes its inline conversation after the new window's renderer has loaded. Each popout loads the dedicated `/thread/$accountId/$threadId` hash route, reuses the existing mail bridge, and has minimal window chrome. A second request for the same account and Gmail thread focuses the existing popout; the main window remains the explicit target for app activation, the local OAuth callback, and notification-click fallback.

The app-wide Animations, "Run in background", and "Always open threads in new windows" preferences live in one `app-settings.json` file under the user data directory. Main loads them once before creating the window, and the renderer receives the hydrated settings in its app-start reply. Opening Settings therefore does not trigger another read or render temporary default values. Updates change in-memory behavior immediately, while asynchronous file writes are debounced and flushed during orderly shutdown. Theme remains renderer-owned through `next-themes`.

Animations default to enabled. A shared provider applies the preference to the main, thread, and attachment-preview renderers. Disabling it removes CSS animations and transitions and configures Motion for reduced motion; enabling it restores motion while preserving the operating system's reduced-motion preference. "Always open threads in new windows" changes the default for mailbox clicks, the mailbox open command, and search results, while the explicit inline popout action remains available when the preference is off.

"Run in background" defaults to enabled. When enabled, closing the main window hides it to a system tray icon instead of quitting, so mail synchronization and notifications keep running. On macOS, the Dock icon is also hidden while no Kisa windows are visible and restored with the window. When disabled, closing the last open window quits the app on every platform, including macOS. The tray menu restores the window or quits.

"Launch at login" is available on macOS and Windows, the platforms supported by Electron's login-item API. The operating system owns this value. Settings reads it on mount, writes changes through a narrow IPC method, and displays the value Electron reports after each write. Kisa does not copy it into `app-settings.json`, so changes made in macOS System Settings or Windows Startup Apps remain authoritative. A macOS login item that requires approval stays off and explains the required System Settings action.

## Ownership

```text
apps/desktop/src/
  main/
    app/        lifecycle and activation handling
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

Packaged self-updates are user-driven after discovery. The main process checks in the background and publishes an available version without downloading it. The title bar and Settings expose the same sequence: download on the first action, show bounded progress, then request renderer-wide confirmation before the install action closes and restarts Kisa. Automatic download and install-on-quit remain disabled, and the main lifecycle accepts download and install calls only from their matching states.

The renderer does not import main or preload modules and does not call Electron directly. Components use feature hooks or `platform/desktop.ts`; browser mode is represented by an absent optional bridge.

The local SQLite database uses the `better-sqlite3-multiple-ciphers` implementation with a fixed ChaCha20 configuration. Main generates a 256-bit key, seals it with Electron `safeStorage`, and stores only the sealed blob beside the database. Development uses `app.dev.sqlite` and `app.dev.sqlite.key`; packaged builds use `app.sqlite` and `app.sqlite.key`. On Linux, main configures Chromium's password store before Electron becomes ready: desktops with a known secure automatic selection keep it, while LXQt and unrecognized sessions request Secret Service through `gnome-libsecret`. Explicit command-line selection remains authoritative. After startup, Kisa accepts only libsecret or KWallet backends and rejects `basic_text`, `unknown`, and failed secure-store fallbacks.

Main sends the unlocked key to the database utility process as its first private process message; it never enters renderer IPC, process arguments, environment variables, or logs. The utility applies the key before any query or migration and erases its key buffer after opening the connection. Existing plaintext databases are checkpointed, switched out of WAL, and encrypted in place with `rekey` before normal startup continues.

Database RPC results are always arrays of rows. Queries that need at most one row remain bounded with `LIMIT 1` and select the first returned row in main; scalar proxy `get` execution is rejected so an empty result cannot be confused with a row whose fields are `undefined`.

The Database settings section exports a versioned `.kisa-key` recovery file and imports an existing Kisa database with that key. A blocking overlay accepts each file through a native picker or drop target, then reports coarse progress after the user starts the import. Selected paths remain behind an opaque main-process session; the renderer receives only display names, and preload resolves dropped `File` objects without exposing their paths. Import copies and validates a private staged database in an isolated utility process. A clean restart activates the staged files and preserves the previous database, sealed key, and journal sidecars under `database/backups/`; interrupted activation resumes on the next startup. Packaged builds can relaunch automatically. Development quits instead because `electron-vite` owns the renderer server, and the user reruns the development command.

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

Destructive and interrupting actions use the renderer-wide `ConfirmDialogProvider`. Features call `useConfirm()` with their copy and await a boolean result instead of owning dialog-open state. The provider serializes overlapping requests, restores focus after the queue drains, resolves pending requests as cancelled when it unmounts, and can require exact confirmation text for especially destructive actions. The shared view owns the confirmation layout and keyboard behavior: Escape cancels, while Enter confirms once any required text matches. The operation itself starts only after the dialog resolves.

Mail dates follow desktop mail convention. Lists show today's time, then "Yesterday", a weekday for the past six days, a month and day for the current year, and a full date for older years; message, reply, scheduled-delivery, and label-sync dates add the time to every day, while the thread header keeps the compact form so the subject keeps its room in a narrow pop-out window. Buckets are calendar days in the current time zone, so a message from 23:50 reads "Yesterday" just after midnight, and a bare weekday is never used for a future date. Hoverable dates spell out the full date and time in a tooltip. Dates in mailbox rows and message headers sit under the row's activation button, where a tooltip could never open, so they render as bare `<time>` elements and the full date reaches assistive technology through the row's accessible name or the element's label. Wording, including "Yesterday" and 12- or 24-hour time, comes from the renderer's Intl locale like Kisa's other dates; Electron derives that from the system language rather than the macOS region or clock setting, so a German system shows "Gestern" beside English interface text.

One shared calendar holds the current day and system time zone. A midnight timer would run late after sleep, when Chromium pauses timers, and would miss a time-zone change, so the calendar is re-read every minute while dates are on screen and whenever the window regains focus. Visible dates re-render only when the day or zone actually changed. Formatters are built for that zone, so travelling cannot leave wall-clock times or day buckets from the startup zone, and a system zone that Intl cannot load by name falls back to the implicit default zone.

Mailbox rows separate read from unread mail without fading the row, which would drop muted text below readable contrast. Unread rows set sender and subject semibold at full foreground color and add a small dot before the date; read rows use regular weight and slightly muted text. Labels and attachments keep full contrast either way, and the row's accessible name includes the unread state and conversation size. Scheduled rows use the read-row treatment.

Rows listed in a mailbox omit that mailbox's own system label, and the Sent mailbox omits the sent marker, because every row would repeat them; search results keep them because they span mailboxes. A row names its account only when the view mixes several connected accounts.

Footer and dialog actions follow one hierarchy: the action a surface exists for (Send, Schedule, Save template, a dialog's confirm) is the filled primary button; alternatives and cancels are secondary or outline; and a labelled action that deletes data, such as Disconnect, uses the destructive variant before its confirmation, while icon-only delete actions (Trash, bulk Trash, Discard draft, Discard scheduled email, Delete template) stay neutral at rest and turn red on hover so they never outrank the action beside them. Footers share one order: icon tiles (Stash, Discard, Delete) lead, the primary fills toward the trailing edge, and only the primary's own option, the Schedule trigger, follows it. Composer and template footers start disabled more often than not (no recipients yet, nothing to save), so their primary rests at the secondary level until it can run, keeping an inert control from being the loudest thing on screen. Conversation actions (Reply, Reply all, Forward) stay equal peers.

## Security boundary

The renderer is sandboxed with context isolation. Preload exposes only the application-owned `desktopBridge`; the generic Electron toolkit API is not available to page code. Unknown renderer inputs are decoded in main, and main-to-renderer event values are decoded again in preload.

Google authorization is an installed-app flow owned by Electron main. On the first connection, the user chooses a Desktop OAuth credentials JSON through a main-owned native file dialog; the renderer never receives the path or file contents. Main encrypts that client configuration once in the app's user-data directory and reuses it for later account connections. Each attempt opens the system browser with PKCE and a random CSRF state, binds a temporary HTTP listener only to `127.0.0.1` on an operating-system-assigned port, and closes that listener after one valid callback or ten minutes. Main exchanges and refreshes tokens directly with Google.

After authorization, the client identity is also stored inside the account's encrypted credential blob so refreshes remain bound to the client that issued the token. An installed app cannot keep its client secret confidential, so PKCE and validated state remain the security boundary. OAuth client credentials, access tokens, and refresh tokens remain encrypted behind `safeStorage` and never enter renderer IPC. Kisa has no OAuth relay or other server.

The sandbox preload is emitted as CommonJS and bundles its non-Electron dependencies. Sandboxed Electron preloads cannot load the application's ESM entrypoint or resolve arbitrary package imports at runtime. If Electron starts without the bridge, the root route now reports a startup failure instead of silently rendering the browser fallback with an empty account list.

On quit, the main process sends a typed closing event before stopping mail synchronization and waiting for the database and IPC runtimes to dispose. The renderer keeps a route-independent closing overlay mounted so cleanup remains visible even when quit is requested during startup or from a non-mail route.

## Scope relative to t3code

t3code also has an HTTP/WebSocket RPC plane because its web client connects to local, SSH, WSL, and remote environments. Kisa has one desktop host, so adding a local server would duplicate Electron IPC without adding an environment boundary. If Kisa gains a standalone web client or remote mailbox backend, that is the point to introduce a shared RPC contract.
