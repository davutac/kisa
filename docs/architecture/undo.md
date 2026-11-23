# Undoable actions

Kisa offers one level of application Undo for selected mail mutations. Thread actions show as done before the server answers (see [Desktop](desktop.md#optimistic-thread-actions)), so the latest undoable action's toast appears with the action itself, for eight seconds, and can be reversed from its Undo button or with `Mod+Z`. Text inputs and mail editors keep their native local Undo history; the application command is ignored while they have focus.

The renderer owns only the short-lived opportunity to Undo. The mail server and the account-scoped cache still perform both the original mutation and its inverse through the normal typed IPC and mail synchronization path. The server's answer then amends the offer: a refused action withdraws its Undo and turns the toast into the error, and a partly refused bulk action keeps Undo with the failure described. Undo is available before that answer: the conversations show as restored at once, and the inverse waits for the answer, then reverses only the conversations that changed, so an action the server refused never gets an inverse. Starting an inverse clears the Undo opportunity immediately, so double clicks and repeated shortcuts cannot run it twice; its own toast appears at once and becomes the error if the inverse fails.

## Actions with Undo

| Action                     | Inverse                               |
| -------------------------- | ------------------------------------- |
| Add or remove a user label | Restore the previous label membership |
| Move to Trash              | Remove Trash and restore Inbox        |
| Mark as not spam           | Move the conversation back to Spam    |

Single and bulk interaction paths use the same renderer module. Bulk label changes omit conversations already in the requested state, making the inverse exact for mixed selections. If part of a bulk request fails, Undo reverses only the conversations main reports as successfully changed.

## Actions without Undo

- Permanent deletion from Spam remains behind confirmation because Gmail does not provide an inverse.
- Deleting a Gmail label remains behind confirmation because recreating its name would not restore the original label id or thread memberships.
- Disconnecting an account remains behind confirmation because credentials and all account-scoped local data are removed.
- Sending is not reversible after Gmail accepts it.
- Draft cleanup keeps its existing version history, which is a deeper and more useful recovery model than a single toast action.
- Marking conversations read or unread remains directly reversible with the same control and does not create an Undo opportunity.

Bulk Move to Trash no longer asks for confirmation because it has a provider and cache inverse. Existing confirmations remain for destructive actions without an inverse.
