# Gmail Scope Minimization for Kisa

Research date: 2026-08-16. Only first-party Google documentation and the current Kisa repository are used below. **Fact** records documented behavior; **Repository fact** records current implementation; **Inference** identifies a conclusion drawn from those facts; **Recommendation** is a decision for Kisa.

## Decision

**Recommendation:** If Kisa keeps its user-visible **Delete forever** action for conversations in Spam, reply **“Unable to use narrower scopes”** and submit the requested replacement demo. Kisa has a narrow, documented reason for `https://mail.google.com/`: that action calls `users.threads.delete`, which immediately and permanently deletes a thread, cannot be undone, and accepts only the full-mail scope ([`users.threads.delete`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/delete)).

If Kisa is willing to remove immediate permanent deletion, accept `https://www.googleapis.com/auth/gmail.modify`. It covers Kisa's other current Gmail API operations, including reading and synchronizing mail, downloading attachments, sending, changing labels and read state, restoring Spam, and moving conversations to Trash. Google's scope documentation states directly that the full-mail scope should be requested only for immediate permanent deletion that bypasses Trash and that all other actions can use less permissive scopes ([Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)).

This is a least-privilege product choice, not a way to avoid restricted-scope verification: Google classifies both `gmail.modify` and `https://mail.google.com/` as Restricted scopes ([Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)).

## What the Full-Mail Scope Uniquely Enables

**Fact:** Google describes `https://mail.google.com/` as permission to read, compose, send, and permanently delete all Gmail email. Its accompanying note says to request it only when an app needs to immediately and permanently delete threads or messages while bypassing Trash; `gmail.modify` expressly excludes that ability ([Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)).

**Fact:** `users.threads.delete` immediately and permanently deletes a thread and every message in it, cannot be undone, and lists only `https://mail.google.com/` as an accepted OAuth scope. Google recommends `threads.trash` instead ([`users.threads.delete`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/delete)). The message-level equivalents, `users.messages.delete` and `users.messages.batchDelete`, likewise perform permanent deletion; they are not needed by Kisa's current thread-level action ([Gmail REST resources](https://developers.google.com/workspace/gmail/api/reference/rest)).

**Inference:** For Kisa's current Gmail REST integration, immediate permanent deletion is the only material capability gained by using `https://mail.google.com/` instead of `gmail.modify`. The full scope also authorizes Gmail IMAP, POP, and SMTP access, but Kisa uses the Gmail REST API, not those protocols; Google instructs apps that do not require full mail access to migrate to granular Gmail API scopes ([Gmail XOAUTH2 scope guidance](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol#oauth_20_scopes)).

## Coverage of Kisa's Current Operations

The current gateway surface is defined in [`packages/gmail/src/gateway.ts`](../../packages/gmail/src/gateway.ts), and its Google API adapter is in [`apps/desktop/src/main/mail/gmail-gateway.ts`](../../apps/desktop/src/main/mail/gmail-gateway.ts).

| Kisa capability | Gmail API operation | `gmail.modify`? | Official evidence |
| --- | --- | --- | --- |
| Identify the Gmail account and obtain mailbox totals/current history ID | `users.getProfile` | Yes | The method accepts `gmail.modify` ([reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile)). |
| Incremental mailbox synchronization | `users.history.list` | Yes | The method accepts `gmail.modify` ([reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)). |
| List and open threads, including full message bodies | `users.threads.list`, `users.threads.get` | Yes | These methods accept `gmail.modify` ([list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/list), [get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get)). |
| Download an attachment on demand | `users.messages.attachments.get` | Yes | The method accepts `gmail.modify` ([reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get)). |
| List/get/create/rename/recolor/delete user-label definitions | `users.labels.*` | Yes | Label listing and creation accept `gmail.modify`; the method references for update, patch, and delete list it as well ([list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/list), [create](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/create), [patch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/patch), [delete](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/delete)). |
| Mark read/unread, archive, apply/remove labels, mark Spam, or remove from Spam | `users.threads.modify`, `users.messages.batchModify` | Yes | Both label-modification methods accept `gmail.modify` ([thread modify](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/modify), [batch message modify](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/batchModify)). |
| Send, reply, reply all, and forward | `users.messages.send` | Yes | The send method accepts `gmail.modify` ([reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)). |
| Move a conversation to Trash | `users.threads.trash` | Yes | The method accepts `gmail.modify` and moves every message in the thread to Trash ([reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/trash)). |
| Restore a conversation from Trash | `users.threads.untrash` | Yes | The method accepts `gmail.modify` ([reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/untrash)). |
| Immediately and permanently delete a conversation | `users.threads.delete` | **No** | The method accepts only `https://mail.google.com/` ([reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/delete)). |

**Repository fact:** Kisa's permanent-delete path is deliberately narrower than the permission itself. `deleteSpamThread` first verifies that the cached conversation is in Spam, then invokes `gmail.deleteThread`; the gateway implements that with `client.users.threads.delete` ([mail sync](../../apps/desktop/src/main/mail/mail-sync.ts), [gateway adapter](../../apps/desktop/src/main/mail/gmail-gateway.ts)). Other destructive mailbox actions use `threads.trash` or label modification.

## Spam and Trash Semantics

**Fact:** In Gmail's user interface, Spam is automatically deleted after 30 days. A user can also select individual Spam messages and choose **Delete forever**; removing a false positive uses **Not spam** ([Gmail Help: Report spam](https://support.google.com/mail/answer/1366858/mark-or-unmark-as-spam-in-gmail-computer?hl=en)).

**Fact:** Ordinary deletion moves a message to Trash, where it remains recoverable for up to 30 days unless the user permanently deletes it. After 30 days it is permanently deleted ([Gmail Help: Delete messages](https://support.google.com/mail/answer/7401?co=GENIE.Platform%3DDesktop&hl=en)). At the API level, `threads.trash` moves the entire conversation to Trash and is authorized by `gmail.modify`; `threads.delete` bypasses Trash and permanently deletes the conversation ([trash](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/trash), [delete](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/delete)).

**Inference:** The reviewer's demand to show that Trash contains no deleted Spam message is a direct test of the one capability that distinguishes the two scopes. Showing only that the conversation disappears from Kisa's Spam list is insufficient: both permanent deletion and a move to Trash would make it disappear there. Showing an empty Trash—or searching Trash for a unique test subject and showing no result—demonstrates that Kisa bypassed Trash.

## Verification Implications

**Fact:** Google's Workspace policy permits only permissions critical to implemented functionality and prohibits requesting access for hypothetical future features ([Workspace API User Data and Developer Policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy#request_the_minimum_relevant_permissions)). Restricted-scope verification likewise tells developers to establish that every requested scope is necessary, use endpoint references to determine least privilege, test the best-fitting scope, and accurately declare all used scopes in Cloud Console ([restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#understand_your_scope_use)).

**Fact:** A verification demo must show the English OAuth grant flow, correct app name and OAuth client ID, and in detail the functionality enabled by each requested sensitive or restricted scope. The submission must also explain why less limited scopes are insufficient ([verification preparation](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification#steps_to_prepare_for_verification)).

**Fact:** Both candidate Gmail scopes remain Restricted. An app requesting either one still needs restricted-scope verification unless an exception applies. Google says a third-party security assessment is required when an app can access restricted data from or through a third-party server; the choice between these two scopes does not by itself remove that condition ([restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).

## Replacement Demo Checklist

To substantiate the full-mail scope, the replacement video should show one controlled test conversation with a unique, non-private subject and no other Trash contents:

1. Show Kisa initiating OAuth, the English Google consent screen, the Kisa app name, and the browser address bar containing the submitted OAuth client ID.
2. Show the test conversation in Kisa's Spam mailbox and the user-visible **Delete forever** action.
3. Show Kisa's confirmation that the action is permanent, then confirm it.
4. Show that the conversation disappears from Spam.
5. Open Gmail's Trash folder and visibly show that it contains no messages, as the reviewer explicitly requested. If practical, also search Trash for the unique subject to make the absence unambiguous.
6. State in the narration or captions that Kisa invokes `users.threads.delete`, that the operation bypasses Trash and cannot be undone, and that Google's method reference authorizes it only with `https://mail.google.com/`.

**Recommendation:** Keep the recording tightly focused on this distinction. Reading, sending, read/unread, labels, Spam restoration, and ordinary Trash behavior do not justify the full scope because Google documents all of them under `gmail.modify`.
