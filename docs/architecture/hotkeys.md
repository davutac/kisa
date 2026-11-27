# Hotkeys

Kisa keeps application-level shortcuts behind the `@/hotkeys` renderer module. Components register typed command IDs rather than registering ui-sdk shortcuts directly, so the same registry drives behavior, labels, visual hints, ARIA metadata, input handling, and repeat behavior. `@/hotkeys` registers each active command in ui-sdk's shared `shortcuts` (`@ui-sdk/core/shortcuts`), which listens for `keydown` on the document.

```text
command registry ──> useAppCommand ──> ui-sdk shortcuts ──> keyboard events
       │                    ▲
       ├──> HotkeyHint      │
       ├──> ARIA labels     │
       └──> validation   active layer
```

## Ownership

The hotkey module owns commands that apply to an application screen or interaction mode:

- App navigation, search, templates, Scheduled, and message composition
- Mailbox focus and multi-selection, thread opening, read-state toggling, archiving, starring, reporting spam, and trashing
- Closing the active thread and acting on the conversation being read
- Selecting messages within a conversation and replying to or forwarding the selected message
- Selecting the composer account, attaching files, stashing a draft, and sending a message
- Creating, searching, and explicitly saving templates

Focused widgets retain their native keyboard behavior. Recipient suggestions, the search bar, dialogs, and the rich-text editor continue to own keys such as arrows, Enter, Escape, and editing shortcuts while focused. The sidebar's resize handle takes the Left and Right arrows, Home, and End while focused to resize the sidebar, and Escape while it is dragged to put the width back; no application command binds them. Each account's icon in the sidebar is a reorder handle: while focused, Space or Enter picks the account up, and while it is held the arrow keys, Home, and End move it, Space or Enter drops it, and Escape or Tab puts it back. The search bar and the stash and variable pickers close on the first `Escape`, even with text typed, rather than clearing their search first. The notifications region takes `F6`, ui-sdk's key for moving focus to the newest toast and back, so the keyboard reaches a toast's Undo button; Escape on a focused toast dismisses only that toast. No application command binds `F6`.

Application renderer code should not register keys through ui-sdk outside `@/hotkeys`: no `registerShortcut` or `useShortcut`, and no `shortcut` prop on a ui-sdk trigger.

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

The hook registers every binding while the command's scope is active and `enabled` is true, and unregisters it otherwise. It intentionally exposes only `enabled`, an optional element target, and an optional layer; callers cannot override registry policy. Without a target, a command takes key presses anywhere in the window. A target limits it to key presses while focus is inside that element, so a present but unset target takes none. A layer is an element inside a ui-sdk popup that the command belongs to: ui-sdk then runs it while that popup is open, where a modal would pause a page command. Settings' search shortcut is the one command that uses it.

ui-sdk runs a shortcut after the focused element's own key handlers, and calls `preventDefault()` but not `stopPropagation()` when it runs one. Every command skips a key that a focused widget already handled with `preventDefault()`, such as Escape closing the editor's slash menu or a recipient field's suggestions. While a ui-sdk modal is open (a Dialog or AlertDialog), ui-sdk pauses every command too, including under modals that register no Kisa layer, such as Pick date and time, the template variable picker, Settings, and the dialogs Settings opens. An open menu or popover takes Escape before any command: Escape closes it, and no command runs. A tooltip doesn't: Kisa's tooltips open as soon as the pointer rests on a button, so Escape closes a visible tooltip and still reaches the command, such as closing the conversation or clearing the selection.

`input: "allow"` commands run while focus is in a text field or the rich-text editor. `input: "ignore"` commands don't: a text field or contenteditable keeps every key, chords included, and a focused control keeps the plain keys it handles itself, after the WAI-ARIA keyboard patterns: Enter on a button or link, and the vertical arrows and typeahead letters in a menu, listbox, combobox, or tree. ui-sdk runs Command, Control, and Option chords in text fields whatever its `allowInInput` says, so `@/hotkeys` checks the focused element itself; that is what leaves `Mod+Z` to native text undo.

`once` and `ignore-key-repeat` run once for each distinct keydown, without depending on a later keyup, and ignore the operating system's repeats while the key is held, as ui-sdk's shortcuts do by default. They behave the same; `once` marks one-way commands. A press that activates another command, such as `Escape` closing a thread, doesn't hand that command the held key's repeats. `allow` runs on every repeat, for moving through lists.

Dynamic lists use the renderless `AppCommand` component, which delegates to the same hook without calling hooks inside a loop.

Account commands are static and follow sidebar order. `Mod+1` opens All accounts and `Mod+2` through `Mod+9` open the first eight accounts. The composer picks its From account with the same `Mod+2` through `Mod+9`, so an account keeps one number everywhere; `Mod+1` does nothing there, because mail is never sent from All accounts. Both work inside text fields. Additional accounts remain available through the sidebar's account rows and the composer picker without a numbered shortcut.

In the new-email composer, `Mod+S` stashes a non-empty draft, resets the form, and keeps the composer open. On a blank form, it opens the stash picker when saved stashes are available. The command can be pressed again without releasing `Mod`, while operating-system key repeat from holding `S` is ignored. The same command definition drives the Stash button hint and ARIA metadata.

`U` toggles the unread-only mailbox filter, the same as the toggle beside sidebar search; the shell registers it, so from a workspace it also returns to the mailbox. The filter is remembered: switching accounts or mailboxes and restarting keep it until it is toggled off. `Shift+S` toggles Sent, `S` toggles Spam, and `T` toggles Trash. These shortcuts act on the current account scope. In the sidebar, All accounts opens the combined Inbox and has no rows of its own, so in that scope these shortcuts are the way to its Sent, Spam, and Trash; each account opens its Inbox and discloses its own Starred, Sent, Spam, and Trash rows. Starred has no shortcut; in All accounts, starred mail is found with an `is:starred` search. The hints and `aria-keyshortcuts` for these shortcuts sit only on the current scope's rows, the rows the shortcuts open, when those rows are shown. Rows and shortcuts share one resolver: choosing the mailbox or label and scope already on screen returns to that scope's Inbox, while choosing it from another scope or from a workspace such as Templates opens it. Labels have no shortcuts of their own; they are sidebar places like any other, and Go back and Go forward step through them. `Mod+1` through `Mod+9` open the matching scope's Inbox, the same as choosing its account row.

`Mod+\` shows or hides the main window's sidebar. It works inside text fields and the rich-text editor, which leave `Mod+B` to bold. The shell, not the sidebar, registers every navigation command the sidebar advertises, so the shortcuts keep working while the sidebar is hidden. `Mod+K` opens the search command bar from anywhere, without revealing a hidden sidebar; showing all results reveals it, and hiding the sidebar ends the results in the list. `Mod+[` and `Mod+]` go back and forward through the sidebar places visited, the same as the arrows beside the app name. They are ignored in text fields and the rich-text editor, and they are inactive while the composer or the search bar is open.

`Mod+Z` runs the latest application Undo while its toast is available: eight seconds, or for a sent message as long as Undo send holds it. The command ignores text inputs and rich-text editors, where native editing history continues to own the same shortcut.

`J`, `K`, `Tab`, `Shift+Tab`, and the arrow keys move mailbox focus, which is keyboard focus on the conversation's row: the list is a grid (see [Mail lists](mail-list.md)), and its open control for the row takes focus, so `Enter` or `Space` opens it. Inside the list the grid handles the vertical arrows itself, as `@/hotkeys` leaves them to any grid, so one press moves one row; outside it they are the same commands as `J` and `K`. `ArrowRight` and `ArrowLeft` step from a row to its quick actions and back, swapped in right-to-left layouts. When the focused conversation leaves the list, such as when `E` archives it or `Mod+D` trashes it, focus moves to the row that takes its place, or to the row before it at the end of the list, so `E`, `Mod+D` and `Mod+Shift+U` can work down a mailbox. `X` adds or removes the focused conversation from the bulk selection. A revealed row checkbox provides the same action with the mouse, or with `Space` while it has focus. While conversations are checked, a click on a row adds or removes it, and `Enter` opens nothing. Pressing and dragging anywhere across a conversation row paints that row's checked or unchecked state across every row crossed; reversing the drag restores the rows crossed on the way back. A 15-pixel movement tolerance keeps ordinary clicks opening the conversation; pressing a row's checkbox paints at once. `Escape` clears both bulk selection and mailbox focus, and moves focus from a row to the list itself. While a conversation is open over the mailbox, the list is inert, so the conversation's own arrow keys and `Enter` reach it.

`Mod+Shift+S` toggles the Scheduled workspace while its sidebar row is shown. The workspace mirrors mailbox row navigation without bulk selection: `Tab`, `ArrowDown`, or `J` moves to the next scheduled email; `Shift+Tab`, `ArrowUp`, or `K` moves to the previous one; and `Enter` opens the focused item. `Mod+S` cancels the focused schedule and moves its draft to Stash, matching the composer's stash/save shortcut. `Mod+D` opens the permanent-discard confirmation, matching the mailbox destructive-action shortcut. These actions target keyboard focus, not a hover-only row. A fresh move starts from the first or last visible row. Ordinary moves center smoothly, while rapid repeated moves switch to instant scrolling to stay responsive. Scheduled is the same grid as the mailbox, so the arrow keys inside it, `ArrowRight` to the row's Cancel schedule and Discard and `ArrowLeft` back, and `Space` on a row behave as they do there. `Escape` clears the active row, collapses its quick actions, and returns focus to the Scheduled list. Scheduled does not register `X` or render selection checkboxes.

While the search command bar is open, its `search` layer silences every application command. The arrow keys move through its suggestions and `Enter` chooses one. Show all results comes first, so `Enter` after typing fills the mailbox list, while a filter being typed puts its completions first so `Enter` adds the pill. Once results fill the mailbox list, the ordinary mailbox bindings move through them, and `Enter` opens the selected conversation.

When conversations are checked, Apple Mail-style `Mod+Shift+U` applies to the full selection: it marks the selection unread only when every selected conversation is currently read; otherwise it marks the selection read. `Mod+D` moves the selection to trash, or opens the permanent-delete confirmation in Spam and Trash. Without a bulk selection these commands continue to target the focused conversation. Mixed selections spanning ordinary and permanently deletable search results do not expose a destructive bulk action. These commands are not registered for hover-only quick actions.

`E` archives the focused conversation, or the checked ones that are in the Inbox, so Undo returns only what left it; it does nothing on a conversation outside the Inbox. `Mod+Shift+L`, Apple Mail's Flag, toggles the focused conversation's star; on a selection it stars every one unless all already have a star, and then removes them. `Mod+Shift+J`, Apple Mail's Junk, reports the focused conversation as spam, or a selection with none in Spam or Trash. Star and Report spam don't apply in Spam and Trash. The selection toolbar offers the same three, with their keys in their tooltips.

The floating selection toolbar exposes explicit mark-read and mark-unread actions. `Mod+L` opens its label dropdown while a bulk selection exists. The dropdown groups selected conversations by account because Gmail label ids are account-owned; toggling a label only changes selected conversations in that account group.

While reading a conversation in the main window, `Mod+Enter` opens it in a thread window and closes the inline conversation. The command is disabled inside the resulting thread window because it is already popped out. Once a thread composer is open, its higher-priority layer owns `Mod+Enter` for sending instead.

While reading a conversation, `E` archives it and closes it, as its Archive button does; once a message someone else sent has left the Inbox, the button reads Move to Inbox and `E` brings the conversation back instead, leaving it open. `Mod+Shift+L` toggles its star, and `Mod+Shift+J` reports it as spam and closes it, offered only while the conversation holds a message someone else sent. While reading a conversation, `Mod+L` scrolls the label row into view and opens its picker. `Mod+Shift+U` and `Mod+D` retain the same read-state and mailbox-context behavior as they have on the selected mailbox conversation.

Within a conversation, `J` or `ArrowDown` selects and opens the next newer message, while `K` or `ArrowUp` selects and opens the previous older message. Navigation stops at the thread edges and leaves the other messages open or closed as they were. Plain `Tab` remains native so headers, links, attachments, and footer actions stay keyboard-accessible.

`R` replies to the selected message, `Shift+R` replies to everyone on it, and `F` forwards it. Reply all is available only when the selected message has at least two distinct non-self reply targets across its sender, To, and Cc fields; otherwise its footer button is omitted and `Shift+R` is inactive. Bcc recipients never count toward reply all. A draft captures that message as its immutable target. When a saved draft is resumed, its target becomes the selected message again. The footer buttons derive their shortcut labels and ARIA metadata from these commands.

`Mod+N` opens the new-email page, `/compose`, with its title and its Stash, stash picker, Send, and Schedule actions in the content titlebar. `Escape` closes it and returns to the view it was opened over: a non-empty draft goes to the stash first, as it does when any other navigation leaves the page. `Mod+D` discards it instead, confirming first when it has content, matching the destructive shortcut in the mailbox and Scheduled. In the stash picker, `Mod+D` instead discards the highlighted stash, after the same confirmation as its Discard button; the picker handles the key, so the draft on the page stays. The picker's footer shows the key, and the search field is described by it. Its Discard buttons stay out of the Tab order, for the pointer and agents. Escape in a menu or picker portaled out of the composer closes only that popup. While the composer is open, its layer keeps app shortcuts off, so `Mod+2` through `Mod+9` choose the From account rather than opening an account.

`Mod+Shift+A` opens the attachment picker while composing a new email, reply, reply-all, or forward.

In the new-email composer, `Mod+Shift+Enter` opens Schedule send. Once a delivery time is selected, the same command schedules or reschedules the email. `Mod+Enter` remains Send now. While editing an existing scheduled email, which opens as a page over Scheduled with the `composer` layer above the `scheduled` one, `Mod+D` opens its permanent-discard confirmation and `Mod+S` saves changed content without closing the editor; the list's Cancel schedule and Discard bindings stay inactive until `Escape` returns to it.

`Mod+Shift+C` cleans up the current new-email draft using the provider and model shown in the Clean button tooltip. The command remains available while focus is in the subject or message editor and is disabled for an empty draft or while another compose action is running.

`Mod+Shift+S` and `Mod+Shift+T` toggle Scheduled and Templates. Pressing the active workspace's shortcut, or choosing its sidebar row again, restores the previous view. `Mod+,` opens Settings, a modal dialog over the window, like the sidebar's Settings button. It only opens: ui-sdk pauses every application command while a modal is open, `Mod+,` included, so Escape or the dialog's Close button closes it, and focus returns to where it was. A toggle would need the command registered with a `layer` inside the dialog, as Settings' search is, not a key handler on its content. Inside Settings, `/` moves focus to its search, from anywhere in the dialog but a text field, where `/` is typed; `Shift+/` does the same, for layouts such as German that type `/` with Shift. A dialog Settings opens, such as Reply instructions, keeps `/` to itself. In the search, the arrow keys move through the results, Enter leads to the highlighted one, and Escape clears the search, then closes Settings once it is empty. The Scheduled command is registered only while scheduled mail exists or the workspace is already open. In the Templates workspace, `Mod+Shift+N` creates a template, `Mod+F` focuses template search, and `Mod+S` explicitly saves the active template. `Mod+Shift+]` and `Mod+Shift+[` select the next and previous filtered template, stopping at the list edges. The modified bracket pair remains available inside form fields and the rich-text editor without taking over ordinary `Tab` navigation or the operating system's app switcher.

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
| `templates`       | `always`, `app`, `templates`       |
| `composer`        | `always`, `composer`               |
| `search`          | `always`, `search`                 |
| `settings`        | `always`, `settings`               |
| `blocking`        | `always`                           |

The composer, the open search bar, and the open Settings dialog suppress every underlying application command. Settings ranks above the composer because it can open over a new email. Closing the search bar or removing an overlay registration restores the layer beneath it, so only the top interaction handles overlapping keys such as Escape.

The inline thread composer uses the intermediate `thread-composer` layer. It suppresses thread navigation and message actions while keeping app commands available. A new-message composer or focused inline search field supersedes it.

Blocking operations, such as database import, and app-wide confirmation dialogs activate the highest-priority `blocking` layer. It suspends every product command while the modal owns the window; only commands in the reserved `always` scope remain active. No command uses `always` today; one would also need a ui-sdk `layer` to run while a ui-sdk modal is open.

The fixed priorities are:

```ts
const LAYER_PRIORITY = {
  blocking: 1000,
  settings: 200,
  composer: 100,
  search: 100,
  thread: 20,
  "thread-composer": 50,
  mailbox: 10,
  scheduled: 10,
  templates: 10,
} as const;
```

Equal-priority layers use activation order.

## Display and accessibility

Holding `Mod` by itself (`⌘` on macOS, `Ctrl` on Windows and Linux) for 400 milliseconds reveals the shortcut of every sidebar row whose bindings all start from `Mod`, in place of the row's trailing chevron or count; releasing `Mod` hides them. Plain-key shortcuts such as `S` stay in tooltips, because a hint read under a held `Mod` is pressed with it, and `Mod+S` is a different command. Pressing another key first cancels the reveal, so ordinary chords such as `Mod+C` never flash it. Once shown, the hints stay while `Mod` is held, so `Mod+2` then `Mod+3` can hop between accounts under one hold. They show only while the `app` scope is active, because the composer and other higher layers give the same keys other meanings. `useHotkeyHintsRevealed` follows the keys held in the window from its own `keydown` and `keyup` listeners, which run only while something reads the hints and forget every key when the window loses focus or is hidden; macOS sends no `keyup` for a key released while `⌘` is down, so releasing `⌘` forgets the others. It reads them through a primitive snapshot, so typing elsewhere re-renders nothing; the sidebar marks itself with `data-hotkey-hints`, and its rows swap their trailing content for the hint in CSS. Icon-only buttons, such as New email, the Unread filter, Settings, and Templates, keep their shortcuts in tooltips.

`HotkeyHint` and `getHotkeyDisplay` format bindings with ui-sdk's `formatShortcut`: symbols such as `⇧⌘U`, `⌘↩`, and `⎋` on Apple platforms, with `⇧` before `⌘` as macOS menus list them, and names such as `Ctrl+Shift+U` and `Esc` on Windows and Linux. ui-sdk wraps each in invisible left-to-right isolate characters so a right-to-left layout keeps the order. `getHotkeyAriaLabel` uses ui-sdk's `ariaKeyshortcuts`, which resolves the registry's `Mod` notation to the ARIA modifier names `Meta` or `Control`. Both read the platform from ui-sdk, which tests set with `setPlatform` from `@ui-sdk/core/testing`.

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

The formatting toolbar under the editor and the draft-history strip above it are one tab stop each: the Left and Right arrows, Home, and End move between their buttons, and Enter or Space presses one. A draft version is chosen by that press, not by the arrows, because choosing one rewrites the draft. In a recipient field, suggestions match loosely: a prefix of the address or its owner's name ranks first, then a word inside either, then the text anywhere, then only its letters in order, so `dt@` finds `dana.t@example.com`; within each rank, addresses mailed more often come first. The highlighted suggestion is shown dimmed after the typed text, with a Tab key cap, and Tab or a click on it in the list takes it. When what was typed is already a whole address with a domain that the suggestion does not merely complete, no suggestion is shown there: Enter adds what was typed, and Tab leaves the field, adding it too, so `ann@corp.com` never becomes `joann@corp.com` unasked. Otherwise Enter also takes the highlighted suggestion. Without a suggestion, Enter, a comma, a semicolon, or a space adds what was typed, and Enter never submits the form around it. Escape closes the suggestions and keeps what was typed; the next Escape reaches the composer.

In the new-email Body, `/` at the start of a paragraph or after a space or line break opens the template menu. The arrows move through it, Enter or Tab inserts, and Escape closes only the menu and dismisses that `/`, so typing on after it keeps the menu closed. Unlike other popups, the template menu doesn't take Escape before the commands: its layer sees the key only after `@/hotkeys` does. So the editor closes the menu from its own key handling and marks the key handled, which every command skips.

Tiptap's StarterKit maps `Mod+Enter` to a hard break, while Kisa maps it to Send. A key ProseMirror handles is default-prevented, which every command skips, so `EmailComposer` can install a high-priority Tiptap extension that keeps `Mod+Enter` from ProseMirror's keymaps without preventing it; Send then runs from `@/hotkeys`. When nothing sends, the extension cancels the line break the browser would type instead. `Mod+S` remains an application command while the composer layer is active, and `Shift+Enter` remains owned by Tiptap. In a recipient field, `Mod+Enter` adds what Enter would, and still sends. StarterKit's strikethrough owns `Mod+Shift+S` while the reply or template editor has focus, so Scheduled doesn't open from there.

The same `Mod+Enter` guard is active in a thread draft. In that mode `Mod+Enter` sends, `Mod+Shift+A` opens the attachment picker, and `Escape` closes the editor and preserves the resumable draft. Discard remains an explicit button action.

In a reply or reply-all composer, `Mod+Shift+R` creates a reply from thread context while the editor is empty. `Mod+Shift+C` cleans the current reply. Forward composers expose cleanup but not reply generation. Both commands work while focus is inside the rich-text editor and are disabled while another composer operation is running.

## Validation

Each registry binding becomes ui-sdk keys in one place, `toShortcutKeys`: `Mod+Shift+U` registers `mod+shift+u`. ui-sdk matches punctuation by the character typed, so a shifted bracket also registers the character Shift types on a US layout: `Mod+Shift+]` registers `mod+shift+]` and `mod+shift+}`. The pure registry validator resolves those keys for macOS, Windows, and Linux. It rejects bindings that press the same keys in scopes that can be active together, while allowing the same binding in mutually exclusive layers, and it rejects key sequences, which ui-sdk shortcuts don't support. ui-sdk also warns in development when two unguarded shortcuts share keys.

Hotkeys have no automated tests: Kisa's suite covers the mail engine, not the renderer. Instead the renderer runs the registry validator when it starts in development and refuses to start while any binding is invalid or collides.

Run the desktop checks with:

```sh
bun run --cwd apps/desktop test
bun run --cwd apps/desktop typecheck
```
