import { describe, expect, it } from "vitest";

import { getScheduledMailActionRefusal } from "../src/main/mail/scheduled-mail-transitions";

const EDITOR_ACTIONS = [
  "edit-begin",
  "edit-discard",
  "edit-reschedule",
  "edit-save",
  "edit-send-now",
] as const;
const ROW_ACTIONS = ["row-cancel", "row-discard", "row-send-now"] as const;

describe(getScheduledMailActionRefusal, () => {
  it.each([...EDITOR_ACTIONS, ...ROW_ACTIONS])(
    "%s applies to a waiting email and to one that needs attention, never to one being sent",
    (action) => {
      expect(
        getScheduledMailActionRefusal(action, "scheduled")
      ).toBeUndefined();
      expect(
        getScheduledMailActionRefusal(action, "attention")
      ).toBeUndefined();
      expect(getScheduledMailActionRefusal(action, "sending")).toBe(
        "being-sent"
      );
    }
  );

  it.each([...EDITOR_ACTIONS, ...ROW_ACTIONS])(
    "%s finds a sent or deleted email gone",
    (action) => {
      expect(getScheduledMailActionRefusal(action, "sent")).toBe("gone");
      expect(getScheduledMailActionRefusal(action, undefined)).toBe("gone");
    }
  );

  it.each([...EDITOR_ACTIONS, ...ROW_ACTIONS])(
    "%s refuses an email the worker has claimed",
    (action) => {
      expect(getScheduledMailActionRefusal(action, "preparing")).toBe(
        "being-sent"
      );
    }
  );
});
