# Gmail Spam Badge Semantics

Research date: 2026-08-13. Only first-party Google documentation is used below. **Fact** records documented behavior; **Inference** identifies behavior Google does not explicitly specify; **Recommendation** is an implementation choice for Kisa.

## Finding

**Recommendation:** Treat the Spam badge as true only when at least one cached Gmail message for a connected account has both the `SPAM` and `UNREAD` label IDs. Thread-level `is_in_spam` and `is_unread` projections may narrow the search, but they cannot establish badge eligibility because each flag can originate from a different message.

This matches Gmail's message-level label model and the API predicate `messages.list?labelIds=SPAM&labelIds=UNREAD&includeSpamTrash=true`: Google documents that every returned message must match all supplied label IDs and that Spam must be explicitly included in list results ([`users.messages.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)).

## What Google Documents

**Fact:** Gmail labels exist on messages. A thread-level label list contains labels found on any message in the thread, and a label present on the thread might not be present on every message ([Manage labels](https://developers.google.com/workspace/gmail/api/guides/labels#manage_labels_on_threads_and_messages)). A thread summary that unions message labels is therefore a valid projection, but it cannot prove that two labels co-occur on one message.

**Fact:** The REST `Thread` resource has no top-level `labelIds`; it contains its `Message` resources, which carry their own labels ([Thread resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads#resource:-thread)).

**Fact:** The Gmail `Message` resource stores `labelIds` as the labels applied to that individual message ([Message resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages#resource:-message)). `users.messages.list` applies multiple `labelIds` conjunctively and explicitly warns that messages in one thread can carry different labels ([`users.messages.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)). Thus:

```text
message A: SPAM
message B: INBOX, UNREAD
result for SPAM + UNREAD: no message

message A: SPAM, UNREAD
result for SPAM + UNREAD: message A
```

**Fact:** Gmail Help says search operators can be combined, `label:` finds emails under a label, and `is:unread` finds unread emails. It also explains that Gmail first identifies matching messages before presenting a matching conversation ([Gmail Help: Refine searches](https://support.google.com/mail/answer/7190?hl=en)). `label:spam is:unread` is therefore the UI-search analogue of requiring both properties on a matching message, not combining properties from separate messages in one conversation.

**Fact:** A Gmail label resource exposes both `messagesUnread`, defined as unread messages bearing that label, and `threadsUnread`, defined separately as unread threads bearing it. It also defines `labelShowIfUnread` in terms of unread messages with the label ([Label resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels#resource:-label)). These separate fields reinforce that message-level unread-with-label and thread-level unread are distinct concepts.

**Fact:** `messages.modify` adds or removes label IDs on one message ([`users.messages.modify`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify)). `threads.modify` applies its label change to all messages currently in the thread; messages added later do not inherit an earlier thread label change automatically ([`users.threads.modify`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/modify), [Manage labels](https://developers.google.com/workspace/gmail/api/guides/labels#add_or_remove_labels_on_threads)). Google identifies `UNREAD` as a system label users can apply or remove from messages and threads, and explicitly documents removing `UNREAD` as marking mail read ([Label resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels#type), [Manage Gmail filters](https://developers.google.com/workspace/gmail/api/guides/filter_settings#actions)).

**Fact:** Gmail API requests are scoped by `userId`, which is the user's email address or `me` for the authenticated user ([`users.messages.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list#path-parameters)). Cross-account aggregation is an application concern; Google does not provide an unscoped multi-account mailbox query.

## What Google Does Not Document

**Inference:** Google's public Gmail API and Help documentation do not state the exact internal predicate used to render the Gmail web client's Spam sidebar badge. The API nevertheless provides an exact first-party analogue for “unread messages in Spam”: message rows matching both `SPAM` and `UNREAD`. The label resource's `messagesUnread` field describes the same message-level intersection, whereas a unioned thread projection does not.

Google's Help page describes marking selected messages read or unread but does not define how a mixed-label conversation contributes to the Spam badge ([Gmail Help: Mark messages as read or unread](https://support.google.com/mail/answer/12516?hl=en)). No community posts or third-party observations are used as evidence here.

## Recommendation for Kisa

Use the local equivalent of this Gmail query, scoped independently per connected account:

```text
exists cached message where
  message.account_id = connected_account.id
  and message.label_ids contains SPAM
  and message.label_ids contains UNREAD
```

The existing thread flags may remain indexed candidate filters if useful, but the final condition must inspect one message row. This changes only badge eligibility; Spam mailbox membership and general thread unread semantics should keep their existing thread-level behavior.

When Kisa marks a whole thread read or unread through Gmail's thread operation, mirror Google's all-current-messages behavior in the cache: remove or add `UNREAD` on every cached message in that account/thread and update the thread projection in the same local transaction. Message-level operations should update only the targeted cached message and then recompute any thread projection. This keeps the badge's message-level source of truth synchronized without inventing a repair or reindex mechanism.
