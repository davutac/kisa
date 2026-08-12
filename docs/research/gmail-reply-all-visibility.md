# Gmail Reply-All Visibility

Research date: 2026-08-12. Only first-party Google documentation is used below. **Fact** records documented behavior; **Inference** identifies behavior that Google does not explicitly specify; **Recommendation** is an implementation choice for Kisa.

## Finding

**Recommendation:** Show **Reply all** for a selected message only when its effective reply-all recipient set contains at least two distinct non-self addresses. In the normal one-to-one case—one other effective party plus the current account—hide Reply all because it is redundant.

This is more accurate than counting raw `To` and `Cc` entries. The calculation must normalize and deduplicate addresses, exclude the current account's own identities, honor `Reply-To`, and ignore Bcc.

## What Google Documents

**Fact:** Gmail defines **Reply** as sending to the sender, and **Reply all** as sending to the sender plus everyone in the message's `To` and `Cc` lines. Gmail's “Default reply behavior” setting changes the order of Reply and Reply all; the help page does not state the condition under which Reply all is shown or hidden ([Gmail Help: Reply to messages](https://support.google.com/mail/answer/6585?co=GENIE.Platform%3DDesktop&hl=en)).

**Fact:** Google's Apps Script Gmail API makes the recipient semantics more precise: message-level `reply` uses the reply-to address, while message-level `replyAll` uses the reply-to address and all recipients of that specific message. Its official example explicitly excludes Bcc recipients ([`GmailMessage.replyAll`](<https://developers.google.com/apps-script/reference/gmail/gmail-message#replyAll(String)>)).

**Fact:** Reply-all inputs are message-specific, not the union of everyone who has ever appeared in the conversation. Google's thread-level operation replies to the sender and recipients of the last message in the thread ([`GmailThread.replyAll`](<https://developers.google.com/apps-script/reference/gmail/gmail-thread#replyAll(String)>)). Kisa's selected-message actions should therefore use the selected message's headers.

**Fact:** A Gmail account can have several send-as addresses. Google's API represents the primary login and custom From addresses in the same send-as collection, and exposes whether a custom address should be treated as an alias of the primary address ([Gmail send-as resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs)). Gmail Help likewise documents adding other owned addresses and aliases ([Gmail Help: Send emails from a different address or alias](https://support.google.com/mail/answer/22370?hl=en)). Therefore, the primary account email is not necessarily the user's only identity.

**Fact:** Gmail API message data exposes standard RFC email headers such as `To` and `From` on each message payload, so the decision can be derived without inspecting message bodies or a thread-wide participant list ([Gmail message resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages#MessagePart)).

## What Must Be Inferred

**Inference:** Google does not publish the Gmail web client's exact Reply-all visibility predicate. The smallest rule consistent with the documented semantics and Gmail's one-to-one behavior is to hide Reply all when the normalized reply-all recipient set contains only one non-self address, and show it when that set contains two or more.

Expressed against already-normalized recipient calculations:

```text
replyAllRecipients = unique effective recipients for Reply all

showReplyAll = count(replyAllRecipients excluding self) > 1
```

Examples:

| Selected message | Effective other parties | Show Reply all? |
| --- | --- | --- |
| Alice → me | Alice | No |
| Alice → me, Cc Bob | Alice, Bob | Yes |
| Alice → Bob, Cc me | Alice, Bob | Yes |
| Me → Alice | Alice | No |
| Me → Alice and Bob | Alice, Bob | Yes |
| Alice → me, Bcc unknown | Alice | No; Bcc is not part of Reply all |

## Recommendation for Kisa

Derive both the button visibility and hotkey availability from one pure, message-level capability such as `canReplyAll(accountId, message)`. It should reuse the same address parsing, normalization, self-exclusion, deduplication, and `Reply-To` logic used to initialize the draft; otherwise the visible action and the eventual recipients can disagree.

For the current account model, excluding `accountId` is the safe minimum. Full Gmail parity around aliases would require supplying the account's known send-as identities to this calculation. Until Kisa has that identity catalog, treat alias parity as a documented limitation rather than guessing from display names or message history.

The official sources do not document what Gmail's Reply-all keyboard shortcut does when the UI action is absent. For a coherent Kisa interaction model, the command should be unavailable or a no-op under the same predicate instead of opening a draft labeled “Reply all” whose recipients are identical to Reply.
