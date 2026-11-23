import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NewMessageFooter from "../src/renderer/src/components/mail/new-message/new-message-footer";
import { getNewMessageLeave } from "../src/renderer/src/components/mail/new-message/new-message-leave";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys/app-hotkeys-provider";
import { createNewMailDraft } from "../src/renderer/src/mail/mail-draft";
import { formatScheduledAt } from "../src/renderer/src/scheduled/schedule-time";

const blankDraft = createNewMailDraft("one@example.com");

describe(getNewMessageLeave, () => {
  it("closes a blank composer without stashing it", () => {
    expect(getNewMessageLeave(blankDraft, false)).toBe("close");
  });

  it("stashes anything written before closing", () => {
    expect(
      getNewMessageLeave({ ...blankDraft, subject: "Lunch?" }, false)
    ).toBe("stash");
    expect(
      getNewMessageLeave({ ...blankDraft, to: ["two@example.com"] }, false)
    ).toBe("stash");
  });

  it("waits for a send, schedule, cleanup, or save in progress", () => {
    expect(getNewMessageLeave(blankDraft, true)).toBe("wait");
    expect(getNewMessageLeave({ ...blankDraft, subject: "Lunch?" }, true)).toBe(
      "wait"
    );
  });
});

const scheduledAt = new Date(2030, 4, 20, 13).getTime();

const renderFooter = ({ isEdit }: { readonly isEdit: boolean }): string =>
  renderToString(
    <AppHotkeysProvider>
      <NewMessageFooter
        canSend={isEdit}
        canStash={!isEdit}
        delivery={{
          recipients: { bcc: [], cc: [], to: ["ana@example.com"] },
          subject: "Lunch?",
        }}
        isScheduling={false}
        isSending={false}
        onSend={() => Promise.resolve()}
        onStash={vi.fn<() => void>()}
        scheduled={{
          canSchedule: isEdit,
          isDirty: isEdit,
          isEdit,
          onDiscard: () => Promise.resolve(false),
          onPendingScheduleChange: vi.fn<() => void>(),
          onSave: () => Promise.resolve(false),
          onSchedule: () => Promise.resolve(false),
          scheduledAt: isEdit ? scheduledAt : undefined,
        }}
        sendShortcutLabel="Send"
        stashPicker={<button type="button">Stash 2</button>}
      />
    </AppHotkeysProvider>
  );

describe(NewMessageFooter, () => {
  it("sets Stash, the stash picker, and Send in one titlebar row on the page", () => {
    const markup = renderFooter({ isEdit: false });
    const stash = markup.indexOf('aria-label="Stash draft"');
    const picker = markup.indexOf("Stash 2");
    const send = markup.indexOf('aria-label="Send options"');

    expect(stash).toBeGreaterThan(-1);
    expect(picker).toBeGreaterThan(stash);
    expect(send).toBeGreaterThan(picker);
    expect(
      markup.match(/<button[^>]*aria-label="Schedule send"[^>]*>/u)?.[0]
    ).toContain("aria-keyshortcuts");
  });

  it("offers a scheduled email Discard, Save, and Send now instead of Stash", () => {
    const markup = renderFooter({ isEdit: true });

    expect(markup).toContain(
      'aria-label="Permanently discard scheduled email"'
    );
    expect(markup).toContain(">Save<");
    expect(markup).toContain("Send now");
    expect(markup).not.toContain('aria-label="Stash draft"');
    expect(markup).not.toContain("Stash 2");
  });

  it("shows a scheduled email's persisted send time without a Clear action", () => {
    const markup = renderFooter({ isEdit: true });

    expect(markup).toContain('<span class="sr-only">Scheduled send time');
    expect(markup).toContain(
      `dateTime="${new Date(scheduledAt).toISOString()}"`
    );
    expect(markup).toContain(formatScheduledAt(scheduledAt));
    expect(markup).not.toContain('aria-label="Clear selected send time"');
  });
});
