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
- Mailbox focus and multi-selection, thread opening, read-state toggling, and trashing
- Closing the active thread and acting on the conversation being read
- Selecting messages within a conversation and replying to or forwarding the selected message
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

Reversible state toggles use `ignore-key-repeat`: each distinct keydown is accepted without depending on a later keyup, while operating-system repeats from holding the key are ignored. One-way commands may use `once` when suppressing another invocation until the chord is released is part of the interaction.

Dynamic lists use the renderless `AppCommand` component, which delegates to the same hook without calling hooks inside a loop.

Account commands are static for the first nine accounts. The app uses `1` through `9` for account navigation and the composer uses `Mod+1` through `Mod+9` for its From account. Additional accounts remain available through the account switcher and composer picker without a numbered shortcut.

In the new-email composer, `Mod+S` stashes a non-empty draft, resets the form, and keeps the dialog open. On a blank form, it opens the stash picker when saved stashes are available. The command can be pressed again without releasing `Mod`, while operating-system key repeat from holding `S` is ignored. The same command definition drives the Stash button hint and ARIA metadata.

`U` toggles the unread-only mailbox filter. `S` toggles the Spam mailbox.

`J`, `K`, and the arrow keys move mailbox focus. `X` adds or removes the focused conversation from the bulk selection. A revealed row checkbox provides the same action with the mouse. Pressing and dragging anywhere across a conversation row paints that row's checked or unchecked state across every row crossed; reversing the drag restores the rows crossed on the way back. A 15-pixel movement tolerance keeps ordinary clicks opening the conversation. `Escape` clears both bulk selection and mailbox focus.

When conversations are checked, Apple Mail-style `Mod+Shift+U` applies to the full selection: it marks the selection unread only when every selected conversation is currently read; otherwise it marks the selection read. `Mod+D` moves the selection to trash, or opens the permanent-delete confirmation in Spam. Without a bulk selection these commands continue to target the focused conversation. These commands are not registered for hover-only quick actions.

The floating selection toolbar exposes explicit mark-read and mark-unread actions. `Mod+L` opens its label dropdown while a bulk selection exists. The dropdown groups selected conversations by account because Gmail label ids are account-owned; toggling a label only changes selected conversations in that account group.

While reading a conversation in the main window, `Mod+Enter` opens it in a thread window and closes the inline conversation. The command is disabled inside the resulting thread window because it is already popped out. Once a thread composer is open, its higher-priority layer owns `Mod+Enter` for sending instead.

While reading a conversation, `Mod+L` scrolls the label row into view and opens its picker. `Mod+Shift+U` and `Mod+D` retain the same read-state and mailbox-context behavior as they have on the selected mailbox conversation.

Within a conversation, `J` or `ArrowDown` selects and opens the next newer message, while `K` or `ArrowUp` selects and opens the previous older message. Navigation stops at the thread edges and closes the previously expanded message. Plain `Tab` remains native so headers, links, attachments, and footer actions stay keyboard-accessible.

`R` replies to the selected message, `Shift+R` replies to everyone on it, and `F` forwards it. Reply all is available only when the selected message has at least two distinct non-self reply targets across its sender, To, and Cc fields; otherwise its footer button is omitted and `Shift+R` is inactive. Bcc recipients never count toward reply all. A draft captures that message as its immutable target. When a saved draft is resumed, its target becomes the selected message again. The footer buttons derive their shortcut labels and ARIA metadata from these commands.

`Mod+Shift+A` opens the attachment picker while composing a new email, reply, reply-all, or forward.

`Mod+Shift+C` cleans up the current new-email draft using the provider and model shown in the Clean button tooltip. The command remains available while focus is in the subject or message editor and is disabled for an empty draft or while another compose action is running.

`Mod+,` and `Mod+Shift+T` toggle Settings and Templates. Pressing the active workspace's shortcut again restores the previous titlebar view. In the Templates workspace, `Mod+Shift+N` creates a template, `Mod+F` focuses template search, and `Mod+S` explicitly saves the active template. `Mod+Shift+]` and `Mod+Shift+[` select the next and previous filtered template, stopping at the list edges. The modified bracket pair remains available inside form fields and the rich-text editor without taking over ordinary `Tab` navigation or the operating system's app switcher.

## Interaction layers

Mounted features declare their active layer with `useHotkeyLayer`:

```tsx
useHotkeyLayer("composer", isOpen);
```

The provider stores each declaration under a unique token. The highest-priority, most recently activated registration becomes the top layer.

| Top layer         | Active scopes                      |
| ----------------- | ---------------------------------- |
| None              | `always`, `app`                    |
| `mailbox`         | `always`, `app`, `mailbox`         |
| `thread`          | `always`, `app`, `thread`          |
| `thread-composer` | `always`, `app`, `thread-composer` |
| `settings`        | `always`, `app`, `settings`        |
| `templates`       | `always`, `app`, `templates`       |
| `composer`        | `always`, `composer`               |
| `search`          | `always`, `search`                 |
| `blocking`        | `always`                           |

Composer and search overlays suppress every underlying application command. Removing an overlay registration restores the layer beneath it, so only the top interaction handles overlapping keys such as Escape.

The inline thread composer uses the intermediate `thread-composer` layer. It suppresses thread navigation and message actions while keeping app commands available. A new-message composer or search overlay supersedes it.

Blocking operations, such as database import, and app-wide confirmation dialogs activate the highest-priority `blocking` layer. It suspends every product command while the modal owns the window; only commands in the reserved `always` scope remain active.

The fixed priorities are:

```ts
const LAYER_PRIORITY = {
  blocking: 1000,
  composer: 100,
  search: 100,
  thread: 20,
  "thread-composer": 50,
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

`MailComposer` owns the shared mail-editor surface: AI actions, draft history, the attachment picker and list, and their command registration. New-message and thread composers configure those optional parts while retaining only their distinct account, subject, context, and footer chrome.

Tiptap's StarterKit maps `Mod+Enter` to a hard break, while Kisa maps it to Send. `EmailComposer` can install a high-priority Tiptap extension that consumes the editor command without stopping DOM propagation. TanStack then handles Send at the document layer. `Mod+S` remains an application command while the composer layer is active, and `Shift+Enter` remains owned by Tiptap.

The same `Mod+Enter` guard is active in a thread draft. In that mode `Mod+Enter` sends, `Mod+Shift+A` opens the attachment picker, and `Escape` closes the editor and preserves the resumable draft. Discard remains an explicit button action.

In a reply or reply-all composer, `Mod+Shift+R` creates a reply from thread context while the editor is empty. `Mod+Shift+C` cleans the current reply. Forward composers expose cleanup but not reply generation. Both commands work while focus is inside the rich-text editor and are disabled while another composer operation is running.

## Validation

The pure registry validator normalizes bindings for macOS, Windows, and Linux. It rejects duplicate or sequence-prefix bindings in scopes that can be active together, while allowing the same binding in mutually exclusive layers.

Focused tests cover:

- Layer priority, restoration, and Strict Mode registration cycles
- Registry conflicts and platform formatting
- Account command coverage through the nine-account limit
- Tiptap's `Mod+Enter` guard
- Thread message selection, expansion, navigation edges, and restoration

Run the desktop checks with:

```sh
pnpm --dir apps/desktop test
pnpm --dir apps/desktop typecheck
```
