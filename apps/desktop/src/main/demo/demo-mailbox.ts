import { AccountId } from "@repo/mail/ids";

import { composeMessage } from "../mail/engine/outgoing-message";
import type { OutgoingAttachment } from "../mail/engine/outgoing-message";
import { toIndexText } from "../mail/message-text";
import { demoLandscape, demoPdf, demoSwatchBoard } from "./demo-attachments";
import { makeDemoMailServer } from "./demo-mail-server";
import type { DemoFolder, DemoMailServer } from "./demo-mail-server";

// The mail demo mode shows: four accounts of one made-up person, one on each
// provider Kisa connects to, written out here and dated back from the moment
// the app starts. Every name, company
// and address is invented, and every address is on the reserved `.example`
// domain (RFC 2606), which no real mailbox or server can have.

interface Person {
  readonly address: string;
  readonly name: string;
}

interface DemoMessage {
  readonly attachments?: readonly OutgoingAttachment[];
  readonly cc?: readonly Person[];
  readonly from: Person;
  readonly html: string;
  /** Gmail's Important marker. Other providers have none. */
  readonly isImportant?: boolean;
  readonly isStarred?: boolean;
  readonly isUnread?: boolean;
  /** How long before the app started the message was sent. */
  readonly minutesAgo: number;
  /** Whom it is to, when not the account or the thread's other side. */
  readonly to?: readonly Person[];
}

interface DemoThread {
  /**
   * Where its received mail is filed: the Inbox, a place every provider has
   * under its own name (`Place`), or a folder of the account's. The
   * account's own mail is in Sent.
   */
  readonly folders: readonly string[];
  readonly messages: readonly DemoMessage[];
  readonly subject: string;
}

export interface DemoAccount {
  readonly accountId: AccountId;
  /** How the engine reads the provider's server. */
  readonly dialect: "generic" | "gmail";
  readonly displayName: string;
  readonly email: string;
  /** Every mailbox the account's server lists. */
  readonly folders: readonly DemoFolder[];
  /** The server the account's row names. Nothing ever connects to it. */
  readonly host: string;
  readonly provider: "gmail" | "icloud" | "imap" | "outlook";
  /**
   * The account's mail, written out when asked for: its attachments are
   * drawn then, which a start without demo mode must not pay for.
   */
  readonly threads: () => readonly DemoThread[];
}

const HOUR = 60;
const DAY = 24 * HOUR;

const INBOX = "INBOX";

// The places every provider has, under names of its own.
const SENT = "Sent";
const ARCHIVE = "Archive";
const JUNK = "Junk";
const TRASH = "Trash";

type Place = typeof ARCHIVE | typeof JUNK | typeof SENT | typeof TRASH;

const domainOf = (address: string): string =>
  address.slice(address.lastIndexOf("@") + 1);

/** Below the ids the demo server gives the mail it files later. */
const GMAIL_THREAD_BASE = 1_700_000_000_000_000_000n;

const mail = (
  from: Person,
  minutesAgo: number,
  html: string,
  extras: Omit<DemoMessage, "from" | "html" | "minutesAgo"> = {}
): DemoMessage => ({ ...extras, from, html, minutesAgo });

const thread = (
  subject: string,
  folders: readonly string[],
  messages: readonly DemoMessage[]
): DemoThread => ({ folders, messages, subject });

/** A message written by hand: paragraphs and nothing else. */
const note = (...paragraphs: readonly string[]): string =>
  paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");

const quotedSender = (from: Person): string =>
  `${from.name} &lt;${from.address}&gt;`;

/** A reply's quote as Gmail writes it, and as Kisa's own replies carry it. */
const gmailQuote = (from: Person, sent: string, html: string): string =>
  `<div><br></div><div class="gmail_quote"><div class="gmail_attr">On ${sent}, ${quotedSender(from)} wrote:<br></div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${html}</blockquote></div>`;

/** A reply's quote as Apple Mail writes it. */
const appleQuote = (from: Person, sent: string, html: string): string =>
  `<div><br><div>On ${sent}, ${quotedSender(from)} wrote:</div><br class="Apple-interchange-newline"><blockquote type="cite"><div>${html}</div></blockquote></div>`;

/**
 * A reply's quote as Outlook for Windows writes it: a header block under a
 * bordered rule, in a wrapper of its own, with the original after the wrapper.
 */
const outlookQuote = (
  from: Person,
  to: Person,
  sent: string,
  subject: string,
  html: string
): string =>
  `<style>p.MsoNormal{margin:0cm;font-size:11pt;font-family:Calibri,sans-serif}</style><div><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm"><p class="MsoNormal"><b>From:</b> ${quotedSender(from)}<br><b>Sent:</b> ${sent}<br><b>To:</b> ${quotedSender(to)}<br><b>Subject:</b> ${subject}</p></div></div><p class="MsoNormal">&nbsp;</p>${html}`;

/** A designed message on its own light page, as a company's mail is. */
const sheet = (accent: string, content: string): string =>
  `<div style="background:#f3f0e9;padding:28px 16px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2933"><div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden"><div style="height:6px;background:${accent}"></div><div style="padding:28px 32px">${content}</div></div></div>`;

const heading = (text: string): string =>
  `<h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:#111827">${text}</h1>`;

const eyebrow = (text: string, color: string): string =>
  `<p style="margin:0 0 8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${color}">${text}</p>`;

const smallPrint = (text: string): string =>
  `<p style="margin:22px 0 0;font-size:12px;color:#6b7280">${text}</p>`;

const rows = (entries: readonly (readonly [string, string])[]): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:14px 0">${entries
    .map(
      ([label, value]) =>
        `<tr><td style="padding:9px 0;border-top:1px solid #e5e7eb;color:#6b7280">${label}</td> <td style="padding:9px 0;border-top:1px solid #e5e7eb;text-align:right;font-weight:600">${value}</td></tr>`
    )
    .join("")}</table>`;

const pdf = (
  filename: string,
  title: string,
  lines: readonly string[]
): OutgoingAttachment => ({
  bytes: demoPdf(title, lines),
  filename,
  mediaType: "application/pdf",
});

const png = (filename: string, bytes: Uint8Array): OutgoingAttachment => ({
  bytes,
  filename,
  mediaType: "image/png",
});

// ------------------------------------------------------------------- work

const MAYA_WORK: Person = {
  address: "maya@fernhill.example",
  name: "Maya Lindqvist",
};

const THEO: Person = {
  address: "theo@fernhill.example",
  name: "Theo Marchetti",
};

const INES: Person = { address: "ines@fernhill.example", name: "Ines Duarte" };

const SOFIA: Person = {
  address: "sofia@fernhill.example",
  name: "Sofia Brandt",
};

const NOOR: Person = { address: "noor@fernhill.example", name: "Noor Haddad" };

const STUDIO: Person = {
  address: "studio@fernhill.example",
  name: "Fernhill Studio",
};

const JONAS: Person = {
  address: "jonas@harborcoffee.example",
  name: "Jonas Aalto",
};

const HARBOR_ACCOUNTS: Person = {
  address: "accounts@harborcoffee.example",
  name: "Harbor Coffee Accounts",
};

const PRIYA: Person = {
  address: "priya@tidewater.example",
  name: "Priya Raman",
};

const MAREK: Person = {
  address: "marek@haldenprint.example",
  name: "Marek Novak",
};

const AIKO: Person = { address: "aiko@tanabe.example", name: "Aiko Tanabe" };
const LEO: Person = { address: "leo@shapenotes.example", name: "Leo Okonkwo" };

const TYPE_NOTES: Person = {
  address: "letters@quillandstem.example",
  name: "Type Notes",
};

const CANVASLY: Person = {
  address: "no-reply@canvasly.example",
  name: "Canvasly",
};

const INKWELL: Person = { address: "billing@inkwell.example", name: "Inkwell" };

const CODEBERTH: Person = {
  address: "notifications@codeberth.example",
  name: "Codeberth",
};

const CORNER_DELI: Person = {
  address: "orders@cornerdeli.example",
  name: "Corner Deli",
};

const AWARDS: Person = {
  address: "prizes@brightlotto.example",
  name: "Global Design Awards",
};

const HARBOR = "Clients/Harbor Coffee";

// The rebrand thread quotes each earlier message the way a different client
// would, and each reply carries the quotes of the one it answers, so its last
// message holds a chain of three: Gmail's quote of Apple Mail's of Outlook's.
const ROUND_TWO = note(
  "Hi Jonas,",
  "Round two is attached. We kept the hand-drawn wordmark from the first round and rebuilt everything around it: a warmer palette, a tighter grid for the bags, and a simpler mark for the cup sleeves.",
  "Pages 4 to 7 show the bags in all five roasts. I would look at those first.",
  "Maya"
);

const ROUND_TWO_REPLY = note(
  "Maya, this is a big step up.",
  "The clay colour is exactly the warmth we were missing. My only worry is the moss green on the decaf bag, which reads a little cold next to the others on the shelf.",
  "I am showing it to the shop managers tomorrow morning and will come back with their notes.",
  "Jonas"
);

const ROUND_TWO_DECAF = note(
  "Good catch on the decaf. I will try it two steps warmer and send both side by side.",
  "Tell me what the shop managers say about the menu boards in particular. They are the people who have to read them from behind the counter."
);

const ROUND_TWO_REPLY_SENT =
  ROUND_TWO_REPLY +
  outlookQuote(
    MAYA_WORK,
    JONAS,
    "Monday, 09:14",
    "Rebrand: round two feedback",
    ROUND_TWO
  );

const ROUND_TWO_DECAF_SENT =
  ROUND_TWO_DECAF + appleQuote(JONAS, "Tuesday at 10:17", ROUND_TWO_REPLY_SENT);

const workThreads = (): readonly DemoThread[] => [
  thread(
    "Rebrand: round two feedback",
    [INBOX, HARBOR],
    [
      mail(MAYA_WORK, 2 * DAY + 3 * HOUR, ROUND_TWO, {
        attachments: [
          pdf("Harbor-Coffee-Brand-v2.pdf", "Harbor Coffee Roasters", [
            "Brand direction, round two",
            "1. Wordmark and cup mark",
            "2. Palette: harbor blue, clay, oat, moss",
            "3. Packaging grid for five roasts",
            "4. Signage and menu boards",
          ]),
        ],
      }),
      mail(JONAS, DAY + 5 * HOUR, ROUND_TWO_REPLY_SENT),
      mail(MAYA_WORK, DAY + 2 * HOUR, ROUND_TWO_DECAF_SENT),
      mail(
        JONAS,
        6,
        note(
          "The team loved it. Two small things from the managers:",
          "<b>Menu boards:</b> prices need to be one size larger, they are hard to read from the queue.<br><b>Cup sleeves:</b> can the mark sit lower, so a hand does not cover it?",
          "If you can turn those around this week, we are ready to sign off and book the printer.",
          "Jonas"
        ) + gmailQuote(MAYA_WORK, "Wed, 13:17", ROUND_TWO_DECAF_SENT),
        { isStarred: true, isUnread: true }
      ),
    ]
  ),
  thread(
    "Contract for the spring campaign",
    [INBOX, "Clients"],
    [
      mail(
        PRIYA,
        25,
        note(
          "Hi Maya,",
          "Legal has approved the statement of work, so the signed copy is attached. The only change from your draft is the payment schedule: three instalments, not two.",
          "Could you countersign by Friday? I would like to open the purchase order before the month closes.",
          "Thanks,<br>Priya"
        ),
        {
          attachments: [
            pdf("Tidewater-Spring-Campaign-SOW.pdf", "Statement of work", [
              "Tidewater Outdoors and Fernhill Studio",
              "Scope: spring campaign identity, 12 weeks",
              "Deliverables: campaign mark, photography direction, launch kit",
              "Payment: three instalments, net 30",
            ]),
          ],
          isUnread: true,
        }
      ),
    ]
  ),
  thread(
    "Friday demo: who is presenting?",
    [INBOX],
    [
      mail(
        THEO,
        3 * HOUR + 20,
        note(
          "Morning all,",
          "We have 40 minutes on Friday and three projects that could fill it. I would rather show two properly than three in a hurry. Who wants a slot?",
          "Theo"
        ),
        { to: [STUDIO] }
      ),
      mail(
        INES,
        2 * HOUR + 50,
        note(
          "I can show the Tidewater illustrations. They are far enough along that feedback would still change them."
        ),
        { cc: [MAYA_WORK], to: [STUDIO] }
      ),
      mail(
        MAYA_WORK,
        2 * HOUR + 40,
        note(
          "Put me down for Harbor Coffee. Round two went to the client this week, so I can show what changed and why."
        ),
        { to: [STUDIO] }
      ),
      mail(
        THEO,
        52,
        note(
          "Settled: Ines first, then Maya, twenty minutes each. Sofia has the room booked from 15:00.",
          "Please keep slides to a minimum and show the real work."
        ),
        { isUnread: true, to: [STUDIO] }
      ),
    ]
  ),
  thread(
    "Moodboard for the Tidewater shoot",
    [INBOX, "Clients"],
    [
      mail(
        INES,
        2 * HOUR,
        note(
          "Maya, here is the board I mentioned. I pulled the colours from the coastline photos Priya sent, then pushed them a little towards dusk.",
          "The top row is for the product shots, the bottom row for the people. Tell me if the clay is too close to Harbor Coffee."
        ),
        { attachments: [png("tidewater-moodboard.png", demoSwatchBoard())] }
      ),
    ]
  ),
  thread(
    "Design review moved to Thursday 10:00",
    [INBOX],
    [
      mail(
        SOFIA,
        4 * HOUR,
        note(
          "Hi all,",
          "The client can not make Wednesday, so the design review moves to <b>Thursday at 10:00</b> in the big room. Same agenda, same people.",
          "I have updated the calendar invitation. Let me know today if Thursday does not work for you.",
          "Sofia"
        ),
        { to: [STUDIO] }
      ),
    ]
  ),
  thread(
    "Type Notes, issue 48: the quiet return of the serif",
    [INBOX],
    [
      mail(
        TYPE_NOTES,
        5 * HOUR,
        sheet(
          "#8a5a2b",
          [
            eyebrow("Type Notes · Issue 48", "#8a5a2b"),
            heading("The quiet return of the serif"),
            "<p>For ten years every new brand looked for the same clean, round sans. This season the brands we admire are doing something else: a sturdy serif for the name, set large and left alone.</p>",
            "<p>It is not nostalgia. A serif holds its shape at small sizes on a phone, and it gives a young company the one thing it can not buy, which is the look of having been around.</p>",
            '<h2 style="font-size:16px;margin:22px 0 8px;color:#111827">Three things worth your time</h2>',
            '<ul style="padding-left:20px;margin:0"><li>A foundry that publishes its kerning tables, and why that is generous.</li><li>How one bakery drew its own numerals for the price tags.</li><li>A short essay on why headlines got shorter.</li></ul>',
            smallPrint(
              "You are receiving Type Notes because you subscribed at quillandstem.example."
            ),
          ].join("")
        ),
        { isUnread: true }
      ),
    ]
  ),
  thread(
    "[fernhill/site] Fix hero image crop on small screens (#212)",
    [INBOX],
    [
      mail(
        CODEBERTH,
        7 * HOUR,
        note(
          "<b>noor-haddad</b> opened a pull request in <b>fernhill/site</b>.",
          "The hero image was cropped to its centre below 480 pixels, which cut the product out of three case studies. This sets a focal point for each image and adds one for the two that needed it.",
          "<code>3 files changed, 41 additions, 12 deletions</code>",
          "You are receiving this because your review was requested."
        )
      ),
    ]
  ),
  thread(
    "Quick question about the logo files",
    [INBOX],
    [
      mail(
        MAREK,
        DAY + 2 * HOUR,
        note(
          "Hello Maya,",
          "We are setting up the Harbor Coffee bags. The file we have is RGB, and the clay colour shifts a lot when we convert it. Do you have spot colour references for the palette?",
          "Marek, Halden Print"
        )
      ),
      mail(
        MAYA_WORK,
        DAY,
        note(
          "Hi Marek, yes. I will send the spot references with the final files once the client signs off, which should be this week. Please do not convert the current file, it is only a proof."
        )
      ),
      mail(
        MAREK,
        22 * HOUR,
        note("Perfect, we will wait for the final files. Thank you.")
      ),
    ]
  ),
  thread(
    "Your export is ready",
    [INBOX],
    [
      mail(
        CANVASLY,
        DAY + 6 * HOUR,
        sheet(
          "#4f46e5",
          [
            heading("Your export is ready"),
            "<p>The export of <b>Harbor Coffee, packaging v2</b> has finished. It includes 14 artboards as print-ready PDF.</p>",
            rows([
              ["Project", "Harbor Coffee, packaging v2"],
              ["Format", "PDF, CMYK"],
              ["Size", "38.2 MB"],
            ]),
            smallPrint("The download link stays valid for seven days."),
          ].join("")
        )
      ),
    ]
  ),
  thread(
    "Application: senior brand designer",
    [INBOX, "Hiring"],
    [
      mail(
        AIKO,
        2 * DAY,
        note(
          "Dear Maya,",
          "I am writing about the senior brand designer role. For the past six years I have led identity work at a small studio in Osaka, most recently a full rebrand for a regional railway, from the wordmark to the station signage.",
          "My portfolio is attached. The railway project starts on page 9 and is the one I would most like to talk about.",
          "Kind regards,<br>Aiko Tanabe"
        ),
        {
          attachments: [
            pdf("Aiko-Tanabe-Portfolio.pdf", "Aiko Tanabe", [
              "Selected identity work, 2020 to 2026",
              "Kansai Coast Railway: wordmark, wayfinding, livery",
              "Hoshino Tea: packaging system",
              "Minato Museum: exhibition identity",
            ]),
          ],
          isStarred: true,
        }
      ),
    ]
  ),
  thread(
    "Welcome to the team, Noor!",
    [INBOX],
    [
      mail(
        THEO,
        3 * DAY,
        note(
          "Everyone, please welcome Noor Haddad, who joins us today as a design engineer. Noor spent the last four years building design systems and will be taking over the studio site.",
          "Lunch is on the studio on Thursday. Come and say hello."
        ),
        { to: [STUDIO] }
      ),
      mail(
        NOOR,
        3 * DAY - HOUR,
        note(
          "Thank you, Theo. I am glad to be here. I have already found three things on the site I want to fix, so expect pull requests."
        ),
        { to: [STUDIO] }
      ),
      mail(
        MAYA_WORK,
        3 * DAY - 2 * HOUR,
        note(
          "Welcome, Noor! The hero image on mobile has been bothering me for a year."
        ),
        { to: [STUDIO] }
      ),
    ]
  ),
  thread(
    "Feedback on the onboarding illustrations",
    [INBOX],
    [
      mail(
        INES,
        5 * DAY,
        note(
          "Could you look at the five onboarding illustrations before I colour them? I am not sure the third one says <i>invite your team</i> without its caption."
        )
      ),
      mail(
        MAYA_WORK,
        5 * DAY - HOUR,
        note(
          "One, two and five are lovely. Three needs more than one person in it: right now it reads as someone waving goodbye. Four is fine but the phone is very large."
        )
      ),
      mail(
        INES,
        5 * DAY - 3 * HOUR,
        note("Waving goodbye, yes, I can not unsee it. New sketch tomorrow.")
      ),
    ]
  ),
  thread(
    "Podcast interview next month?",
    [INBOX],
    [
      mail(
        LEO,
        6 * DAY,
        note(
          "Hi Maya,",
          "I host Shape Notes, a podcast about how design studios actually work. Your talk on naming projects was the best thing I saw at the conference, and I would love to have you on for an hour.",
          "We record remotely, usually on Tuesday afternoons. Would any Tuesday next month suit you?",
          "Leo"
        )
      ),
    ]
  ),
  thread(
    "Invoice 2026-014",
    [HARBOR],
    [
      mail(
        MAYA_WORK,
        7 * DAY,
        note(
          "Hello,",
          "Please find attached invoice 2026-014 for the first phase of the rebrand. Payment terms are 30 days, as agreed.",
          "Maya Lindqvist<br>Fernhill Studio"
        ),
        {
          attachments: [
            pdf("Invoice-2026-014.pdf", "Invoice 2026-014", [
              "Fernhill Studio to Harbor Coffee Roasters",
              "Rebrand, phase one: research and direction",
              "Amount due: 8,400.00",
              "Terms: net 30",
            ]),
          ],
          to: [HARBOR_ACCOUNTS],
        }
      ),
      mail(
        HARBOR_ACCOUNTS,
        6 * DAY,
        note(
          "Received with thanks. The invoice is approved and will be paid in this week's run."
        )
      ),
    ]
  ),
  thread(
    "Proposal: Tidewater spring campaign",
    [],
    [
      mail(
        MAYA_WORK,
        9 * DAY,
        note(
          "Hi Priya,",
          "As promised, the proposal for the spring campaign is attached. It covers the campaign mark, direction for the shoot, and a launch kit your team can use without us.",
          "I have kept the timeline to twelve weeks. Happy to walk you through it whenever suits.",
          "Maya"
        ),
        {
          attachments: [
            pdf("Tidewater-Spring-Proposal.pdf", "Tidewater spring campaign", [
              "A proposal from Fernhill Studio",
              "Weeks 1 to 3: research and campaign mark",
              "Weeks 4 to 8: photography direction and shoot",
              "Weeks 9 to 12: launch kit and handover",
            ]),
          ],
          to: [PRIYA],
        }
      ),
    ]
  ),
  thread(
    "Receipt for Fernhill Studio, November",
    ["Receipts"],
    [
      mail(
        INKWELL,
        4 * DAY,
        sheet(
          "#0f766e",
          [
            heading("Receipt"),
            "<p>Thank you. Here is your receipt for November.</p>",
            rows([
              ["Plan", "Inkwell Studio, 6 seats"],
              ["Period", "1 to 30 November"],
              ["Total", "€84.00"],
            ]),
            smallPrint("Inkwell, the font library for small studios."),
          ].join("")
        )
      ),
    ]
  ),
  thread(
    "Receipt for Canvasly Team, annual plan",
    ["Receipts"],
    [
      mail(
        CANVASLY,
        20 * DAY,
        sheet(
          "#4f46e5",
          [
            heading("Thanks for renewing"),
            "<p>Your Canvasly Team plan has been renewed for another year.</p>",
            rows([
              ["Plan", "Canvasly Team, 6 editors"],
              ["Renews", "5 November 2027"],
              ["Total", "€1,152.00"],
            ]),
          ].join("")
        )
      ),
    ]
  ),
  thread(
    "Offsite logistics: final headcount",
    [ARCHIVE],
    [
      mail(
        SOFIA,
        10 * DAY,
        note(
          "Final numbers for the offsite: eleven of us, two cars, and the house is booked from Thursday to Saturday. I will send the room list on Monday.",
          "If you have a dietary need I do not already know about, tell me this week."
        ),
        { to: [STUDIO] }
      ),
    ]
  ),
  thread(
    "You have been selected for a design award",
    [JUNK],
    [
      mail(
        AWARDS,
        9 * HOUR,
        note(
          "CONGRATULATIONS!!!",
          "Your studio has been selected as a WINNER of the Global Design Awards. To claim your trophy and certificate, confirm your details and pay the handling fee within 24 hours."
        ),
        { isUnread: true }
      ),
    ]
  ),
  thread(
    "Your lunch order is on its way",
    [TRASH],
    [
      mail(
        CORNER_DELI,
        2 * DAY + HOUR,
        note(
          "Your order is on its way and should arrive in about 15 minutes.",
          "1 × roasted squash sandwich<br>1 × lentil soup<br>1 × sparkling water"
        )
      ),
    ]
  ),
];

// --------------------------------------------------------------- personal
//
// The same person's other three addresses: everyday mail on Gmail, family
// on iCloud, and housing and paperwork on Outlook.

const MAYA_GMAIL: Person = {
  address: "maya.lindqvist@gmail.example",
  name: "Maya Lindqvist",
};

const MAYA_ICLOUD: Person = {
  address: "maya.lindqvist@icloud.example",
  name: "Maya Lindqvist",
};

const MAYA_OUTLOOK: Person = {
  address: "maya.lindqvist@outlook.example",
  name: "Maya Lindqvist",
};

const ELIN: Person = {
  address: "elin@lindqvist.example",
  name: "Elin Lindqvist",
};

const KARIN: Person = {
  address: "karin@lindqvist.example",
  name: "Karin Lindqvist",
};

const KASPER: Person = { address: "kasper@holm.example", name: "Kasper Holm" };
const TOVE: Person = { address: "tove@berg.example", name: "Tove Berg" };

const HANNA: Person = {
  address: "hanna@bryggahomes.example",
  name: "Hanna Vik",
};

const NORDWIND: Person = {
  address: "bookings@nordwindair.example",
  name: "Nordwind Air",
};

const CASA: Person = {
  address: "stay@casadolargo.example",
  name: "Casa do Largo",
};

const FJORD_PINE: Person = {
  address: "orders@fjordandpine.example",
  name: "Fjord & Pine",
};

const KETTLE: Person = {
  address: "receipts@kettlebooks.example",
  name: "Kettle Books",
};

const LONG_READ: Person = {
  address: "hello@sundaylongread.example",
  name: "The Sunday Long Read",
};

const NORTHLIGHT: Person = {
  address: "billing@northlight.example",
  name: "Northlight Energy",
};

const ALMSBANK: Person = {
  address: "statements@almsbank.example",
  name: "Almsbank",
};

const STILLWATER: Person = {
  address: "hello@stillwateryoga.example",
  name: "Stillwater Yoga",
};

const LIBRARY: Person = {
  address: "notices@citylibrary.example",
  name: "City Library",
};

const PARCEL: Person = {
  address: "delivery@parcel-verify.example",
  name: "Parcel Service",
};

const WINTERLINE: Person = {
  address: "news@winterline.example",
  name: "Winterline",
};

const SWIM_CLUB: Person = {
  address: "members@havsbadet.example",
  name: "Havsbadet Swim Club",
};

const TRYGGVIA: Person = {
  address: "service@tryggvia.example",
  name: "Tryggvia Insurance",
};

const OLAF: Person = {
  address: "olaf@berntsen.example",
  name: "Olaf Berntsen",
};

const BRYGGA: Person = {
  address: "rent@bryggahomes.example",
  name: "Brygga Homes",
};

const MAILBOX_ALERT: Person = {
  address: "security@mailbox-alert.example",
  name: "Mail Administrator",
};

const gmailThreads = (): readonly DemoThread[] => [
  thread(
    "Your trip to Lisbon is confirmed",
    [INBOX, "Travel"],
    [
      mail(
        NORDWIND,
        3 * HOUR,
        sheet(
          "#1d4ed8",
          [
            eyebrow("Booking reference KX4T9P", "#1d4ed8"),
            heading("You are going to Lisbon"),
            "<p>Thank you for flying with Nordwind Air. Your booking is confirmed and your itinerary is attached.</p>",
            rows([
              ["Outbound", "Fri 12 Dec · 07:45 → 11:10"],
              ["Return", "Tue 16 Dec · 18:30 → 23:40"],
              ["Passenger", "Maya Lindqvist"],
              ["Seat", "14A, window"],
              ["Bags", "1 cabin bag, 1 checked bag"],
            ]),
            "<p>Online check-in opens 36 hours before departure.</p>",
            smallPrint("Nordwind Air. Please do not reply to this message."),
          ].join("")
        ),
        {
          attachments: [
            pdf("Nordwind-Itinerary-KX4T9P.pdf", "Itinerary KX4T9P", [
              "Passenger: Maya Lindqvist",
              "Fri 12 Dec  NW 482  07:45 to 11:10  seat 14A",
              "Tue 16 Dec  NW 487  18:30 to 23:40  seat 9C",
              "1 cabin bag and 1 checked bag included",
            ]),
          ],
          isImportant: true,
          isStarred: true,
        }
      ),
    ]
  ),
  thread(
    "Booking confirmed: 12 to 16 December",
    [INBOX, "Travel"],
    [
      mail(
        CASA,
        3 * HOUR + 10,
        sheet(
          "#b45309",
          [
            heading("We look forward to welcoming you"),
            "<p>Dear Maya, your room at Casa do Largo is reserved.</p>",
            rows([
              ["Room", "Courtyard double"],
              ["Check-in", "Fri 12 December, from 15:00"],
              ["Check-out", "Tue 16 December, by 11:00"],
              ["Breakfast", "Included"],
            ]),
            "<p>We are a ten minute walk from the Baixa-Chiado station. If you arrive before 15:00, we are happy to keep your bags.</p>",
          ].join("")
        )
      ),
    ]
  ),
  thread(
    "Photos from the hike",
    [INBOX],
    [
      mail(
        KASPER,
        DAY,
        note(
          "Finally went through the photos from the ridge. This is the one from just before sunrise, when you said it was too cold to stop.",
          "It was worth stopping."
        ),
        { attachments: [png("ridge-at-dawn.png", demoLandscape())] }
      ),
      mail(
        MAYA_GMAIL,
        22 * HOUR,
        note(
          "It was worth stopping. Can I have this one printed? It would look good above the desk."
        )
      ),
      mail(
        KASPER,
        21 * HOUR,
        note("Of course. I will send you the full-size file tonight.")
      ),
    ]
  ),
  thread(
    "Your order has shipped",
    [INBOX, "Receipts"],
    [
      mail(
        FJORD_PINE,
        DAY + 3 * HOUR,
        sheet(
          "#166534",
          [
            heading("Your order is on its way"),
            "<p>Good news: order <b>FP-20418</b> left our workshop this morning.</p>",
            rows([
              ["Oak desk shelf, 60 cm", "€64.00"],
              ["Linen desk mat, sand", "€29.00"],
              ["Shipping", "€6.00"],
              ["Total", "€99.00"],
            ]),
            "<p>Delivery usually takes two to four working days.</p>",
            smallPrint("Fjord &amp; Pine, furniture made in small batches."),
          ].join("")
        )
      ),
    ]
  ),
  thread(
    "The Sunday Long Read: what the tide leaves behind",
    [INBOX],
    [
      mail(
        LONG_READ,
        2 * DAY,
        sheet(
          "#0e7490",
          [
            eyebrow("The Sunday Long Read", "#0e7490"),
            heading("What the tide leaves behind"),
            "<p>On a beach in the far north, a retired schoolteacher has spent eleven winters writing down everything the sea returns. Rope, mostly. But also a piano key, a child's boot, and once a bottle with a letter that turned out to be an advertisement.</p>",
            "<p>This week's essay is about her notebooks, and about the odd comfort of keeping a list of things nobody asked you to count.</p>",
            '<p style="margin-top:18px"><b>Also this week:</b> the last ferry timetable printed on paper, and a recipe for the soup we keep mentioning.</p>',
            smallPrint("One essay, every Sunday morning."),
          ].join("")
        ),
        { isUnread: true }
      ),
    ]
  ),
  thread(
    "Book club: the November pick",
    [INBOX],
    [
      mail(
        TOVE,
        5 * DAY,
        note(
          "The votes are in and November's book is <i>The Summer Book</i>. It is short, so no excuses this time.",
          "We meet on the last Wednesday at mine. I will make the cardamom buns if somebody brings wine."
        )
      ),
      mail(
        MAYA_GMAIL,
        5 * DAY - 2 * HOUR,
        note(
          "I have read it twice already and will happily read it again. I will bring wine."
        )
      ),
    ]
  ),
  thread(
    "Receipt from Kettle Books",
    ["Receipts"],
    [
      mail(
        KETTLE,
        8 * DAY,
        sheet(
          "#9f1239",
          [
            heading("Thank you for your order"),
            rows([
              ["The Summer Book", "€12.50"],
              ["A Field Guide to Getting Lost", "€14.00"],
              ["Total", "€26.50"],
            ]),
            smallPrint("Kettle Books, an independent bookshop."),
          ].join("")
        )
      ),
    ]
  ),
  thread(
    "Lisbon dates",
    [],
    [
      mail(
        MAYA_GMAIL,
        9 * DAY,
        note(
          "I am looking at the 12th to the 16th of December for Lisbon. Does that still work for you, or is it too close to the holidays?"
        ),
        { to: [ELIN] }
      ),
    ]
  ),
  thread(
    "Action needed: your parcel is waiting",
    [JUNK],
    [
      mail(
        PARCEL,
        12 * HOUR,
        note(
          "We tried to deliver your parcel but the address could not be confirmed.",
          "Verify your details and pay the redelivery fee within 12 hours or your parcel will be returned to the sender."
        ),
        { isUnread: true }
      ),
    ]
  ),
  thread(
    "Last chance: 20% off winter coats",
    [TRASH],
    [
      mail(
        WINTERLINE,
        3 * DAY + 4 * HOUR,
        note(
          "The winter sale ends at midnight. Take 20% off every coat in the collection while your size is still in stock."
        )
      ),
    ]
  ),
];

const icloudThreads = (): readonly DemoThread[] => [
  thread(
    "Dinner on Saturday?",
    [INBOX, "Family"],
    [
      mail(
        ELIN,
        5 * HOUR,
        note(
          "Are you free on Saturday? Mamma is in town and I thought we could cook at mine. Nothing fancy."
        )
      ),
      mail(
        MAYA_ICLOUD,
        4 * HOUR,
        note(
          "Yes! I can bring dessert. What time, and should I pick Mamma up on the way?"
        )
      ),
      mail(
        ELIN,
        40,
        note(
          "Seven is perfect. And yes please, her train gets in at 18:20, platform 4.",
          "Bring the lemon thing you made in the summer."
        ),
        { isUnread: true }
      ),
    ]
  ),
  thread(
    "Thursday class moves to 18:30",
    [INBOX],
    [
      mail(
        STILLWATER,
        9 * HOUR,
        note(
          "Hello everyone,",
          "This Thursday's evening class starts at <b>18:30</b>, half an hour later than usual, while the studio floor is being oiled. Your booking moves with it, so there is nothing you need to do."
        )
      ),
    ]
  ),
  thread(
    "Two loans are due on Friday",
    [INBOX],
    [
      mail(
        LIBRARY,
        DAY + 8 * HOUR,
        note(
          "Two of your loans are due back on Friday:",
          "<i>The Living Mountain</i><br><i>A Field Guide to Getting Lost</i>",
          "You can renew both once from your account, unless another reader is waiting."
        ),
        { isUnread: true }
      ),
    ]
  ),
  thread(
    "Recipe you asked for",
    [INBOX, "Family"],
    [
      mail(
        KARIN,
        6 * DAY,
        note(
          "Here it is, as your grandmother wrote it, so the amounts are approximate.",
          "<b>Lemon cake</b><br>3 eggs<br>a coffee cup of sugar<br>a coffee cup and a half of flour<br>the zest and juice of two lemons<br>butter, about as much as feels right",
          "Bake until it smells done. Do not open the oven before then.",
          "Kram,<br>Mamma"
        ),
        { isStarred: true }
      ),
    ]
  ),
  thread(
    "Pappa turns 70: the plan",
    [INBOX, "Family"],
    [
      mail(
        ELIN,
        DAY + 4 * HOUR,
        note(
          "So, the plan for Pappa's birthday. I have booked the long table at the boathouse for the 14th, twelve of us. He thinks we are going for a walk.",
          "Mamma is doing the cake. I need one of you to sort the music and one to get him there without him guessing."
        ),
        { cc: [KARIN] }
      ),
      mail(
        KARIN,
        DAY + 3 * HOUR,
        note(
          "I will make the almond cake, he would notice if it were anything else. Maya, you are the only one he believes, so you bring him."
        ),
        { cc: [ELIN] }
      ),
      mail(
        MAYA_ICLOUD,
        DAY + 2 * HOUR,
        note(
          "I will tell him I need help carrying something from the boathouse. He can not say no to carrying things. Elin, you have the music then."
        ),
        { cc: [KARIN], to: [ELIN] }
      ),
    ]
  ),
  thread(
    "Winter timetable from Monday",
    [INBOX],
    [
      mail(
        SWIM_CLUB,
        2 * DAY + 2 * HOUR,
        note(
          "Dear members,",
          "The winter timetable starts on Monday. Morning lanes open at <b>06:30</b>, and the Wednesday evening session moves to the 25 metre pool while the outdoor one is closed.",
          "The sauna is open after every session until the end of March."
        )
      ),
    ]
  ),
];

const outlookThreads = (): readonly DemoThread[] => [
  thread(
    "Viewing on Thursday at 17:30",
    [INBOX, "Housing"],
    [
      mail(
        HANNA,
        7 * HOUR,
        note(
          "Hello Maya,",
          "I can confirm your viewing of the two-room flat on Kaigata 14 this <b>Thursday at 17:30</b>. Ring the bell marked 3B and I will come down.",
          "The current tenant will be home, so we have about twenty minutes.",
          "Hanna Vik<br>Brygga Homes"
        ),
        { isUnread: true }
      ),
    ]
  ),
  thread(
    "Your electricity bill for October",
    ["Bills"],
    [
      mail(
        NORTHLIGHT,
        3 * DAY,
        sheet(
          "#ca8a04",
          [
            heading("Your bill for October"),
            "<p>Your bill is ready and will be paid by direct debit on the 28th.</p>",
            rows([
              ["Usage", "186 kWh"],
              ["Compared with September", "12% lower"],
              ["Amount", "€41.70"],
            ]),
          ].join("")
        ),
        {
          attachments: [
            pdf("Northlight-October.pdf", "Northlight Energy", [
              "Bill for October",
              "Usage: 186 kWh",
              "Amount due: 41.70, by direct debit on the 28th",
            ]),
          ],
        }
      ),
    ]
  ),
  thread(
    "Your November statement is ready",
    [INBOX],
    [
      mail(
        ALMSBANK,
        4 * DAY,
        note(
          "Your statement for November is ready to view in online banking.",
          "For your security we never include account details in email, and we will never ask you for your password."
        )
      ),
    ]
  ),
  thread(
    "Your home insurance renews on 1 January",
    [INBOX, "Bills"],
    [
      mail(
        TRYGGVIA,
        2 * HOUR + 30,
        sheet(
          "#0369a1",
          [
            heading("Your renewal is ready"),
            "<p>Your home insurance renews on 1 January. Nothing changes unless you tell us, and your documents for the new year are attached.</p>",
            rows([
              ["Policy", "Home contents, standard"],
              ["Period", "1 January to 31 December"],
              ["Premium", "€148.00 a year"],
            ]),
            smallPrint(
              "Tryggvia Insurance. You can change or cancel until 15 December."
            ),
          ].join("")
        ),
        {
          attachments: [
            pdf("Tryggvia-Renewal-2027.pdf", "Tryggvia Insurance", [
              "Home contents insurance, renewal",
              "Period: 1 January to 31 December",
              "Premium: 148.00 a year, paid by direct debit",
            ]),
          ],
          isUnread: true,
        }
      ),
    ]
  ),
  thread(
    "Papers for the tax return",
    [INBOX],
    [
      mail(
        MAYA_OUTLOOK,
        2 * DAY + 5 * HOUR,
        note(
          "Hello Olaf,",
          "I have uploaded the rent receipts and the two donation letters. The statement from the pension fund has not arrived yet, so I will send that on as soon as it does.",
          "Maya"
        )
      ),
      mail(
        OLAF,
        2 * DAY,
        note(
          "Thank you, Maya, everything arrived. The pension statement can wait until January. I will have a draft for you to look at before the holidays.",
          "Olaf Berntsen"
        ),
        { isStarred: true }
      ),
    ]
  ),
  thread(
    "Rent receipt for November",
    ["Housing"],
    [
      mail(
        BRYGGA,
        6 * DAY,
        note(
          "We have received your rent for November. Thank you.",
          "Amount: €1,180.00<br>Reference: KAI-14-3B-1126",
          "Brygga Homes"
        )
      ),
    ]
  ),
  thread(
    "Your mailbox is almost full",
    [JUNK],
    [
      mail(
        MAILBOX_ALERT,
        14 * HOUR,
        note(
          "Your mailbox has reached 98% of its storage.",
          "Confirm your password within 24 hours to keep receiving mail, or your account will be suspended."
        ),
        { isUnread: true }
      ),
    ]
  ),
];

/** Where one provider keeps mail, and what it does with mail it is sent. */
interface ProviderLayout {
  readonly dialect: "generic" | "gmail";
  /** Whether the provider files sent mail itself; see `SENT_COPY_FILER`. */
  readonly filesSentMail: boolean;
  readonly folders: readonly DemoFolder[];
  /** The provider's own names for the places a thread is filed by role. */
  readonly places: Readonly<Record<Place, string>>;
}

const GMAIL_ALL_MAIL = "[Gmail]/All Mail";

const PROVIDERS = {
  gmail: {
    dialect: "gmail",
    filesSentMail: true,
    folders: [
      { path: INBOX },
      { path: "[Gmail]", selectable: false },
      { path: GMAIL_ALL_MAIL, specialUse: "\\All" },
      { path: "[Gmail]/Drafts", specialUse: "\\Drafts" },
      { path: "[Gmail]/Important", specialUse: "\\Important" },
      { path: "[Gmail]/Sent Mail", specialUse: "\\Sent" },
      { path: "[Gmail]/Spam", specialUse: "\\Junk" },
      { path: "[Gmail]/Starred", specialUse: "\\Flagged" },
      { path: "[Gmail]/Trash", specialUse: "\\Trash" },
    ],
    places: {
      [ARCHIVE]: GMAIL_ALL_MAIL,
      [JUNK]: "[Gmail]/Spam",
      [SENT]: GMAIL_ALL_MAIL,
      [TRASH]: "[Gmail]/Trash",
    },
  },
  icloud: {
    dialect: "generic",
    filesSentMail: false,
    folders: [
      { path: INBOX },
      { path: "Sent Messages", specialUse: "\\Sent" },
      { path: "Drafts", specialUse: "\\Drafts" },
      { path: "Archive", specialUse: "\\Archive" },
      { path: "Junk", specialUse: "\\Junk" },
      { path: "Deleted Messages", specialUse: "\\Trash" },
    ],
    places: {
      [ARCHIVE]: "Archive",
      [JUNK]: "Junk",
      [SENT]: "Sent Messages",
      [TRASH]: "Deleted Messages",
    },
  },
  imap: {
    dialect: "generic",
    filesSentMail: false,
    folders: [
      { path: INBOX },
      { path: "Sent", specialUse: "\\Sent" },
      { path: "Drafts", specialUse: "\\Drafts" },
      { path: "Archive", specialUse: "\\Archive" },
      { path: "Junk", specialUse: "\\Junk" },
      { path: "Trash", specialUse: "\\Trash" },
    ],
    places: {
      [ARCHIVE]: "Archive",
      [JUNK]: "Junk",
      [SENT]: "Sent",
      [TRASH]: "Trash",
    },
  },
  outlook: {
    dialect: "generic",
    filesSentMail: true,
    folders: [
      { path: INBOX },
      { path: "Sent Items", specialUse: "\\Sent" },
      { path: "Drafts", specialUse: "\\Drafts" },
      { path: "Archive", specialUse: "\\Archive" },
      { path: "Junk Email", specialUse: "\\Junk" },
      { path: "Deleted Items", specialUse: "\\Trash" },
    ],
    places: {
      [ARCHIVE]: "Archive",
      [JUNK]: "Junk Email",
      [SENT]: "Sent Items",
      [TRASH]: "Deleted Items",
    },
  },
} as const satisfies Record<DemoAccount["provider"], ProviderLayout>;

const account = (
  provider: DemoAccount["provider"],
  owner: Person,
  labels: readonly string[],
  threads: () => readonly DemoThread[]
): DemoAccount => ({
  accountId: AccountId.make(owner.address),
  dialect: PROVIDERS[provider].dialect,
  displayName: owner.name,
  email: owner.address,
  folders: [
    ...PROVIDERS[provider].folders,
    ...labels.map((path) => ({ path })),
  ],
  host: `mail.${domainOf(owner.address)}`,
  provider,
  threads,
});

/** One account on each provider Kisa connects to. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  account(
    "imap",
    MAYA_WORK,
    ["Clients", HARBOR, "Hiring", "Receipts"],
    workThreads
  ),
  account("gmail", MAYA_GMAIL, ["Receipts", "Travel"], gmailThreads),
  account("icloud", MAYA_ICLOUD, ["Family"], icloudThreads),
  account("outlook", MAYA_OUTLOOK, ["Bills", "Housing"], outlookThreads),
];

interface Delivery {
  readonly flags: readonly string[];
  readonly gmailLabels?: readonly string[];
  readonly gmailThreadId?: string;
  readonly path: string;
  readonly raw: Uint8Array;
  readonly sentAt: number;
}

const isPlace = (folder: string): folder is Place =>
  folder === ARCHIVE || folder === JUNK || folder === SENT || folder === TRASH;

/**
 * Where a message is filed. A folder server keeps a copy in each folder.
 * Gmail keeps one, in Spam, Trash or else All Mail, and the other folders
 * are the labels it carries.
 */
const filingsOf = (
  layout: ProviderLayout,
  folders: readonly string[],
  message: DemoMessage,
  isOwn: boolean
): readonly Pick<Delivery, "gmailLabels" | "path">[] => {
  const filed = isOwn ? [SENT] : folders;

  if (layout.dialect !== "gmail") {
    return filed.map((folder) => ({
      path: isPlace(folder) ? layout.places[folder] : folder,
    }));
  }

  const held =
    filed.find((folder) => folder === JUNK || folder === TRASH) ?? ARCHIVE;

  return [
    {
      gmailLabels: [
        ...(isOwn ? ["\\Sent"] : []),
        ...(message.isImportant === true ? ["\\Important"] : []),
        ...filed.flatMap((folder) => {
          if (folder === INBOX) {
            return ["\\Inbox"];
          }

          return isPlace(folder) ? [] : [folder];
        }),
      ],
      path: layout.places[held],
    },
  ];
};

/** Every copy of a thread's messages, with the folder each is filed in. */
const deliveriesOf = (
  owner: DemoAccount,
  conversation: DemoThread,
  index: number,
  now: number
): readonly Delivery[] => {
  const layout: ProviderLayout = PROVIDERS[owner.provider];
  const self: Person = { address: owner.email, name: owner.displayName };

  const otherSide = conversation.messages.find(
    (message) => message.from.address !== owner.email
  )?.from;

  const earlier: string[] = [];
  const deliveries: Delivery[] = [];

  for (const [position, message] of conversation.messages.entries()) {
    const isOwn = message.from.address === owner.email;
    const sentAt = now - message.minutesAgo * 60_000;
    const messageId = `demo-${index + 1}-${position + 1}@${domainOf(message.from.address)}`;
    const replyTo = otherSide === undefined ? [] : [otherSide];

    const raw = composeMessage({
      attachments: message.attachments ?? [],
      bcc: [],
      body: { html: message.html, text: toIndexText(message.html) },
      cc: message.cc ?? [],
      date: new Date(sentAt),
      from: message.from,
      inReplyTo: earlier.at(-1),
      messageId,
      references: [...earlier],
      subject:
        position === 0 ? conversation.subject : `Re: ${conversation.subject}`,
      to: message.to ?? (isOwn ? replyTo : [self]),
    }).sentCopy;

    const flags = [
      ...(message.isUnread === true ? [] : ["\\Seen"]),
      ...(message.isStarred === true ? ["\\Flagged"] : []),
    ];

    for (const filing of filingsOf(
      layout,
      conversation.folders,
      message,
      isOwn
    )) {
      deliveries.push({
        ...filing,
        flags,
        // Gmail threads by its own id, which every message of a
        // conversation shares.
        gmailThreadId: String(GMAIL_THREAD_BASE + BigInt(index)),
        raw,
        sentAt,
      });
    }

    earlier.push(messageId);
  }

  return deliveries;
};

/**
 * One mail server per demo account, holding its mail as of `now`. Mail is
 * filed oldest first, so UIDs rise with time as they do on a server.
 */
export const createDemoMailServers = (
  now: number
): ReadonlyMap<string, DemoMailServer> =>
  new Map(
    DEMO_ACCOUNTS.map((owner) => {
      const layout: ProviderLayout = PROVIDERS[owner.provider];

      const server = makeDemoMailServer({
        accountId: owner.accountId,
        filesSentMail: layout.filesSentMail,
        folders: owner.folders,
        isGmail: layout.dialect === "gmail",
      });

      const deliveries = owner
        .threads()
        .flatMap((conversation, index) =>
          deliveriesOf(owner, conversation, index, now)
        )
        .toSorted((left, right) => left.sentAt - right.sentAt);

      for (const { path, raw, sentAt, ...filing } of deliveries) {
        server.deliver(path, raw, { ...filing, internalDate: sentAt });
      }

      return [owner.accountId, server] as const;
    })
  );
