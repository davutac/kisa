import { formatDistanceToNow, formatISO } from "date-fns";
import { enUS } from "date-fns/locale";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getHotkeyAriaLabel } from "../src/renderer/src/hotkeys/commands";
import ScheduledMailRow from "../src/renderer/src/routes/scheduled/-components/scheduled-mail-row";
import {
  formatScheduledAt,
  LOCAL_TIME_ZONE,
} from "../src/renderer/src/scheduled/schedule-time";
import type { ScheduledMailSummary } from "../src/shared/ipc/scheduled-mail";

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
    <ScheduledMailRow
      item={item}
      measureElement={vi.fn<(element: HTMLLIElement | null) => void>()}
      onCancel={vi.fn<(item: ScheduledMailSummary) => void>()}
      onDiscard={vi.fn<(item: ScheduledMailSummary) => void>()}
      onOpen={vi.fn<(item: ScheduledMailSummary) => void>()}
      position={1}
      quickActionResetRevision={0}
      selected={selected}
      setSize={2}
      virtualIndex={0}
    />
  );

describe("scheduled mail row surface", () => {
  it("uses the mailbox thread row surface with a one-pixel separator", () => {
    const markup = renderRow({});
    const listItem = markup.match(/<li[^>]*>/u)?.[0];
    const rowSurface = markup.match(
      /<div[^>]*class="[^"]*bg-background[^"]*rounded-md[^"]*"[^>]*>/u
    )?.[0];
    const article = markup.match(/<article[^>]*>/u)?.[0];

    expect(listItem).toContain("pb-px");
    expect(rowSurface).toBeDefined();
    expect(article).toContain("data-[active=true]:bg-muted/60");
    expect(article).toContain("opacity-60");
    expect(article).not.toContain("bg-card");
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

  it("shows relative scheduled time with the exact local time as its tooltip label", () => {
    const markup = renderRow({});
    const scheduledTime = markup.match(/<time[^>]*>[^<]*<\/time>/u)?.[0];
    const exactLabel = `${formatScheduledAt(item.scheduledAt)} (${LOCAL_TIME_ZONE})`;
    const relativeLabel = formatDistanceToNow(item.scheduledAt, {
      includeSeconds: false,
      locale: enUS,
    });

    expect({
      exactLabel: scheduledTime?.includes(`aria-label="${exactLabel}"`),
      isCompact: scheduledTime?.includes("text-xs"),
      machineTime: scheduledTime?.includes(
        `dateTime="${formatISO(item.scheduledAt)}"`
      ),
      relativeLabel: scheduledTime?.includes(`>${relativeLabel}</time>`),
      tooltip: markup.includes('data-slot="tooltip-trigger"'),
    }).toStrictEqual({
      exactLabel: true,
      isCompact: true,
      machineTime: true,
      relativeLabel: true,
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
      /<div[^>]*data-slot="scheduled-mail-quick-action"[^>]*>/u
    )?.[0];
    const revealedRail = revealedMarkup.match(
      /<div[^>]*data-slot="scheduled-mail-quick-action"[^>]*>/u
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
      hasTrashIcon: hiddenMarkup.includes("lucide-trash-2"),
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
