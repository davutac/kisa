import { formatISO } from "date-fns";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { calendarStore } from "../src/renderer/src/hooks/use-calendar";
import { getHotkeyAriaLabel } from "../src/renderer/src/hotkeys/commands";
import {
  formatExactMailDate,
  formatMailDate,
} from "../src/renderer/src/mail/mail-date";
import ScheduledMailRow from "../src/renderer/src/routes/scheduled/-components/scheduled-mail-row";
import type { ScheduledMailSummary } from "../src/shared/ipc/scheduled-mail";
import { InMailList } from "./fixtures/mail-list";

const item: ScheduledMailSummary = {
  accountId: "person@example.com",
  attachments: [
    { filename: "image.png", mediaType: "image/png" },
    { filename: "notes.pdf", mediaType: "application/pdf" },
  ],
  deliveryState: "scheduled",
  draftId: "draft-1",
  preview: "Preview",
  recipients: ["friend@example.com"],
  revision: 1,
  scheduledAt: new Date(2030, 4, 20, 13).getTime(),
  subject: "Hello",
};

const renderRow = ({ selected = false }: { selected?: boolean }): string =>
  renderToString(
    <InMailList rowKey={`${item.accountId}\u0000${item.draftId}`}>
      <ScheduledMailRow
        item={item}
        onCancel={vi.fn<(item: ScheduledMailSummary) => void>()}
        onDiscard={vi.fn<(item: ScheduledMailSummary) => void>()}
        onOpen={vi.fn<(item: ScheduledMailSummary) => void>()}
        quickActionResetRevision={0}
        selected={selected}
        top={0}
      />
    </InMailList>
  );

describe("scheduled mail row surface", () => {
  it("uses the mailbox thread row surface with a one-pixel separator", () => {
    const markup = renderRow({});
    const listItem = markup.match(/<div[^>]*role="row"[^>]*>/u)?.[0];
    const rowSurface = markup.match(
      /<div[^>]*class="[^"]*bg-background[^"]*rounded-md[^"]*"[^>]*>/u
    )?.[0];
    const article = markup.match(/<article[^>]*>/u)?.[0];

    expect(listItem).toContain("pb-px");
    expect(rowSurface).toBeDefined();
    expect(article).toContain("data-[active=true]:bg-muted/60");
    expect(article).not.toContain("bg-card");
  });

  it("keeps idle rows legible instead of fading the whole row", () => {
    const article = renderRow({}).match(/<article[^>]*>/u)?.[0];

    expect(article).not.toContain("opacity-");
  });

  it("does not draw a focus ring or border around the activation surface", () => {
    const markup = renderRow({ selected: true });
    const activationButton = markup.match(
      /<button[^>]*aria-label="Edit scheduled email[^>]*>/u
    )?.[0];

    expect({
      hasBorder: activationButton?.includes("border"),
      hasFocusRing: activationButton?.includes("focus-visible:ring"),
    }).toStrictEqual({
      hasBorder: false,
      hasFocusRing: false,
    });
  });

  it("shows the recipient and sending account above the message content", () => {
    const markup = renderRow({});
    const content = markup.slice(markup.indexOf('data-slot="item-content"'));

    expect({
      accountBeforeSubject:
        content.indexOf(item.accountId) < content.indexOf("Hello"),
      accountTooltip: content.includes(`title="From ${item.accountId}"`),
      fromLabel: content.includes(">From</span>"),
      preview: content.includes("Preview"),
      previewIsClamped: content.includes("line-clamp-1"),
      recipientBeforeSubject:
        content.indexOf("friend@example.com") < content.indexOf("Hello"),
      toLabel: content.includes(">To</span>"),
    }).toStrictEqual({
      accountBeforeSubject: true,
      accountTooltip: true,
      fromLabel: true,
      preview: true,
      previewIsClamped: true,
      recipientBeforeSubject: true,
      toLabel: true,
    });
  });

  it("uses the standard attachment filename and type pills", () => {
    const markup = renderRow({});

    expect({
      attachmentRegion: markup.includes('aria-label="Attachments"'),
      firstFilename: markup.includes(">image.png</span>"),
      firstType: markup.includes(">PNG</span>"),
      paperclip: markup.includes("lucide-paperclip"),
      secondFilename: markup.includes(">notes.pdf</span>"),
      secondType: markup.includes(">PDF</span>"),
    }).toStrictEqual({
      attachmentRegion: true,
      firstFilename: true,
      firstType: true,
      paperclip: true,
      secondFilename: true,
      secondType: true,
    });
    expect(markup).not.toContain(">2 attachments<");
  });

  it("shows the delivery day and time with the exact local time as its tooltip label", () => {
    const markup = renderRow({});
    const scheduledTime = markup.match(/<time[^>]*>[^<]*<\/time>/u)?.[0];
    const calendar = calendarStore.getSnapshot();
    const exactLabel = `${formatExactMailDate(item.scheduledAt, calendar)} (${calendar.timeZone})`;
    const deliveryLabel = formatMailDate(
      item.scheduledAt,
      calendarStore.getSnapshot(),
      "detailed"
    );

    expect({
      deliveryLabel: scheduledTime?.includes(`>${deliveryLabel}</time>`),
      exactLabel: scheduledTime?.includes(`aria-label="${exactLabel}"`),
      isCompact: scheduledTime?.includes("text-xs"),
      machineTime: scheduledTime?.includes(
        `dateTime="${formatISO(item.scheduledAt)}"`
      ),
      tooltip: markup.includes('data-slot="tooltip-trigger"'),
    }).toStrictEqual({
      deliveryLabel: true,
      exactLabel: true,
      isCompact: true,
      machineTime: true,
      tooltip: true,
    });
    expect(markup).not.toContain("lucide-calendar-clock");
  });

  it("uncovers cancel and discard as icon-only thread-style quick actions", () => {
    const hiddenMarkup = renderRow({});
    const revealedMarkup = renderRow({ selected: true });
    const cancelButton = hiddenMarkup.match(
      /<button[^>]*aria-label="Cancel schedule[^>]*>/u
    )?.[0];
    const hiddenRail = hiddenMarkup.match(
      /<div[^>]*data-slot="mail-list-actions"[^>]*>/u
    )?.[0];
    const revealedRail = revealedMarkup.match(
      /<div[^>]*data-slot="mail-list-actions"[^>]*>/u
    )?.[0];
    const discardButton = hiddenMarkup.match(
      /<button[^>]*aria-label="Discard scheduled email[^>]*>/u
    )?.[0];

    expect({
      accessibleLabel: cancelButton?.includes(
        "Cancel schedule for Hello and move it to Stash"
      ),
      cancelAriaShortcut: cancelButton?.includes(
        `aria-keyshortcuts="${getHotkeyAriaLabel("scheduled.cancel")}"`
      ),
      discardAccessibleLabel: discardButton?.includes(
        "Discard scheduled email: Hello"
      ),
      discardAriaShortcut: discardButton?.includes(
        `aria-keyshortcuts="${getHotkeyAriaLabel("scheduled.discard")}"`
      ),
      discardTooltip: discardButton?.includes(
        'title="Discard scheduled email ('
      ),
      hasArchiveRestoreIcon: hiddenMarkup.includes("lucide-archive-restore"),
      hasSelectionCheckbox: hiddenMarkup.includes('data-slot="checkbox"'),
      hasTrashIcon: hiddenMarkup.includes("lucide-trash"),
      hasVisibleButtonCopy: hiddenMarkup.includes(">Cancel schedule<"),
      hiddenIsInert: hiddenRail?.includes("inert"),
      revealedIsInert: revealedRail?.includes("inert"),
      tooltip: cancelButton?.includes(
        'title="Cancel schedule and move to Stash ('
      ),
    }).toStrictEqual({
      accessibleLabel: true,
      cancelAriaShortcut: true,
      discardAccessibleLabel: true,
      discardAriaShortcut: true,
      discardTooltip: true,
      hasArchiveRestoreIcon: true,
      hasSelectionCheckbox: false,
      hasTrashIcon: true,
      hasVisibleButtonCopy: false,
      hiddenIsInert: true,
      revealedIsInert: false,
      tooltip: true,
    });
  });

  it("uses the mailbox active-state styling", () => {
    const markup = renderRow({ selected: true });
    const article = markup.match(/<article[^>]*>/u)?.[0];

    expect(article).toContain('data-active="true"');
    expect(article).toContain("data-[active=true]:bg-muted/60");
  });

  it("includes the sending account in the row's activation label", () => {
    const markup = renderRow({});
    const activationButton = markup.match(
      /<button[^>]*aria-label="Edit scheduled email[^>]*>/u
    )?.[0];

    expect(activationButton).toContain(`from ${item.accountId}`);
  });
});
