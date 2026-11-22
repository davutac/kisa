# Gmail over IMAP: probe results

Research date: 2026-11-21. Two read-only probes ran against Gmail's IMAP and SMTP servers with OAuth 2.0 (SASL XOAUTH2) and the `https://mail.google.com/` scope. Mailboxes were opened with `EXAMINE` and bodies fetched with `BODY.PEEK`, so nothing on the server changed. Only capabilities, counts, sizes and timings were recorded; no addresses, subjects, label names or message content.

- **Small run:** one account connected in development Kisa, 8 messages, using the access token Kisa already held.
- **Scale run:** one account of 21,062 messages (18,620 conversations, 2.1 GB), from a separate browser sign-in with a user-owned Desktop OAuth client.

Both ran from one home network in Germany. Treat throughput figures as one sample, not a guarantee.

## Capabilities

Before login Gmail advertises `IMAP4rev1 UNSELECT IDLE NAMESPACE QUOTA ID XLIST CHILDREN X-GM-EXT-1 XYZZY SASL-IR AUTH=XOAUTH2 AUTH=PLAIN AUTH=PLAIN-CLIENTTOKEN AUTH=OAUTHBEARER`.

After login it adds `UIDPLUS COMPRESS=DEFLATE ENABLE MOVE CONDSTORE ESEARCH UTF8=ACCEPT LIST-EXTENDED LIST-STATUS LITERAL- SPECIAL-USE APPENDLIMIT=35651584`.

Not offered: `QRESYNC`, `OBJECTID`, `NOTIFY`, `BINARY`, `SORT`, `THREAD=REFERENCES`.

SMTP (`smtp.gmail.com:465`) accepted the same token with `AUTH XOAUTH2` (reply 235) and advertises `SIZE 35882577`, `8BITMIME`, `ENHANCEDSTATUSCODES`, `PIPELINING`, `CHUNKING`, `SMTPUTF8` and `LIMITS MAILMAX=1000 RCPTMAX=100`.

## Findings

| Question | Answer |
| --- | --- |
| Does an existing Gmail API access token work for IMAP and SMTP? | Yes, both accepted it (IMAP in 383 ms). |
| Are folders found without relying on localized names? | Yes. `LIST` marks All Mail, Drafts, Flagged, Important, Junk, Sent and Trash with special-use attributes. |
| Do Spam and Trash live outside All Mail? | Yes. They are separate mailboxes with their own UIDs (the scale account had 248 messages in Trash, 0 in Spam). |
| Do IMAP ids match the Gmail API ids? | Yes. `X-GM-MSGID` and `X-GM-THRID` are the decimal form of the API's hex ids: 8 of 8 threads and every message matched in both runs. |
| Does a label-only change reach `CHANGEDSINCE`? | Yes. Toggling one label in Gmail on the web advanced `HIGHESTMODSEQ`, and `UID FETCH … (FLAGS X-GM-LABELS) (CHANGEDSINCE n)` returned the two affected messages as label-only changes. |
| Does Gmail's own search work? | Yes. `X-GM-RAW` accepted Gmail query syntax. |
| Can one part of a large message be fetched alone? | Yes. The first 2 KB of one part of a 6 MB message returned 417 bytes in 173 ms. |
| Is `IDLE` accepted on the Inbox? | Yes. |

Unexplained: during the label watch `HIGHESTMODSEQ` advanced three times, and only the last advance carried the label change. The probe did not record what the first two returned.

## Scale measurements (21,062 messages)

| Operation | Time | Transfer |
| --- | --- | --- |
| `UID SEARCH ALL` on All Mail | 365 ms | 120 KB |
| Same with `ESEARCH RETURN (ALL COUNT)` | 222 ms | 80 KB |
| `FLAGS X-GM-LABELS X-GM-MSGID X-GM-THRID` for every message | 7.5 s (2,823 msg/s) | 3.0 MB (151 B/msg) |
| The same plus `INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)]`, newest first in chunks of 20,000 | 64 s (329 msg/s overall; 318 then 920 msg/s per chunk) | 7.9 MB (375 B/msg) |
| `BODYSTRUCTURE` for the newest 1,000 messages | 1.3 s | 399 B/msg |
| Full source of 50 recent messages under 200 KB | 3.7 s (13 msg/s) | 3.1 MB |
| Headers of 92 recent messages | 0.75 s (123 msg/s) | 472 KB |
| `X-GM-RAW` searches (`has:attachment`, `newer_than:30d`, a common word with 3,453 hits, a term with no hits) | 0.17–0.26 s each | under 20 KB each |

Fetching From and Subject is the expensive part of the skeleton: about nine times slower than identifiers, labels and flags alone. Transfer sizes are upper bounds because the probe did not enable `COMPRESS=DEFLATE`.

### Where the bytes are

- Median message 35 KB, 90th percentile 106 KB, 2.1 GB in total.
- 243 messages of 1 MB or more hold 49.5 % of all bytes.
- In the newest 1,000 messages, text parts average 47 KB per message (1.7 text parts each) and are 40.7 % of the bytes.
- Recent mail: last 30 days 145 messages (22 MB), last 90 days 409 (43 MB), last 365 days 1,393 (149 MB), attachments included.

### Estimates, not measurements

- Text of the whole mailbox: roughly 1 GB, under Google's published 2,500 MB per day IMAP download limit for Workspace accounts, and roughly half an hour at the measured full-source rate.
- Skeleton with sender and subject for 100,000 messages: roughly five minutes at the measured rate.

## Not exercised

Sending, trashing, permanent deletion, label changes made by a client, and mailboxes in the hundreds of thousands of messages. The probes were read-only.
