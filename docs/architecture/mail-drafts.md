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

## Attachments

New-email drafts retain the existing narrow attachment metadata and local path references. Kisa does not copy attachment bytes into the database. A missing or inaccessible path therefore remains a send-time attachment error rather than granting the renderer a broader filesystem capability.

## Multi-window behavior

Draft upserts and removals are broadcast to renderer windows. The database transaction replaces an older thread draft before publishing the new one, preserving the one-draft-per-conversation invariant across the main and popped-out thread views.
