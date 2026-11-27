# Dark mode for messages that bring their own colours

Research date: 2026-11-27. The question was how other mail clients show an HTML message written for a white page while the app is dark, before Kisa stopped giving every such message a light page. The findings come from web searches on that date, mostly guides written for people who send mail, which disagree in places and date from different years. Nothing here was measured.

## Summary

Clients do one of three things, and the names for them come from Litmus and are used across the guides: leave the message alone, invert part of it, or invert all of it. The one desktop client that adapts messages and is open about how, Thunderbird, pairs it with a switch on each message.

| Behaviour | What it does | Clients usually listed |
| --- | --- | --- |
| No colour change | The app goes dark; the message keeps its light page | Gmail on the web, Apple Mail for designed HTML |
| Partial invert | Light backgrounds go dark and dark text goes light; areas already dark are left | Outlook.com and the new Outlook, Gmail on Android |
| Full invert | Every colour is inverted, dark designs included | Gmail on iOS, classic Outlook on Windows |

- **The sources disagree** on Gmail for Android and on Outlook for Windows, each of which appears under both kinds of inversion.
- **Apple Mail** honours `prefers-color-scheme` and the `color-scheme` meta tag, and otherwise leaves designed mail as it is. Gmail strips `prefers-color-scheme`.
- **Thunderbird** adapts messages to dark mode since version 136, behind the `mail.dark-reader.enabled` preference, with a toggle in each message's header to turn it off for that message; the 140 notes list it as "dark reader" in the message pane ([140 release notes](https://www.thunderbird.net/en-US/thunderbird/140.0esr/releasenotes/), [what's new](https://support.mozilla.org/en-US/kb/new-thunderbird-desktop/revision/299824)). Its bug tracker shows later fixes to the toggle: keeping scroll position when it is used, and hiding it in high-contrast mode.

## What this means for Kisa

Kisa's repair is a partial invert that is narrower still: it changes a colour only where the dark page made text unreadable or a background stood in for the page, and leaves a message built out of backgrounds on its light page. It keeps a per-message switch, as Thunderbird does. [The desktop design](../architecture/desktop.md) describes it.

## Not verified

- How Proton Mail, Fastmail, Spark, Superhuman and Mimestream treat message colours; no source was found.
- Which algorithm any client uses to pick the new colours.
- Which Thunderbird bug carries each of the toggle's fixes, and how long the request for the feature stood open ([bug 1715361](https://bugzilla.mozilla.org/show_bug.cgi?id=1715361)); the tracker was seen only as search summaries.
- That full inversion is what senders object to most, which the guides imply but none was read to say.
- Outlook's own per-message light switch, which is remembered but was not found in a source.

## Sources

- [Litmus: the ultimate guide to dark mode for email marketers](https://www.litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers)
- [Bird: different email clients in dark mode](https://docs.bird.com/taxi/email-and-taxi-for-email-best-practice/dark-mode/different-email-clients-in-dark-mode)
- [Courier: dark mode email design](https://www.courier.com/blog/dark-mode-email-design)
- [customer.io: email dark mode](https://customer.io/learn/message-composing/email-dark-mode)
