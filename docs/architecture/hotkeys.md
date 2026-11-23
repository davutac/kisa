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

- App navigation, search, templates, Scheduled, and message composition
- Mailbox focus and multi-selection, thread opening, read-state toggling, and trashing
- Closing the active thread and acting on the conversation being read
- Selecting messages within a conversation and replying to or forwarding the selected message
- Selecting the composer account, attaching files, stashing a draft, and sending a message
- Creating, searching, and explicitly saving templates

Focused widgets retain their native keyboard behavior. Recipient completion, the search bar, dialogs, and the rich-text editor continue to own keys such as arrows, Enter, Escape, and editing shortcuts while focused. The sidebar's resize handle takes the Left and Right arrows, Home, and End while focused to resize the sidebar; no application command binds them.

Application renderer code should not import `@tanstack/react-hotkeys` outside `@/hotkeys` and the root provider setup.

## Command registry

`commands.ts` defines every application command with:

- One or more platform-neutral bindings
- A user-facing label
- Its interaction scope
- Whether it works inside text inputs
- Whether holding the key may repeat the command
- Optionally, whether to skip a key a focused widget already handled with `preventDefault()`; the new-email composer's `Escape` uses it so closing the editor's slash menu does not also close the composer

Callers register a command with its callback:

```tsx
useAppCommand("mailbox.nextThread", () => moveSelection(1), {
  enabled: threads.length > 0,
});
```

The hook expands alternative bindings and unregisters inactive commands. It intentionally exposes only `enabled` and an optional element target; callers cannot override registry policy. Without a target, the registration omits TanStack's `target` option entirely and listens on the document. A present but unset target registers nothing until its element mounts.

Reversible state toggles use `ignore-key-repeat`: each distinct keydown is accepted without depending on a later keyup, while operating-system repeats from holding the key are ignored. One-way commands may use `once` when suppressing another invocation until the chord is released is part of the interaction.

Dynamic lists use the renderless `AppCommand` component, which delegates to the same hook without calling hooks inside a loop.

Account commands are static and follow sidebar order. `Mod+1` opens All accounts and `Mod+2` through `Mod+9` open the first eight accounts. The composer picks its From account with the same `Mod+2` through `Mod+9`, so an account keeps one number everywhere; `Mod+1` does nothing there, because mail is never sent from All accounts. Both work inside text fields. Additional accounts remain available through the sidebar's account rows and the composer picker without a numbered shortcut.

In the new-email composer, `Mod+S` stashes a non-empty draft, resets the form, and keeps the composer open. On a blank form, it opens the stash picker when saved stashes are available. The command can be pressed again without releasing `Mod`, while operating-system key repeat from holding `S` is ignored. The same command definition drives the Stash button hint and ARIA metadata.

`U` toggles the unread-only mailbox filter, the same as the toggle beside sidebar search; the shell registers it, so from a workspace it also returns to the mailbox. The filter is remembered: switching accounts or mailboxes and restarting keep it until it is toggled off. `Shift+S` toggles Sent, `S` toggles Spam, and `T` toggles Trash. These shortcuts act on the current account scope. In the sidebar, All accounts opens the combined Inbox and has no rows of its own, so in that scope these shortcuts are the way to its Sent, Spam, and Trash; each account opens its Inbox and discloses its own Sent, Spam, and Trash rows. The hints and `aria-keyshortcuts` for these shortcuts sit only on the current scope's rows, the rows the shortcuts open, when those rows are shown. Rows and shortcuts share one resolver: choosing the mailbox or label and scope already on screen returns to that scope's Inbox, while choosing it from another scope or from a workspace such as Settings opens it. Labels have no shortcuts of their own; they are sidebar places like any other, and Go back and Go forward step through them. `Mod+1` through `Mod+9` open the matching scope's Inbox, the same as choosing its account row.

`Mod+\` shows or hides the main window's sidebar. It works inside text fields and the rich-text editor, which leave `Mod+B` to bold. The shell, not the sidebar, registers every navigation command the sidebar advertises, so the shortcuts keep working while the sidebar is hidden. `Mod+K` opens the search command bar from anywhere, without revealing a hidden sidebar; showing all results reveals it, and hiding the sidebar ends the results in the list. `Mod+[` and `Mod+]` go back and forward through the sidebar places visited, the same as the arrows beside the app name. They are ignored in text fields and the rich-text editor, and they are inactive while the composer or the search bar is open.

`Mod+Z` runs the latest application Undo while its eight-second toast is available. The command ignores text inputs and rich-text editors, where native editing history continues to own the same shortcut.

`J`, `K`, and the arrow keys move mailbox focus. When the focused conversation leaves the list, such as when `Mod+D` trashes it, focus moves to the row that takes its place, or to the row before it at the end of the list, so `Mod+D` and `Mod+Shift+U` can work down a mailbox. `X` adds or removes the focused conversation from the bulk selection. A revealed row checkbox provides the same action with the mouse. Pressing and dragging anywhere across a conversation row paints that row's checked or unchecked state across every row crossed; reversing the drag restores the rows crossed on the way back. A 15-pixel movement tolerance keeps ordinary clicks opening the conversation. `Escape` clears both bulk selection and mailbox focus.

`Mod+Shift+S` toggles the Scheduled workspace while its sidebar row is shown. The workspace mirrors mailbox row navigation without bulk selection: `Tab`, `ArrowDown`, or `J` moves to the next scheduled email; `Shift+Tab`, `ArrowUp`, or `K` moves to the previous one; and `Enter` opens the focused item. `Mod+S` cancels the focused schedule and moves its draft to Stash, matching the composer's stash/save shortcut. `Mod+D` opens the permanent-discard confirmation, matching the mailbox destructive-action shortcut. These actions target keyboard focus, not a hover-only row. A fresh move starts from the first or last visible row. Ordinary moves center smoothly, while rapid repeated moves switch to instant scrolling to stay responsive. `Escape` clears the active row, collapses its quick actions, and returns focus to the Scheduled list. Scheduled does not register `X` or render selection checkboxes.

While the search command bar is open, its `search` layer silences every application command. The arrow keys move through its suggestions and `Enter` chooses one. Show all results comes first, so `Enter` after typing fills the mailbox list, while a filter being typed puts its completions first so `Enter` adds the pill. Once results fill the mailbox list, the ordinary mailbox bindings move through them, and `Enter` opens the selected conversation.

When conversations are checked, Apple Mail-style `Mod+Shift+U` applies to the full selection: it marks the selection unread only when every selected conversation is currently read; otherwise it marks the selection read. `Mod+D` moves the selection to trash, or opens the permanent-delete confirmation in Spam and Trash. Without a bulk selection these commands continue to target the focused conversation. Mixed selections spanning ordinary and permanently deletable search results do not expose a destructive bulk action. These commands are not registered for hover-only quick actions.

The floating selection toolbar exposes explicit mark-read and mark-unread actions. `Mod+L` opens its label dropdown while a bulk selection exists. The dropdown groups selected conversations by account because Gmail label ids are account-owned; toggling a label only changes selected conversations in that account group.

While reading a conversation in the main window, `Mod+Enter` opens it in a thread window and closes the inline conversation. The command is disabled inside the resulting thread window because it is already popped out. Once a thread composer is open, its higher-priority layer owns `Mod+Enter` for sending instead.

While reading a conversation, `Mod+L` scrolls the label row into view and opens its picker. `Mod+Shift+U` and `Mod+D` retain the same read-state and mailbox-context behavior as they have on the selected mailbox conversation.

Within a conversation, `J` or `ArrowDown` selects and opens the next newer message, while `K` or `ArrowUp` selects and opens the previous older message. Navigation stops at the thread edges and closes the previously expanded message. Plain `Tab` remains native so headers, links, attachments, and footer actions stay keyboard-accessible.

`R` replies to the selected message, `Shift+R` replies to everyone on it, and `F` forwards it. Reply all is available only when the selected message has at least two distinct non-self reply targets across its sender, To, and Cc fields; otherwise its footer button is omitted and `Shift+R` is inactive. Bcc recipients never count toward reply all. A draft captures that message as its immutable target. When a saved draft is resumed, its target becomes the selected message again. The footer buttons derive their shortcut labels and ARIA metadata from these commands.

`Mod+N` opens the new-email page, `/compose`, with its title and its Stash, stash picker, Send, and Schedule actions in the content titlebar. `Escape` closes it and returns to the view it was opened over: a non-empty draft goes to the stash first, as it does when any other navigation leaves the page. `Mod+D` discards it instead, confirming first when it has content, matching the destructive shortcut in the mailbox and Scheduled. Escape in a menu or picker portaled out of the composer closes only that popup. While the composer is open, its layer keeps app shortcuts off, so `Mod+2` through `Mod+9` choose the From account rather than opening an account.

`Mod+Shift+A` opens the attachment picker while composing a new email, reply, reply-all, or forward.

In the new-email composer, `Mod+Shift+Enter` opens Schedule send. Once a delivery time is selected, the same command schedules or reschedules the email. `Mod+Enter` remains Send now. While editing an existing scheduled email, which opens as a page over Scheduled with the `composer` layer above the `scheduled` one, `Mod+D` opens its permanent-discard confirmation and `Mod+S` saves changed content without closing the editor; the list's Cancel schedule and Discard bindings stay inactive until `Escape` returns to it.

`Mod+Shift+C` cleans up the current new-email draft using the provider and model shown in the Clean button tooltip. The command remains available while focus is in the subject or message editor and is disabled for an empty draft or while another compose action is running.

`Mod+,`, `Mod+Shift+S`, and `Mod+Shift+T` toggle Settings, Scheduled, and Templates. Pressing the active workspace's shortcut, or choosing its sidebar row again, restores the previous view. The Scheduled command is registered only while scheduled mail exists or the workspace is already open. In the Templates workspace, `Mod+Shift+N` creates a template, `Mod+F` focuses template search, and `Mod+S` explicitly saves the active template. `Mod+Shift+]` and `Mod+Shift+[` select the next and previous filtered template, stopping at the list edges. The modified bracket pair remains available inside form fields and the rich-text editor without taking over ordinary `Tab` navigation or the operating system's app switcher.

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
| `scheduled`       | `always`, `app`, `scheduled`       |
| `thread`          | `always`, `app`, `thread`          |
| `thread-composer` | `always`, `app`, `thread-composer` |
| `settings`        | `always`, `app`, `settings`        |
| `templates`       | `always`, `app`, `templates`       |
| `composer`        | `always`, `composer`               |
| `search`          | `always`, `search`                 |
| `blocking`        | `always`                           |

The composer and the open search bar suppress every underlying application command. Closing the search bar or removing an overlay registration restores the layer beneath it, so only the top interaction handles overlapping keys such as Escape.

The inline thread composer uses the intermediate `thread-composer` layer. It suppresses thread navigation and message actions while keeping app commands available. A new-message composer or focused inline search field supersedes it.

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
  scheduled: 10,
  settings: 10,
  templates: 10,
} as const;
```

Equal-priority layers use activation order.

## Display and accessibility

Holding `Mod` by itself (`⌘` on macOS, `Ctrl` on Windows and Linux) for 400 milliseconds reveals the shortcut of every sidebar row whose bindings all start from `Mod`, in place of the row's trailing chevron, unread dot, or count; releasing `Mod` hides them. Plain-key shortcuts such as `S` stay in tooltips, because a hint read under a held `Mod` is pressed with it, and `Mod+S` is a different command. Pressing another key first cancels the reveal, so ordinary chords such as `Mod+C` never flash it. Once shown, the hints stay while `Mod` is held, so `Mod+2` then `Mod+3` can hop between accounts under one hold. They show only while the `app` scope is active, because the composer and other higher layers give the same keys other meanings. `useHotkeyHintsRevealed` reads TanStack's held-key tracker through a primitive snapshot, so typing elsewhere re-renders nothing; the sidebar marks itself with `data-hotkey-hints`, and its rows swap their trailing content for the hint in CSS. Icon-only buttons, such as New email, the Unread filter, Settings, and Templates, keep their shortcuts in tooltips.

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
- Account command coverage: All accounts and eight accounts, with each account's number shared by the sidebar and the composer
- Tiptap's `Mod+Enter` guard
- Thread message selection, expansion, navigation edges, and restoration

Run the desktop checks with:

```sh
pnpm --dir apps/desktop test
pnpm --dir apps/desktop typecheck
```
