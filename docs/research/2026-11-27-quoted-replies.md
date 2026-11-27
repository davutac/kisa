# Quoted replies: how they are marked and shown

Research date: 2026-11-27. The question was whether quoted earlier messages inside a message body ("On … wrote:" and the text under it, Outlook's From/Sent/To/Subject block, a forwarded message) follow an established format Kisa can detect, and how other clients show them once found. The findings come from RFCs, the source of open-source clients and parsers at the commits linked below, and vendor help pages, read on that date. Nothing here was measured against real mail.

## Summary

There is no standard for quoted replies beyond `>` in plain text. Every client marks its quotes its own way, and every parser that works well combines a list of known client markers with text heuristics. Clients that hide quotes collapse only the trailing one, behind a "•••" button, and leave inline replies alone.

## Standards

- **Plain text.** RFC 3676 §4.5 defines `>` as the quote indicator for `format=flowed`, its count being the depth, and §4.3 the `-- ` signature separator ([RFC 3676](https://www.rfc-editor.org/rfc/rfc3676#section-4.5)). It is honored well beyond `format=flowed`.
- **Attribution line.** Not standardized. RFC 1849 leaves it as an "UNRESOLVED ISSUE … There is already considerable diversity" ([RFC 1849](https://www.rfc-editor.org/rfc/rfc1849)). RFC 5322 links messages only through `In-Reply-To` and `References`.
- **HTML.** `<blockquote>` takes only a `cite` URL, and attribution "must be placed outside the blockquote" ([WHATWG](https://html.spec.whatwg.org/multipage/grouping-content.html#the-blockquote-element)). `type="cite"` is a Gecko and Apple convention, not a standard ([Gecko editor](https://github.com/mozilla-firefox/firefox/blob/86c8e13d5393/editor/libeditor/HTMLEditorDataTransfer.cpp#L3786)).

## What clients write

S: read in the client's own source. R: seen in a real message. 3P: only claimed by other projects' detectors.

| Client | Reply | Forward | Evidence |
| --- | --- | --- | --- |
| Gmail | `div.gmail_quote` (sometimes also `.gmail_quote_container`) holding `div.gmail_attr` and `blockquote.gmail_quote`; older mail `div.gmail_extra` | the same wrapper, `---------- Forwarded message ---------` in `gmail_attr`, no blockquote | 3P; Google's own CLI writes the same markup ([reply.rs](https://github.com/googleworkspace/cli/blob/8e945eed02a8/crates/google-workspace-cli/src/helpers/gmail/reply.rs#L402), [forward.rs](https://github.com/googleworkspace/cli/blob/8e945eed02a8/crates/google-workspace-cli/src/helpers/gmail/forward.rs#L221)). Kisa writes it too. |
| Apple Mail | an "On …, X wrote:" `div` before `blockquote[type=cite]` | not verified | R ([sample](https://github.com/open-mpi/ompi-www/blob/HEAD/community/lists/users/att-22120/attachment)) |
| Thunderbird | `div.moz-cite-prefix` then `blockquote[type=cite]` | `div.moz-forward-container`, `table.moz-email-headers-table` | S ([nsMsgCompose.cpp](https://github.com/mozilla/releases-comm-central/blob/e21d4a97d5b1/mailnews/compose/src/nsMsgCompose.cpp#L550)) |
| Outlook, Outlook on the web | `#divRplyFwdMsg` (`x_divRplyFwdMsg` once Exchange rewrites ids), `#appendonsend`, `#mail-editor-reference-message-container`, Word's `border-top:solid #E1E1E1 1.0pt` (or `#B5C4DF`) `div` over a From/Sent/To/Subject block, `-----Original Message-----`; Outlook for Mac `#OLK_SRC_BODY_SECTION` | the same header block | 3P, R for `x_` ([talon](https://github.com/mailgun/talon/blob/44d1fa5e5b/talon/html_quotations.py#L250), [sample](https://github.com/HlidacStatu/UZIS_COVID_DATA/blob/HEAD/2021-02-14/text_mailu_082032.html)) |
| Yahoo, AOL | `div.yahoo_quoted` (ids like `ydp…yahoo_quoted_…`); iOS `blockquote.iosymail` | — | 3P |
| Proton | `.protonmail_quote` | `------- Forwarded Message -------` | S ([messageDraftConstants.ts](https://github.com/ProtonMail/WebClients/blob/449c91f3909a/packages/mail-message/src/helpers/message/messageDraftConstants.ts)) |
| K-9, Thunderbird for Android | Gmail's markup | — | S ([HtmlQuoteCreator.java](https://github.com/thunderbird/thunderbird-android/blob/71efdf0f33dc/legacy/core/src/main/java/com/fsck/k9/message/quote/HtmlQuoteCreator.java#L57)) |
| Zoho, Tutanota, GMX/Web.de, Zimbra | `.zmail_extra`, `.tutanota_quote`, `[name=quote]`, `#aqm-original`, `hr[data-marker=__DIVIDER__]` | — | 3P |

Projects disagree on which Outlook variant writes `mail-editor-reference-message-container` and `divRplyFwdMsg`, and on whether `gmail_quote_container` marks forwards only. A detector does not need to know: each one marks a quote.

## How parsers find quotes

| Project | Technique | License |
| --- | --- | --- |
| [talon](https://github.com/mailgun/talon) (Mailgun, Python) | HTML markers first. Then "checkpoints": every tag is numbered, the HTML flattened to lines, each line classed (empty, `>`, splitter, text), regexes run over that class string, and tags whose checkpoints fell in removed lines are deleted. Splitters in about 10 languages. Leaves forwards and near-empty results alone; gives up past 1000 lines. | Apache-2.0 |
| [planer](https://github.com/lever/planer) (JS port of talon) | As talon, fewer markers. Last npm release 2023. | MIT |
| [quotequail](https://github.com/closeio/quotequail) (Close) | Flattens HTML to lines tracking blockquote depth; reply and forward patterns in about 9 languages; parses forwarded headers. | MIT |
| [email-reply-parser](https://github.com/crisp-oss/email-reply-parser) (Crisp, TS) | Text only; about 50 attribution and header regexes written to avoid catastrophic backtracking, widest language coverage. | MIT |
| [email_reply_trimmer](https://github.com/discourse/email_reply_trimmer) (Discourse) | Text only; one letter per line, regexes over that pattern; handles bottom-posting. | MIT |
| [email_reply_parser](https://github.com/github/email_reply_parser) (GitHub) | Text only, English, scans lines from the end. | MIT |
| Mailspring, FairEmail, Proton | DOM marker lists; Proton's is the most current (24 languages for Outlook's "From:"). | GPL-3.0, not usable as a source |
| FreeScout, Zammad, Bulwark | Separator strings and selectors. | AGPL-3.0, not usable as a source |

Gmail's "trimmed content" is said to hide anything repeated from other messages in the thread, signatures included ([labnol](https://labnol.org/internet/gmail-trimming-signature/28762)). Google publishes nothing on it, and no open-source project was found that trims by comparing a message with the rest of its thread.

## How clients show them

| Client | Default | Control | Nested quotes | Forwards |
| --- | --- | --- | --- | --- |
| Gmail | Trimmed, cannot be turned off | "•••", "Show trimmed content" | not verified | not verified |
| Apple Mail (Mac) | Partly hidden | "See More" at the end of the reply | one bar color per level ([Apple](https://support.apple.com/guide/mail/cpmlpreffont)) | not verified |
| Proton | Collapsed | "•••" `<button>`, "Show/Hide original message", key `O` ([MessageBodyIframe.tsx](https://github.com/ProtonMail/WebClients/blob/main/packages/mail-renderer/src/components/MessageBodyIframe.tsx)) | not verified | expanded when nothing else is in the message |
| Mailspring | Collapsed | unlabeled "•••" link ([message-item-body.tsx](https://github.com/Foundry376/Mailspring/blob/master/app/internal_packages/message-list/lib/message-item-body.tsx)) | — | expanded |
| Mimestream | Redundant quotes hidden | ellipsis button ([releases](https://mimestream.com/releases)) | not verified | not verified |
| Thunderbird | Expanded; collapsing requested since 2000 ([bug 35929](https://bugzilla.mozilla.org/show_bug.cgi?id=35929)) | — (an add-on adds Alt+Q) | 2px left bar, five colors ([messageQuotes.css](https://hg.mozilla.org/comm-central/file/tip/mail/themes/shared/mail/messageQuotes.css)) | not verified |
| FairEmail | Expanded; "Collapse quoted text" off by default | quote icon per top-level quote | one bar | — |

What they share and where they go wrong:

- **Only a trailing quote is collapsed.** Proton collapses the last quote and keeps a signature after it. Mailspring keeps a quote that unquoted text follows, and the whole body when it is all quote. Mimestream fixed "Replies with new text inline in quote block should not be collapsed".
- **Hidden inline replies are the known failure** ([Plain](https://help.plain.com/article/why-are-inline-email-responses-hidden-in-the-thread-timeline-5x78qm9q2t3y7j5xcxi1g7c5)).
- **Trimming repeated text that is not a quote surprises people.** Gmail hides repeated signatures, a Discourse reply footer ([Discourse](https://meta.discourse.org/t/gmail-trimming-email-content/21538)), and successive test mails.
- **The collapsed control shows no sender or date** in any client verified, and none sets `aria-expanded`. The WAI-ARIA disclosure pattern asks for a button with `aria-expanded` ([APG](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)).

## What this means for Kisa

A proposal, not a decision.

- **Detect in layers, best first.** (1) The marker selectors above, matching Outlook ids by suffix, and taking the attribution line just before a quote (`gmail_attr`, `moz-cite-prefix`, Apple's `div`) into it. (2) Outlook's bordered or `hr`-topped From/Sent/To/Subject block, with localized field names. (3) For plain text and unmarked HTML, `>` depth and attribution lines ("On … wrote:", "-----Original Message-----") in a handful of languages, written from the MIT and Apache projects. Thread comparison is left out until the first three fall short.
- **Collapse only a quote at the end.** Nothing but whitespace or a signature may follow it. A body that is all quote, and a forward, stay expanded: a forward's original is not a card of its own in the conversation.
- **Show it as "•••".** Earlier messages are already cards above, so the quote starts collapsed behind a single button named "Show quoted text" / "Hide quoted text" with `aria-expanded`, the same button the composer shows for a forwarded message. No preview: the card already names the sender and date.
- **Where it runs.** HTML bodies are already reworked in the parsed frame document (`prepareEmailFrame`), so detection can run there on the DOM. Plain-text bodies render in React, so their quote can use the composer's `Collapsible`.
- **Bound the work** like talon: skip detection past a size limit rather than slow a long message.

## What was built

Kisa writes its own detector, in the design above. Of the JavaScript parsers on npm on this date, the most used and the only maintained one is Crisp's `email-reply-parser` (MIT, about 750,000 weekly downloads, released 2026-11-12, no dependencies). It reads plain text only and returns rebuilt fragments rather than positions: it joins wrapped header lines and converts line endings, so where a quote starts in the original would have to be recovered, and it also hides sign-offs, which Kisa keeps in view. `planer` (MIT) handles HTML but last released in 2023. The patterns were written for Kisa from the formats above. The quotes are not folded in place behind a "•••", as proposed above and as other clients do: each quoted message is unpacked into a chip under the message and shown unquoted when chosen. [The desktop design](../architecture/desktop.md) describes the result.

## Not verified

- Gmail's trimming rule; Google documents none.
- The markup of Fastmail, Spark, Superhuman, Hey and the new Outlook, and of Apple's and Outlook's forwards.
- How Gmail and Apple style nested quotes and forwards, and Apple's exact "See More" wording.
- Outlook's own quote control; no source was found for its label.
