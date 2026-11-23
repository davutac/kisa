// The hook dependencies are intentionally replaced with narrow test doubles whose signatures do not model each complete module.
// oxlint-disable vitest/prefer-import-in-mock
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const closeThread = vi.fn<() => void>();
  const selectAccount = vi.fn<(accountId: string | null) => void>();
  const selectInbox = vi.fn<(accountId: string | null) => void>();
  return {
    closeThread,
    navigate: vi.fn<(options: { to: string }) => void>(),
    pathname: "/scheduled",
    requestMailboxReload: vi.fn<() => void>(),
    retainMailboxThreadsSnapshotsForAccounts:
      vi.fn<(accountIds: readonly string[]) => void>(),
    selectAccount,
    selectInbox,
    store: {
      closeThread,
      mailbox: "inbox",
      openThreadId: null as string | null,
      selectAccount,
      selectInbox,
      selectedAccountId: null as string | null,
      showUnread: false,
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: state.pathname }),
  useNavigate: () => state.navigate,
}));

vi.mock("@/mail/mailbox-cache", () => ({
  retainMailboxThreadsSnapshotsForAccounts:
    state.retainMailboxThreadsSnapshotsForAccounts,
}));

vi.mock("@/mail/mailbox-reload", () => ({
  requestMailboxReload: state.requestMailboxReload,
}));

vi.mock("@/state/accounts", () => ({
  useAccounts: () => [
    { email: "first@example.com" },
    { email: "second@example.com" },
  ],
}));

vi.mock("@/state/mail-search", () => ({
  useIsMailSearchActive: () => false,
}));

vi.mock("@/state/mailbox", () => ({
  useMailboxStore: (selector: (store: typeof state.store) => unknown) =>
    selector(state.store),
}));

const { useMailboxNavigation } =
  await import("../src/renderer/src/mail/use-mailbox-navigation");
const mailboxNavigationFactory = useMailboxNavigation;

describe("mailbox navigation from a workspace", () => {
  beforeEach(() => {
    state.pathname = "/scheduled";
    state.store.openThreadId = null;
    state.store.selectedAccountId = null;
    state.store.showUnread = false;
    state.navigate.mockClear();
    state.requestMailboxReload.mockClear();
    state.retainMailboxThreadsSnapshotsForAccounts.mockClear();
    state.selectAccount.mockClear();
    state.selectInbox.mockClear();
  });

  it("closes Scheduled when Home opens All Accounts", () => {
    mailboxNavigationFactory().openAllAccounts();

    expect(state.selectInbox).toHaveBeenCalledWith(null);
    expect(state.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("closes Scheduled when an account opens its inbox", () => {
    mailboxNavigationFactory().openAccount("first@example.com");

    expect(state.selectInbox).toHaveBeenCalledWith("first@example.com");
    expect(state.navigate).toHaveBeenCalledWith({ to: "/" });
  });
});

describe("mailbox navigation from an open conversation", () => {
  beforeEach(() => {
    state.pathname = "/";
    state.store.openThreadId = "first@example.com:thread-1";
    state.store.selectedAccountId = "first@example.com";
    state.store.showUnread = true;
    state.closeThread.mockClear();
    state.requestMailboxReload.mockClear();
    state.selectInbox.mockClear();
  });

  it("goes back to the Inbox it is open over, keeping the list as it was", () => {
    mailboxNavigationFactory().openAccount("first@example.com");

    expect(state.closeThread).toHaveBeenCalledOnce();
    expect(state.selectInbox).not.toHaveBeenCalled();
    expect(state.requestMailboxReload).not.toHaveBeenCalled();
  });

  it("opens another scope's Inbox as usual", () => {
    mailboxNavigationFactory().openAccount("second@example.com");

    expect(state.closeThread).not.toHaveBeenCalled();
    expect(state.selectInbox).toHaveBeenCalledWith("second@example.com");
  });
});
