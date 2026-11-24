# Undoable actions

Kisa offers one level of application Undo for selected mail mutations. Thread actions show as done before the server answers (see [Desktop](desktop.md#optimistic-thread-actions)), so the latest undoable action's toast appears with the action itself, for eight seconds, and can be reversed from its Undo button or with `Mod+Z`. Text inputs and mail editors keep their native local Undo history; the application command is ignored while they have focus.

The renderer owns only the short-lived opportunity to Undo. The mail server and the account-scoped cache still perform both the original mutation and its inverse through the normal typed IPC and mail synchronization path. The server's answer then amends the offer: a refused action withdraws its Undo and turns the toast into the error, and a partly refused bulk action keeps Undo with the failure described. Undo is available before that answer: the conversations show as restored at once, and the inverse waits for the answer, then reverses only the conversations that changed, so an action the server refused never gets an inverse. Starting an inverse clears the Undo opportunity immediately, so double clicks and repeated shortcuts cannot run it twice; its own toast appears at once and becomes the error if the inverse fails.

## Actions with Undo

| Action | Inverse |
| --- | --- |
| Add or remove a user label | Restore the previous label membership |
| Archive | Add the conversation back to Inbox |
| Move to Trash | Remove Trash and restore the Inbox; outside Gmail the user's own replies and drafts return to Sent and Drafts |
| Report spam | Move the conversation back to Inbox |
| Mark as not spam | Move the conversation back to Spam |
| Send, with Undo send on | Take the message back before it leaves, and open its draft again |

Single and bulk interaction paths use the same renderer module. Bulk label changes omit conversations already in the requested state, making the inverse exact for mixed selections; bulk Archive likewise sends only the selected conversations in the Inbox, so its Undo returns nothing that was not there. Report spam's Undo, like Not spam, puts what it moved into the Inbox even if the conversation was archived before; the user's own sent mail and drafts never move to Spam, so they stay in Sent and Drafts throughout, and a selected conversation of only the user's own mail is refused alone, counted in the toast among those that could not be updated. Trash's Undo returns received mail to the Inbox the same way. On iCloud and other IMAP servers a copy in Trash no longer says where it was, so main remembers, while Trash moves them, which Sent or Drafts mailbox the user's own copies came from, and Undo puts each back there (see [Mail engine](mail-engine.md)); Gmail moves them to the Inbox, so a trashed conversation of only sent mail comes back with the Inbox label. If part of a bulk request fails, Undo reverses only the conversations main reports as successfully changed.

## Actions without Undo

- Permanent deletion from Spam remains behind confirmation because Gmail does not provide an inverse.
- Deleting a Gmail label remains behind confirmation because recreating its name would not restore the original label id or thread memberships.
- Disconnecting an account remains behind confirmation because credentials and all account-scoped local data are removed.
- Sending is not reversible once the message has left: with Undo send off, or once its delay has run out. See [Undo send](#undo-send).
- Draft cleanup keeps its existing version history, which is a deeper and more useful recovery model than a single toast action.
- Marking conversations read or unread, starring them, and moving an archived conversation back to the Inbox remain directly reversible with the same control (Archive is Move to Inbox's reverse) and do not create an Undo opportunity.

Bulk Move to Trash no longer asks for confirmation because it has a provider and cache inverse. Existing confirmations remain for destructive actions without an inverse.

## Undo send

Settings › General › Sending sets how long a sent message waits before it leaves: Off, 5, 10, 20 or 30 seconds, 10 by default. Main owns the setting, in the app settings file, and a file written before it existed reads as 10 seconds. While a message waits, its Undo is on offer for exactly that delay rather than the usual eight seconds, through the same toast and `Mod+Z`. When the delay runs out, the offer is withdrawn as the toast says the message was sent, or names the recipients the server refused. An Undo that arrives after main has started sending says it was too late, and the toast that follows says the message went.

The rule that keeps this safe is that the saved draft outlives the hold. A reply's draft already exists; the composer saves its final content and stops writing before it sends. A new email is put in Stash first. Either way main holds the draft out of sight (out of the stash picker and the conversation's draft, and refusing saves and discards of it) and deletes it, by its id, only once the server has the message. Undo, a failure, a quit that could not finish, and a crash all therefore leave the draft where the user can find it; Undo also opens it again, in the new-email page or in its conversation, and a failure's toast says where it is. See [Desktop](desktop.md#undo-send) for the hold itself.
