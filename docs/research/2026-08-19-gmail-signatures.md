# Per-Account Email Signatures

Research date: 2026-08-19. First-party Google documentation, the MIME specification, the linked Quickmail change, and the current Kisa repository are used below. **Fact** records documented behavior; **Repository fact** records current implementation; **Assessment** evaluates the reference implementation; **Recommendation** is a decision for Kisa.

## Implementation update

After this investigation, the product decision expanded the first version from plain text to Kisa's constrained Tiptap editor. The implementation stores matching HTML and plain-text forms locally per account; the Gmail API and draft-placement conclusions below are unchanged.

## Decision

**Recommendation:** Implement signatures as a Kisa-owned, local setting scoped to each connected account. Insert the selected account's signature into the editable body when a new draft, reply, reply-all, or forward is created, persist it as part of that draft, and send it in both the HTML and plain-text MIME alternatives. Do not depend on Gmail's `users.settings.sendAs.signature` field and do not blindly append the signature only at send time.

For a minimal first version, store one plain-text signature per account, preserve line breaks, and escape it when producing HTML. This matches the requested account-level model, avoids a new OAuth permission, and keeps HTML sanitization and remote signature images out of the first implementation. The signature should be visible and removable in the composer before the message is sent.

## Why Gmail's Signature Setting Is Not the Send Mechanism

**Fact:** Gmail models a signature as an optional HTML string on each `SendAs` alias. Google defines that field as being included in messages composed with the alias **in the Gmail web UI** and says it is added to **new emails only** ([`SendAs` resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs)). It is not documented as a server-side transformation of messages submitted through `users.messages.send` or `users.drafts.send`.

**Fact:** A Gmail API client creates the complete RFC 2822/MIME message, base64url-encodes it into the message's `raw` field, and passes that result to `messages.send` or `drafts.send` ([Create and send email messages](https://developers.google.com/workspace/gmail/api/guides/sending)). Consequently, a signature that must appear on mail sent by Kisa has to be part of the MIME body authored by Kisa.

**Fact:** Gmail can keep different signatures for different **Send mail as** addresses. Gmail Help also supports multiple named signatures, defaults, per-message selection, formatting and images, and up to 10,000 characters ([Create a Gmail signature](https://support.google.com/mail/answer/8395?co=GENIE.Platform%3DDesktop&hl=en)). The public `SendAs` resource exposes only one HTML `signature` value per alias and does not expose Gmail's named-signature or separate new-message/reply-default model.

**Fact:** Reading `sendAs` aliases and their signatures is allowed by Kisa's existing `https://mail.google.com/` scope ([`sendAs.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/list), [`sendAs.get`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/get)). Writing a `SendAs` signature requires `gmail.settings.basic` or `gmail.settings.sharing`; the full-mail scope is not accepted by the update endpoint ([`sendAs.update`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/update)). Google classifies `gmail.settings.basic` as Restricted, and `gmail.settings.sharing` is for administrative use with domain-wide delegation ([Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)). Updating non-primary addresses through `sendAs.update` is itself limited to service-account clients with domain-wide authority.

**Inference:** Synchronizing Kisa's setting back to Gmail would require additional authorization, still would not cause Gmail to decorate API sends, and cannot faithfully represent Gmail's current signature choices. It is unnecessary for the requested Kisa feature. A future explicit **Import from Gmail** action could read the primary alias's current HTML signature with the existing scope, but imported HTML would need the same strict sanitization used for other untrusted mail HTML.

## MIME and Reply Placement

**Fact:** `multipart/alternative` represents the same content in different formats ([RFC 2046, section 5.1.4](https://datatracker.ietf.org/doc/html/rfc2046#section-5.1.4)). If Kisa sends both `text/plain` and `text/html`, the signature must appear in both alternatives; otherwise recipients can see different message content depending on their client.

**Repository fact:** Kisa currently constructs `multipart/alternative` with a plain-text and an HTML body in [`gmail-mime.ts`](../../apps/desktop/src/main/mail/gmail-mime.ts). Replies and forwards add the quoted or forwarded message after the composer body. Therefore, putting the signature in the authored draft body naturally places it before quoted history in both alternatives.

**Recommendation:** Insert the signature at draft creation, separated from authored text by a blank line. Give the generated HTML block stable Kisa-owned metadata, or keep equivalent draft metadata, so Kisa can distinguish the automatic block from ordinary user text. This supports the following behavior without string matching:

- A reopened draft keeps exactly the signature it was saved with and does not gain a duplicate.
- The user can edit or remove the signature before sending.
- Changing the From account can replace an untouched automatic signature with the new account's signature instead of sending the old account's sign-off.
- Changing the account setting affects future drafts, not an already written draft unexpectedly.
- Reply, reply-all, and forward place the signature before quoted content.

The send boundary should accept the draft's final body; it should not append whatever signature happens to be configured at that later time. This also makes the draft preview and sent message agree.

## Assessment of the Quickmail Reference

The linked [Quickmail pull request](https://github.com/DivinPrince/quickmail/pull/7/files) is directionally useful. It stores a user-scoped value, normalizes line endings and trailing whitespace, escapes plain text before adding it to HTML, appends matching content to the text and HTML alternatives, rejects a signature-only message, and tests empty and special-character cases.

**Assessment:** Its send-time append is not the right interaction model for Kisa. The signature is absent from the editable draft, so the user cannot preview, change, or remove it; a setting change can silently alter an old draft; and a retry or future second insertion path can duplicate it. Its 1,000-character plain-text limit is an application choice, not a Gmail API limit. Its user-level row also does not account for multiple From aliases, although one Kisa setting per connected account is correct while Kisa sends only from that account identity.

## Kisa Implementation Shape

**Repository fact:** Kisa already has an `account_settings` row keyed by account email, carries `accountId` through new-message and thread-message send requests, persists local drafts with account identity and HTML/text bodies, and removes account settings during disconnect. These are the correct ownership boundaries for an account-level signature.

**Recommendation:** Extend the existing account-settings model rather than create a Gmail settings gateway:

1. Add a non-null signature text column with an empty default to `account_settings`, generate the Drizzle migration, and include it in the existing account-settings contracts, update path, renderer subscription, and disconnect cleanup.
2. Add a per-account signature editor to that account's Settings section. Treat empty text as disabled. Use a documented application limit; 10,000 characters matches Gmail's UI limit, while a smaller limit is acceptable only as an explicit Kisa product choice.
3. Centralize a pure conversion that normalizes line endings, creates safe HTML from plain text, and produces equivalent plain text. Reuse it for new messages, replies, reply-all, and forwards.
4. Insert once when creating a blank draft. Persist the resulting body and enough ownership metadata to replace only an untouched generated block when the sending account changes.
5. Keep the final main-process send path defensive: validate the IPC body and build MIME as it does today, but do not read settings and add a second signature there.

## Verification Matrix

Focused tests should cover:

- two connected accounts with different signatures, including colliding Gmail message/thread IDs;
- new message, reply, reply-all, and forward placement before quoted content;
- matching text and HTML alternatives, multiline text, non-ASCII text, and HTML metacharacters;
- empty signature, signature-only draft rejection, user-deleted signature, and no duplicate after save/reopen;
- account switch with an untouched automatic signature and with a user-edited signature;
- setting changes after a draft is created;
- disconnect cleanup and restart persistence;
- settings IPC decode/encode, change events, and renderer state refresh.

If Kisa later supports Gmail `SendAs` aliases, key signature selection by `(accountId, fromAddress)` rather than by account alone, because Gmail associates signatures with aliases ([Manage aliases and signatures](https://developers.google.com/workspace/gmail/api/guides/alias_and_signature_settings)).
