import { describe, expect, it } from "vitest";

import {
  isAccountScopeCurrent,
  isLabelsRowCurrent,
  isMailboxCurrent,
  isScopeRowCurrent,
  resolveMailboxSelection,
  resolveScopeRowSelection,
  resolveWorkspacePreviousPath,
  resolveWorkspaceToggle,
  shouldShowScheduled,
  toShellViewPath,
} from "../src/renderer/src/components/shell/shell-navigation";
import type { MailboxView } from "../src/renderer/src/components/shell/shell-navigation";

describe("workspace toggles", () => {
  it.each(["/compose", "/scheduled", "/templates", "/settings"] as const)(
    "opens and closes %s as a toggle",
    (targetPath) => {
      expect(
        resolveWorkspaceToggle({
          currentPath: "/",
          previousPath: null,
          targetPath,
        })
      ).toBe(targetPath);

      expect(
        resolveWorkspaceToggle({
          currentPath: targetPath,
          previousPath: "/",
          targetPath,
        })
      ).toBe("/");
    }
  );

  it("falls back to the mailbox when no previous view was captured", () => {
    expect(
      resolveWorkspaceToggle({
        currentPath: "/settings",
        previousPath: null,
        targetPath: "/settings",
      })
    ).toBe("/");
  });

  it("restores another workspace view", () => {
    expect(
      resolveWorkspaceToggle({
        currentPath: "/templates",
        previousPath: "/settings",
        targetPath: "/templates",
      })
    ).toBe("/settings");
  });

  it("normalizes routes outside the shell to the mailbox fallback", () => {
    expect(toShellViewPath("/thread/account/thread")).toBe("/");
  });

  it("treats a new email as its own page", () => {
    expect(toShellViewPath("/compose")).toBe("/compose");
  });

  it("remembers the view a workspace was opened from", () => {
    expect(resolveWorkspacePreviousPath("/", "/settings", null)).toBe("/");
    expect(resolveWorkspacePreviousPath("/templates", "/compose", null)).toBe(
      "/templates"
    );
  });

  it("remembers what a new email was written over, never the email itself", () => {
    expect(
      resolveWorkspacePreviousPath("/compose", "/settings", "/scheduled")
    ).toBe("/scheduled");
    expect(
      resolveWorkspacePreviousPath("/compose", "/settings", null)
    ).toBeNull();
  });

  it("never remembers a workspace as its own previous view", () => {
    expect(
      resolveWorkspacePreviousPath("/compose", "/settings", "/settings")
    ).toBeNull();
  });

  it("shows Scheduled only while it is open or scheduled mail exists", () => {
    expect(shouldShowScheduled(false, false)).toBeFalsy();
    expect(shouldShowScheduled(false, true)).toBeTruthy();
    expect(shouldShowScheduled(true, false)).toBeTruthy();
  });
});

const mailboxView = (overrides: Partial<MailboxView> = {}): MailboxView => ({
  currentPath: "/",
  mailbox: "inbox",
  selectedAccountId: null,
  ...overrides,
});

describe("mailbox selection", () => {
  it.each(["sent", "spam", "trash"] as const)(
    "returns to the same scope's Inbox when %s is chosen again",
    (mailbox) => {
      expect(
        resolveMailboxSelection(mailboxView(), { accountId: null, mailbox })
      ).toStrictEqual({ accountId: null, mailbox });
      expect(
        resolveMailboxSelection(mailboxView({ mailbox }), {
          accountId: null,
          mailbox,
        })
      ).toStrictEqual({ accountId: null, mailbox: "inbox" });
      expect(
        resolveMailboxSelection(
          mailboxView({ mailbox, selectedAccountId: "one@example.com" }),
          { accountId: "one@example.com", mailbox }
        )
      ).toStrictEqual({ accountId: "one@example.com", mailbox: "inbox" });
    }
  );

  it("moves between accounts within a mailbox instead of toggling", () => {
    expect(
      resolveMailboxSelection(
        mailboxView({ mailbox: "spam", selectedAccountId: "one@example.com" }),
        { accountId: "two@example.com", mailbox: "spam" }
      )
    ).toStrictEqual({ accountId: "two@example.com", mailbox: "spam" });
    expect(
      resolveMailboxSelection(
        mailboxView({ mailbox: "spam", selectedAccountId: "one@example.com" }),
        { accountId: null, mailbox: "spam" }
      )
    ).toStrictEqual({ accountId: null, mailbox: "spam" });
  });

  it("keeps the Inbox when the Inbox is chosen again", () => {
    expect(
      resolveMailboxSelection(mailboxView(), {
        accountId: null,
        mailbox: "inbox",
      })
    ).toStrictEqual({ accountId: null, mailbox: "inbox" });
  });

  it("opens the chosen mailbox from a workspace instead of toggling it off", () => {
    expect(
      resolveMailboxSelection(
        mailboxView({ currentPath: "/settings", mailbox: "spam" }),
        { accountId: null, mailbox: "spam" }
      )
    ).toStrictEqual({ accountId: null, mailbox: "spam" });
  });

  it("marks a row current only for its own scope and mailbox", () => {
    const view = mailboxView({
      mailbox: "trash",
      selectedAccountId: "one@example.com",
    });

    expect(
      isMailboxCurrent(view, { accountId: "one@example.com", mailbox: "trash" })
    ).toBeTruthy();
    expect(
      isMailboxCurrent(view, { accountId: null, mailbox: "trash" })
    ).toBeFalsy();
    expect(
      isMailboxCurrent(view, { accountId: "one@example.com", mailbox: "spam" })
    ).toBeFalsy();
    expect(
      isMailboxCurrent(
        { ...view, currentPath: "/templates" },
        { accountId: "one@example.com", mailbox: "trash" }
      )
    ).toBeFalsy();
  });
});

describe("account rows", () => {
  it("stands for the scope's Inbox", () => {
    const view = mailboxView({ selectedAccountId: "one@example.com" });

    expect(isScopeRowCurrent(view, "one@example.com", false)).toBeTruthy();
    expect(isScopeRowCurrent(view, "one@example.com", true)).toBeTruthy();
    expect(isScopeRowCurrent(view, null, true)).toBeFalsy();
  });

  it("hands the current state to a shown Sent, Spam, or Trash row", () => {
    const view = mailboxView({
      mailbox: "spam",
      selectedAccountId: "one@example.com",
    });

    expect(isScopeRowCurrent(view, "one@example.com", true)).toBeFalsy();
    expect(isScopeRowCurrent(view, "one@example.com", false)).toBeTruthy();
  });

  it("keeps the account row current in Scheduled, which has no mailbox row", () => {
    expect(
      isScopeRowCurrent(
        mailboxView({ currentPath: "/scheduled", mailbox: "trash" }),
        null,
        true
      )
    ).toBeTruthy();
  });
});

describe("account scope", () => {
  it("marks the selected scope current in the mailbox and Scheduled", () => {
    expect(isAccountScopeCurrent("/", null, null)).toBeTruthy();
    expect(
      isAccountScopeCurrent("/scheduled", "one@example.com", "one@example.com")
    ).toBeTruthy();
    expect(isAccountScopeCurrent("/", "one@example.com", null)).toBeFalsy();
    expect(isAccountScopeCurrent("/", null, "one@example.com")).toBeFalsy();
  });

  it("marks no scope current in unscoped workspaces", () => {
    expect(isAccountScopeCurrent("/compose", null, null)).toBeFalsy();
    expect(isAccountScopeCurrent("/settings", null, null)).toBeFalsy();
    expect(
      isAccountScopeCurrent("/templates", "one@example.com", "one@example.com")
    ).toBeFalsy();
  });
});

describe("account row selection", () => {
  it("opens the scope's Inbox and shows its mailboxes from elsewhere", () => {
    const view = mailboxView({
      mailbox: "sent",
      selectedAccountId: "one@example.com",
    });

    expect(
      resolveScopeRowSelection(view, "one@example.com", false, false)
    ).toStrictEqual({ isExpanded: true, opensInbox: true });
    expect(
      resolveScopeRowSelection(view, "one@example.com", true, false)
    ).toStrictEqual({ isExpanded: true, opensInbox: true });
    expect(
      resolveScopeRowSelection(
        mailboxView({ currentPath: "/scheduled" }),
        null,
        false,
        false
      )
    ).toStrictEqual({ isExpanded: true, opensInbox: true });
  });

  it("only opens or closes the mailboxes while its Inbox is on screen", () => {
    const view = mailboxView({ selectedAccountId: "one@example.com" });

    expect(
      resolveScopeRowSelection(view, "one@example.com", true, false)
    ).toStrictEqual({ isExpanded: false, opensInbox: false });
    expect(
      resolveScopeRowSelection(view, "one@example.com", false, false)
    ).toStrictEqual({ isExpanded: true, opensInbox: false });
  });

  it("goes back to its Inbox from a conversation open over it, keeping the mailboxes", () => {
    const view = mailboxView({ selectedAccountId: "one@example.com" });

    expect(
      resolveScopeRowSelection(view, "one@example.com", true, true)
    ).toStrictEqual({ isExpanded: true, opensInbox: true });
    expect(
      resolveScopeRowSelection(view, "one@example.com", false, true)
    ).toStrictEqual({ isExpanded: false, opensInbox: true });
  });
});

describe("label rows", () => {
  const work = { accountId: "one@example.com", mailbox: { label: "Work" } };
  const workView = mailboxView({
    mailbox: { label: "work" },
    selectedAccountId: "one@example.com",
  });

  it("opens a label and returns to the scope's Inbox when chosen again", () => {
    expect(resolveMailboxSelection(mailboxView(), work)).toStrictEqual(work);
    expect(resolveMailboxSelection(workView, work)).toStrictEqual({
      accountId: "one@example.com",
      mailbox: "inbox",
    });
  });

  it("marks a label current without regard to case, and never a mailbox named like it", () => {
    expect(isMailboxCurrent(workView, work)).toBeTruthy();
    expect(
      isMailboxCurrent(workView, {
        accountId: null,
        mailbox: { label: "Work" },
      })
    ).toBeFalsy();
    expect(
      isMailboxCurrent(mailboxView({ mailbox: "sent" }), {
        accountId: null,
        mailbox: { label: "Sent" },
      })
    ).toBeFalsy();
  });

  it("keeps the account row current while its rows are hidden", () => {
    expect(isScopeRowCurrent(workView, "one@example.com", false)).toBeTruthy();
    expect(isScopeRowCurrent(workView, "one@example.com", true)).toBeFalsy();
  });

  it("hands the current state to the Labels row while the labels are hidden", () => {
    expect(isLabelsRowCurrent(workView, "one@example.com", false)).toBeTruthy();
    expect(isLabelsRowCurrent(workView, "one@example.com", true)).toBeFalsy();
    expect(isLabelsRowCurrent(workView, "two@example.com", false)).toBeFalsy();
    expect(
      isLabelsRowCurrent(
        mailboxView({ mailbox: "sent", selectedAccountId: "one@example.com" }),
        "one@example.com",
        false
      )
    ).toBeFalsy();
  });
});
