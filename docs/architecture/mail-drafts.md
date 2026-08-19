# Local mail drafts

Kisa stores unfinished compositions in the encrypted local SQLite database. It does not create Gmail-hosted drafts or add draft synchronization to the Gmail boundary.

## Model

A draft contains its optional account owner, kind, recipients, subject, rich-text body, local attachment references, and creation/update timestamps. New-email drafts may remain unassigned; reply, reply-all, and forward drafts require an account and also retain the Gmail thread and source-message IDs needed to send the composition correctly.

New-email drafts have independent IDs, so an account can keep several stashes. A partial unique index permits only one draft for a given `(account_email, thread_id)` while still permitting different accounts to use the same Gmail thread ID.

Draft content crosses the same renderer → preload → main → database utility-process boundary as other private local mail data. Synchronous SQLite work remains in the utility process. Draft requests and renderer events are schema-validated at IPC.

## Lifecycle

Clicking Reply, Reply all, or Forward creates the thread draft immediately. The composer saves changes after a short debounce. Navigating back to the conversation restores the saved action, recipients, body, and source message.

Closing a thread discards its draft only when the body is blank and the recipients still match the action's generated defaults. Generated reply recipients therefore do not create a ghost draft. A recipient edit or body content keeps it. The composer trash button always discards it, and a successful send removes it.

Opening New email keeps the composition in renderer state without continuously saving it. Closing dismisses the current form without storing it. Pressing `Mod+S` on a non-empty form, or using the Stash button, stores the current draft, resets the form, and keeps the dialog open; on a blank form, `Mod+S` opens the stash picker when saved stashes exist. Any recipient, subject, body, or attachment content enables stashing. A new-email stash may have no owner while its From account remains unselected; popping it preserves that unassigned state. Stash and pop transitions update the composer optimistically while their ordered database operations continue in the background, so persistence does not block further composition. The dialog lists other stashes newest-first. Selecting a stash removes it from storage as it enters the composer, and explicitly stashing places it back in the stash. A new-email draft is empty only when recipients, subject, body, and attachments are all empty.

New email initially focuses To whether or not an account is selected. Stashing restores the same semantic composer control after the form resets. The stash picker focuses its search input and returns focus to the composer when it closes; selecting a stash focuses the first incomplete field in To → Subject → Message order. Focus restoration uses registered controls rather than DOM selectors or timing retries.

Changing the From account changes where the composition is stored the next time it is stashed. Disconnecting an account removes all of its stored drafts along with its credentials, cached mail, settings, and sender trust.

## Account signatures

Each connected account may have one local rich-text signature with a plain-text alternative of up to 10,000 characters. Kisa edits it with the same constrained Tiptap surface used for message composition and stores the validated HTML/text pair together in the account setting. Kisa inserts the signature visibly when a new-message, reply, reply-all, or forward draft is created, and persists the matching text and HTML fragments with the draft. The signature remains editable or removable like the rest of the body. A signature by itself does not make a draft sendable or worth saving.

Automatic-signature metadata records the owning account and exact generated fragment. Switching the From account replaces the fragment only while it is still untouched; edited signature text is ordinary user content and is preserved. Existing drafts retain the signature they were created with when the account setting changes, so the visible draft matches the MIME body sent to Gmail. Kisa does not write Gmail's `SendAs.signature`: Gmail documents that setting for its web composer, while API clients send complete client-authored MIME messages.

## Attachments

The renderer receives only attachment display metadata and opaque references. Preload resolves paths only from Electron `File` objects produced by an actual file selection, and main opens each selection to record its canonical path and file identity. Draft storage keeps that main-validated record so stashes remain usable after restart; records written by older versions without the authorization marker are not reopened and must be attached again.

Immediately before send, main verifies that each reference belongs to the invoking `WebContents`, reopens the canonical file, checks its identity and aggregate size, and returns a short-lived capability. Send consumes every capability once and reads through the descriptor that was already opened during preparation. The renderer cannot submit a path, reuse a consumed capability, use another window's reference, or swap the selected path to a different file. Kisa still does not copy attachment bytes into the database, so a missing, replaced, or changed file remains a send-time attachment error.

## Multi-window behavior

Draft upserts and removals are broadcast to renderer windows. The database transaction replaces an older thread draft before publishing the new one, preserving the one-draft-per-conversation invariant across the main and popped-out thread views.
