# Mail lists

The mailbox thread list, search results, and the Scheduled list are one Kisa primitive, `mail-list` in `renderer/src/primitives/mail-list.ts`, built from ui-sdk behaviors and rendered by `MailListRoot` in `mail-list-root.tsx`. A list holds tens of thousands of rows across several accounts, so it renders only the rows in view, and moving through it re-renders only the rows that change.

## Pattern

The list is a WAI-ARIA grid, after the Authoring Practices' data grid: read only, one row per conversation. A listbox doesn't fit, because its options can't hold controls, and each row holds a checkbox and quick actions. A grid also tells a screen reader to pass single letters such as J, K and X through to the app, which a list of buttons does not, and it carries each row's checked state as `aria-selected`.

```text
section  (the scroller and a ui-sdk scroll area's viewport, named after the place: "Inbox", "Search results", "Scheduled emails")
└── grid  aria-rowcount, aria-multiselectable in the mailbox
    └── row  aria-rowindex, aria-selected when checked
        ├── gridcell  the conversation
        │   ├── button  the open control, named by the row's label, aria-current while it has mailbox focus
        │   └── checkbox  "Select <subject>", in the mailbox only
        └── gridcell  the quick actions, Kisa Buttons and the Star toggle, named for their row
```

The quick actions stand behind the row in up to two columns of two: Mark as read or unread with Star (Not spam instead in Spam), then Archive, for a conversation in the Inbox, with Trash or Delete forever. Two actions share one column, and an action alone in its column fills it; the row slides aside by one 48-pixel step per column.

The scroller renders as the viewport of a `ScrollArea` from `@/components/ui/scroll-area`, so its scrollbar floats over the rows' trailing edge, macOS-style, and shows while the list scrolls, rather than taking a lane that would stop the edge-to-edge rows short. The bridge also lists that scroll area under the list's name, with no actions; naming the list still reaches the list.

In a list ordered newest first, the mailbox and searches without words, the first conversation of each day carries that day's heading ("Today", "Yesterday", a weekday for the week behind us, then a date), from `mail/thread-day-headings.ts`. The heading sits inside the row, above its cell, so rows stay the grid's only items and keys, focus and painting are untouched; it is `aria-hidden`, since a row holds only cells and its label already says the date. Only rendered rows compare their day with the row before them, so a long list costs nothing more. Results ranked by relevance get no headings.

The day in view is pinned at the top of the list. Rows are positioned absolutely, so a heading inside one can't stick past its own row; instead `PinnedDayHeading` (`components/mail/day-heading.tsx`) sits sticky in the scroller before the grid, taking no room, and on every scroll reads the rendered rows' `data-day`, `top` and height through `getPinnedDayHeading`. It shows the day of the first row still in view and moves up as the next day's heading arrives, so the two meet edge to edge; it moves itself, and React renders only when the day changes. It finds the scroller from where it sits, since the list's ref attaches after its first layout effect. A band draws its own top line a pixel above its row, over the row before's divider, which would vanish against the band's tint; the pinned band hides that line above the list, which therefore has no top fade.

Rows are positioned absolutely, so `aria-rowcount` and `aria-rowindex` say where a rendered row sits in the whole list. Scheduled reports `-1` while more pages may load. A trailing note, such as "Fetching the next chapter…" or a failed page with Try again, sits after the grid rather than in it.

## Focus

Mailbox focus, the conversation `J` and `K` move to, is DOM focus on that row's open control. It is the store's `selectedThreadId` (Scheduled keeps its own), which the list is controlled from and reports to through `onCurrentChange`; the row shows it with `aria-current` and its revealed checkbox and quick actions. Focusing a row's open control, by a click or a screen reader, makes it current.

- The grid is one tab stop: the current row's open control, or the first row rendered. In the mailbox and Scheduled layers `Tab` and `Shift+Tab` are themselves commands that move to the next or previous row, as they were before.
- `J`, `K`, `Tab` and `Shift+Tab` are `@/hotkeys` commands that call the list's controller. The vertical arrows are commands while focus is outside the list; inside it, `@/hotkeys` leaves them to the grid, as it does for any grid, so a press moves once. Both paths run the same move.
- A fresh move starts from the first row in view going down, or the last going up. Ordinary moves center the row smoothly; moves less than 150 ms apart scroll at once. The list scrolls itself and focuses with `preventScroll`, so focus never jumps the scroll.
- `ArrowRight` and `ArrowLeft` step from the open control to the row's quick actions and back, swapped in right-to-left layouts. With conversations checked, the quick actions are hidden and the arrows stay put.
- `Enter` or `Space` on the open control opens the conversation; while conversations are checked they do nothing, as the Enter command does. A click on a row while conversations are checked adds or removes it instead.
- `Escape` clears the checked rows and mailbox focus, and moves focus from a row to the list itself.
- When the current row leaves, as after `Mod+D`, mailbox focus moves to the row that takes its place, or to the row before it at the end (`item-removed`). Focus inside the row that left follows it there through `createFocusRecovery`.
- While a conversation is open over the mailbox, the list is `inert`, so focus left on a row can't keep the thread's arrow keys.

## Checked rows

The checked set is the store's `checkedThreadIds`; the list reports a whole new set through `onCheckedChange`, with `drag`, `shortcut`, `escape-key` or `item-removed` as the reason. `X` and an agent toggle a row through `createSelection`. Rows that leave the list leave the set.

Pressing and dragging across rows paints their checked state. A press on a row is followed by `bindDrag` with a 15-pixel `threshold`: it captures nothing until the pointer has moved 15 pixels along either axis from where it went down, so a press that lifts sooner stays a click, and painting starts in `onStart`; a press on a checkbox paints at once. The drag then follows the pointer, finds the row under it by hit testing, and scrolls with `createAutoScroll` (64 pixels from an edge, up to 18 pixels a frame), also while the pointer overshoots the list by up to 32 pixels. The rows between the press and the pointer take the painted state, the opposite of the pressed row's; every other row keeps what it had when the drag began, so moving back restores the rows crossed on the way. The click that ends a drag doesn't open the row. The paint commits once, as `onCheckedCommit`, and screen readers hear how many conversations are selected, as they do when Escape clears them.

## Virtualizing

`createVirtualizer` renders the rows in view and eight past each edge, estimated at 88 pixels (105 in Scheduled) and measured as they render. A row is measured by its key whenever it resizes, because its index moves as rows come and go above it; a row on its way out measures nothing. The current row stays rendered while scrolled away, so focus is never dropped.

- A row above the viewport that measures taller or shorter than estimated moves the scroll position with it, so the rows in view stay put; the virtualizer does this itself.
- When rows come or go above the first row in view, as new mail arrives at the top, the list keeps that row where it was by moving the scroll position after React has placed the rows. At the very top of the list it does not: new mail shows at the top, and the rows below move down.
- Reaching the last rows asks for the next page through the list's `onRowsRendered`, under the same rules as before: not while one is loading, and not after a failure until Try again.

Rows are memoized and keyed by `${accountId}:${threadId}` (Scheduled by account and draft), and each part hears only the state it reads through `selects`, so moving focus re-renders the two rows that gain or lose it.

## Motion

Rows fade in and out and the rows below slide into place with Motion: `AnimatePresence` and a `layout="position"` row rendered through the row part's `render` prop, in the mailbox, search results and Scheduled alike. ui-sdk leaves sliding items to CSS, View Transitions or a motion library, and a CSS transform transition would also animate the scroll anchoring above, which Motion's measured layout doesn't. A row is placed with `top`, since Motion's layout animation owns its `transform`. A Scheduled row leaves only once main has canceled or discarded it, so while it fades out it is `inert`, and a second press can't ask again. The reveal of a row's checkbox and quick actions, and the selection bar's entrance, stay Motion animations too; `.reduce-animations` and the system setting turn them off through `MotionConfig`.

## Agents

The list is one component in the agent bridge, named after its place. Its actions are `open` and, in the mailbox, `toggle`; both take a row's key or its subject, and the bridge refuses a subject two rows share. An agent's `open` always opens. Each row's controls carry the row's name ("Select Lunch", "Mark Lunch as unread", "Star Lunch", "Archive Lunch", "Trash Lunch"), with the account added when the view mixes accounts. Trash, in a row and in the selection bar, and Report spam, in the selection bar and a conversation's titlebar, carry `data-agent-confirm`; Delete forever asks through `useConfirm`, whose confirming button carries it instead.

## Tests

The list has no automated tests: Kisa's suite covers the mail engine, the store, credentials and message privacy, not the renderer. Check keys, presses, drags, focus recovery, the selection bar, paging, scroll anchoring and a long list by hand in the running app.
