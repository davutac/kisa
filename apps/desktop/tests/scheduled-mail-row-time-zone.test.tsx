import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  formatExactMailDate,
  formatMailDate,
} from "../src/renderer/src/mail/mail-date";
import ScheduledMailRow from "../src/renderer/src/routes/scheduled/-components/scheduled-mail-row";
import type { ScheduledMailSummary } from "../src/shared/ipc/scheduled-mail";

// A calendar in a zone the process did not start in, as after travelling
// with Scheduled open: everything the row says about time must follow it.
const calendar = vi.hoisted(() => {
  const startupZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    now: Date.UTC(2026, 10, 18, 20),
    timeZone:
      startupZone === "Pacific/Chatham" ? "Asia/Kathmandu" : "Pacific/Chatham",
  };
});

vi.mock(import("@/hooks/use-calendar"), async (importOriginal) => ({
  ...(await importOriginal()),
  useCalendar: () => calendar,
}));

const item: ScheduledMailSummary = {
  accountId: "person@example.com",
  attachments: [],
  deliveryState: "retrying",
  draftId: "draft-1",
  nextAttemptAt: Date.UTC(2026, 10, 18, 22, 15),
  preview: "",
  recipients: ["friend@example.com"],
  revision: 1,
  scheduledAt: Date.UTC(2026, 10, 19, 12),
  subject: "Hello",
};

describe("scheduled mail row after a time-zone change", () => {
  it("draws the date, tooltip, and spoken summary from the current zone", () => {
    const markup = renderToString(
      <ScheduledMailRow
        item={item}
        measureElement={vi.fn<(element: HTMLLIElement | null) => void>()}
        onCancel={vi.fn<(item: ScheduledMailSummary) => void>()}
        onDiscard={vi.fn<(item: ScheduledMailSummary) => void>()}
        onOpen={vi.fn<(item: ScheduledMailSummary) => void>()}
        position={1}
        quickActionResetRevision={0}
        selected={false}
        setSize={1}
        virtualIndex={0}
      />
    );
    const exact = formatExactMailDate(item.scheduledAt, calendar);
    const retry = formatMailDate(item.nextAttemptAt ?? 0, calendar, "detailed");

    expect({
      retryNotice: markup.includes(`Retrying · next attempt: ${retry}`),
      spokenSummary: markup.includes(`scheduled for ${exact}`),
      tooltip: markup.includes(`aria-label="${exact} (${calendar.timeZone})"`),
      visibleDate: markup.includes(
        `>${formatMailDate(item.scheduledAt, calendar, "detailed")}</time>`
      ),
    }).toStrictEqual({
      retryNotice: true,
      spokenSummary: true,
      tooltip: true,
      visibleDate: true,
    });
  });
});
