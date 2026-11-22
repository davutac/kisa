import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import NewMessageFooter from "../src/renderer/src/components/mail/new-message/new-message-footer";
import { getNewMessageLeave } from "../src/renderer/src/components/mail/new-message/new-message-leave";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys/app-hotkeys-provider";
import { createNewMailDraft } from "../src/renderer/src/mail/mail-draft";

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

describe(NewMessageFooter, () => {
  it("sets Stash, the stash picker, and Send in one titlebar row on the page", () => {
    const markup = renderToString(
      <AppHotkeysProvider>
        <NewMessageFooter
          canSend={false}
          canStash
          isScheduling={false}
          isSending={false}
          layout="page"
          onSend={() => Promise.resolve()}
          onStash={vi.fn<() => void>()}
          scheduled={{
            canSchedule: false,
            isDirty: false,
            isEdit: false,
            onDiscard: () => Promise.resolve(false),
            onPendingScheduleChange: vi.fn<() => void>(),
            onSave: () => Promise.resolve(false),
            onSchedule: () => Promise.resolve(false),
            scheduledAt: undefined,
          }}
          sendShortcutLabel="Send"
          stashPicker={<button type="button">Stash 2</button>}
        />
      </AppHotkeysProvider>
    );
    const stash = markup.indexOf('aria-label="Stash draft"');
    const picker = markup.indexOf("Stash 2");
    const send = markup.indexOf('aria-label="Send options"');

    expect(stash).toBeGreaterThan(-1);
    expect(picker).toBeGreaterThan(stash);
    expect(send).toBeGreaterThan(picker);
    // The dialog's full-height footer segments are `size-12`.
    expect(markup).not.toContain("size-12");
  });
});
