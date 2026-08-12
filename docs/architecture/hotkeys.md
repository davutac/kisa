# Hotkeys

Kisa keeps application-level shortcuts behind the `@/hotkeys` renderer module. Components register typed command IDs rather than configuring TanStack Hotkeys directly, so the same registry drives behavior, labels, visual hints, ARIA metadata, input handling, and repeat behavior.

```text
command registry ──> useAppCommand ──> TanStack Hotkeys ──> keyboard events
       │                    ▲
       ├──> HotkeyHint      │
       ├──> ARIA labels     │
       └──> validation   active layer
```

## Ownership

The hotkey module owns commands that apply to an application screen or interaction mode:

- App navigation, search, templates, and message composition
- Mailbox selection, thread opening, read-state toggling, and trashing
- Closing the active thread and acting on the conversation being read
- Selecting the composer account, attaching files, stashing a draft, and sending a message
- Creating, searching, and explicitly saving templates

Focused widgets retain their native keyboard behavior. Recipient completion, search results, dialogs, and the rich-text editor continue to own keys such as arrows, Enter, Escape, and editing shortcuts while focused.

Application renderer code should not import `@tanstack/react-hotkeys` outside `@/hotkeys` and the root provider setup.

## Command registry

`commands.ts` defines every application command with:

- One or more platform-neutral bindings
- A user-facing label
- Its interaction scope
- Whether it works inside text inputs
- Whether holding the key may repeat the command

Callers register a command with its callback:

```tsx
useAppCommand("mailbox.nextThread", () => moveSelection(1), {
  enabled: threads.length > 0,
});
```

The hook expands alternative bindings and unregisters inactive commands. It intentionally exposes only `enabled` and an optional element target; callers cannot override registry policy.

Dynamic lists use the renderless `AppCommand` component, which delegates to the same hook without calling hooks inside a loop.

Account commands are static and cover the supported maximum of nine accounts. The app uses `1` through `9` for account navigation and the composer uses `Mod+1` through `Mod+9` for its From account.

In the new-email composer, `Mod+S` stashes a non-empty draft, resets the form, and keeps the dialog open. On a blank form, it opens the stash picker when saved stashes are available. The command can be pressed again without releasing `Mod`, while operating-system key repeat from holding `S` is ignored. The same command definition drives the Stash button hint and ARIA metadata.

`U` toggles the unread-only mailbox filter. `S` toggles the Spam mailbox.

When a mailbox thread is selected, `M` toggles its read state. In Inbox, both `Backspace` and `Delete` move it to trash; in Spam, they open the permanent-delete confirmation. This covers the Mac key labeled `⌫`, Mac forward-delete, and the Windows/Linux Delete key. These commands are not registered for hover-only quick actions.

While reading a conversation in the main window, `Shift+Enter` opens it in a thread window and closes the inline conversation. The command is disabled inside the resulting thread window because it is already popped out.

While reading a conversation, `L` scrolls the label row into view and opens its picker. `M`, `Backspace`, and `Delete` retain the same read-state and mailbox-context behavior as they have on the selected mailbox conversation.

`Mod+Shift+A` opens the attachment picker while composing a new email.

`Mod+,` and `Mod+Shift+T` toggle Settings and Templates. Pressing the active workspace's shortcut again restores the previous titlebar view. In the Templates workspace, `Mod+Shift+N` creates a template, `Mod+F` focuses template search, and `Mod+S` explicitly saves the active template. `Mod+Shift+]` and `Mod+Shift+[` select the next and previous filtered template, stopping at the list edges. The modified bracket pair remains available inside form fields and the rich-text editor without taking over ordinary `Tab` navigation or the operating system's app switcher.

## Interaction layers

Mounted features declare their active layer with `useHotkeyLayer`:

```tsx
useHotkeyLayer("composer", isOpen);
```

The provider stores each declaration under a unique token. The highest-priority, most recently activated registration becomes the top layer.

| Top layer   | Active scopes                |
| ----------- | ---------------------------- |
| None        | `always`, `app`              |
| `mailbox`   | `always`, `app`, `mailbox`   |
| `thread`    | `always`, `app`, `thread`    |
| `settings`  | `always`, `app`, `settings`  |
| `templates` | `always`, `app`, `templates` |
| `composer`  | `always`, `composer`         |
| `search`    | `always`, `search`           |
| `blocking`  | `always`                     |

Composer and search overlays suppress every underlying application command. Removing an overlay registration restores the layer beneath it, so only the top interaction handles overlapping keys such as Escape.

Blocking operations, such as database import, and app-wide confirmation dialogs activate the highest-priority `blocking` layer. It suspends every product command while the modal owns the window; only commands in the reserved `always` scope remain active.

The fixed priorities are:

```ts
const LAYER_PRIORITY = {
  blocking: 1000,
  composer: 100,
  search: 100,
  thread: 20,
  mailbox: 10,
  settings: 10,
  templates: 10,
} as const;
```

Equal-priority layers use activation order.

## Display and accessibility

`HotkeyHint` formats bindings with platform-native labels such as `⌘` on macOS and `Ctrl` on Windows and Linux. `getHotkeyAriaLabel` resolves the registry's `Mod` notation to the ARIA modifier names `Meta` or `Control`.

Buttons and tooltips should derive labels and shortcut metadata from the registry:

```tsx
<Button
  aria-keyshortcuts={getHotkeyAriaLabel("app.searchMail")}
  aria-label={getHotkeyDisplay("app.searchMail").label}
>
  <HotkeyHint command="app.searchMail" />
</Button>
```

## Composer integration

Tiptap's StarterKit maps `Mod+Enter` to a hard break, while Kisa maps it to Send. `EmailComposer` can install a high-priority Tiptap extension that consumes the editor command without stopping DOM propagation. TanStack then handles Send at the document layer. `Mod+S` remains an application command while the composer layer is active, and `Shift+Enter` remains owned by Tiptap.

## Validation

The pure registry validator normalizes bindings for macOS, Windows, and Linux. It rejects duplicate or sequence-prefix bindings in scopes that can be active together, while allowing the same binding in mutually exclusive layers.

Focused tests cover:

- Layer priority, restoration, and Strict Mode registration cycles
- Registry conflicts and platform formatting
- Account command coverage through the nine-account limit
- Tiptap's `Mod+Enter` guard

Run the desktop checks with:

```sh
pnpm --dir apps/desktop test
pnpm --dir apps/desktop typecheck
```
