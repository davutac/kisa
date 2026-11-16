import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MailThreadItem from "../src/renderer/src/components/mail/thread-item";
import { calendarStore } from "../src/renderer/src/hooks/use-calendar";
import { formatMailDate } from "../src/renderer/src/mail/mail-date";
import { GmailLabelsProvider } from "../src/renderer/src/state/gmail-labels";
import type { GmailThreadSummary } from "../src/shared/ipc/mail";

const thread: GmailThreadSummary = {
  accountId: "person@example.com",
  attachments: [],
  from: "Ada Lovelace <ada@example.com>",
  hasAttachments: false,
  isUnread: false,
  labels: ["INBOX"],
  latestAt: new Date(2026, 0, 2, 9, 30).getTime(),
  messageCount: 3,
  snippet: "Notes on the engine",
  subject: "Analytical engine",
  threadId: "thread-1",
};

const renderRow = (
  overrides: Partial<GmailThreadSummary>,
  mailboxLabel?: string
): string =>
  renderToString(
    <GmailLabelsProvider accountIds={[]}>
      <MailThreadItem
        mailboxLabel={mailboxLabel}
        onOpen={vi.fn<() => void>()}
        onRowPointerDown={vi.fn<() => void>()}
        onSelectionPointerDown={vi.fn<() => void>()}
        onSelectionPointerEnter={vi.fn<() => void>()}
        onToggleSelection={vi.fn<() => void>()}
        position={1}
        setSize={1}
        thread={{ ...thread, ...overrides }}
        top={0}
      />
    </GmailLabelsProvider>
  );

const getRowLabel = (markup: string): string | undefined =>
  markup.match(/<button[^>]*aria-label="(?<label>Analytical[^"]*)"/u)?.groups
    ?.label;

const getTitleClasses = (markup: string, text: string): string | undefined =>
  markup.match(
    new RegExp(
      `<div data-slot="item-title" class="(?<classes>[^"]*)"[^>]*>${text}</div>`,
      "u"
    )
  )?.groups?.classes;

const sentAt = formatMailDate(
  thread.latestAt,
  calendarStore.getSnapshot(),
  "detailed"
);
const from = "from Ada Lovelace &lt;ada@example.com&gt;";

const hasUnreadDot = (markup: string): boolean =>
  /<span aria-hidden="true" class="[^"]*\bbg-primary\b[^"]*rounded-full/u.test(
    markup
  );

describe("mail thread row", () => {
  it("keeps read rows legible instead of fading them", () => {
    const markup = renderRow({ isUnread: false });

    expect({
      faded: markup.includes("opacity-60"),
      label: getRowLabel(markup),
      subject: getTitleClasses(markup, "Analytical engine"),
      unreadDot: hasUnreadDot(markup),
    }).toStrictEqual({
      faded: false,
      label: `Analytical engine, ${from}, ${sentAt}, 3 messages`,
      subject: expect.stringContaining("font-normal"),
      unreadDot: false,
    });
  });

  it("marks unread rows by weight and a dot, and announces the state", () => {
    const markup = renderRow({ isUnread: true });

    expect({
      label: getRowLabel(markup),
      subject: getTitleClasses(markup, "Analytical engine"),
      unreadDot: hasUnreadDot(markup),
    }).toStrictEqual({
      label: `Analytical engine, ${from}, ${sentAt}, unread, 3 messages`,
      subject: expect.stringContaining("font-semibold"),
      unreadDot: true,
    });
  });

  it("leaves out the label of the mailbox it is listed in", () => {
    const labels = ["INBOX", "SENT"];

    expect({
      inInbox: renderRow({ labels }, "INBOX"),
      inSearch: renderRow({ labels }),
    }).toStrictEqual({
      inInbox: expect.not.stringContaining(">Inbox<"),
      inSearch: expect.stringContaining(">Inbox<"),
    });
    expect(renderRow({ labels }, "SENT")).not.toContain("lucide-send");
    expect(renderRow({ labels }, "INBOX")).toContain("lucide-send");
  });

  it("shows the conversation size as a plain count", () => {
    const markup = renderRow({});

    expect(markup).toContain("lucide-messages-square");
    expect(markup).not.toContain("+3 messages");
    expect(renderRow({ messageCount: 1 })).not.toContain(
      "lucide-messages-square"
    );
  });
});
