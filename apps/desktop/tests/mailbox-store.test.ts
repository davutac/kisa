import { beforeEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";

import { useMailboxStore } from "../src/renderer/src/state/mailbox";
import {
  parseUnreadFilter,
  readUnreadFilter,
} from "../src/renderer/src/state/unread-filter-preference";

const initialState = useMailboxStore.getState();

const withOpenThread = (threadId: string): void => {
  useMailboxStore.getState().openThread(threadId);
};

const withSelection = (selectedThreadId: string): void => {
  useMailboxStore.setState({ selectedThreadId });
};

describe("mailbox store", () => {
  beforeEach(() => {
    useMailboxStore.setState(initialState, true);
  });

  it("starts on every account with no filters", () => {
    const {
      checkedThreadIds,
      mailbox,
      selectedAccountId,
      selectedThreadId,
      showUnread,
    } = useMailboxStore.getState();

    expect({
      checkedThreadCount: checkedThreadIds.size,
      mailbox,
      openThreadId: useMailboxStore.getState().openThreadId,
      selectedAccountId,
      selectedThreadId,
      showUnread,
    }).toStrictEqual({
      checkedThreadCount: 0,
      mailbox: "inbox",
      openThreadId: null,
      selectedAccountId: null,
      selectedThreadId: null,
      showUnread: false,
    });
  });

  it("keeps the selection while it stays in the same mailbox", () => {
    withSelection("person@example.com:thread-42");
    useMailboxStore.getState().selectThread("person@example.com:thread-7");

    expect(useMailboxStore.getState().selectedThreadId).toBe(
      "person@example.com:thread-7"
    );
  });

  it("checks account-qualified threads independently", () => {
    const store = useMailboxStore.getState();

    store.checkThread("first@example.com:shared-id", true);
    store.checkThread("second@example.com:shared-id", true);
    store.checkThread("first@example.com:shared-id", false);

    expect([...useMailboxStore.getState().checkedThreadIds]).toStrictEqual([
      "second@example.com:shared-id",
    ]);
  });

  it("retains only checked threads still present in the mailbox", () => {
    const store = useMailboxStore.getState();
    store.checkThread("person@example.com:first", true);
    store.checkThread("person@example.com:second", true);

    store.retainCheckedThreads(
      new Set(["person@example.com:second", "person@example.com:third"])
    );

    expect([...useMailboxStore.getState().checkedThreadIds]).toStrictEqual([
      "person@example.com:second",
    ]);
  });

  it("opens a thread and selects it in the list", () => {
    withOpenThread("person@example.com:thread-42");

    expect(useMailboxStore.getState().openThreadId).toBe(
      "person@example.com:thread-42"
    );
    expect(useMailboxStore.getState().selectedThreadId).toBe(
      "person@example.com:thread-42"
    );
  });

  it("closes the thread without losing the list selection", () => {
    withOpenThread("person@example.com:thread-42");
    useMailboxStore.getState().closeThread();

    expect(useMailboxStore.getState().openThreadId).toBeNull();
    expect(useMailboxStore.getState().selectedThreadId).toBe(
      "person@example.com:thread-42"
    );
  });

  it("closes the open thread when the account narrows", () => {
    withOpenThread("person@example.com:thread-42");
    useMailboxStore.getState().selectAccount("other@example.com");

    expect(useMailboxStore.getState().openThreadId).toBeNull();
  });

  it("drops the selection when the account narrows", () => {
    withSelection("person@example.com:thread-42");
    useMailboxStore
      .getState()
      .checkThread("person@example.com:thread-42", true);
    useMailboxStore.getState().selectAccount("other@example.com");

    expect(useMailboxStore.getState().selectedAccountId).toBe(
      "other@example.com"
    );
    expect(useMailboxStore.getState().selectedThreadId).toBeNull();
    expect(useMailboxStore.getState().checkedThreadIds.size).toBe(0);
  });

  it("changes only the account scope when selecting an account", () => {
    const store = useMailboxStore.getState();
    store.setMailbox({ label: "Work" });
    store.setShowUnread(true);

    store.selectAccount("other@example.com");

    expect(useMailboxStore.getState()).toMatchObject({
      mailbox: { label: "Work" },
      selectedAccountId: "other@example.com",
      showUnread: true,
    });
  });

  it("opens a label as a place and clears thread state", () => {
    const store = useMailboxStore.getState();
    store.setShowUnread(true);
    store.openThread("person@example.com:thread-42");
    store.checkThread("person@example.com:thread-42", true);

    store.selectMailbox("one@example.com", { label: "Work" });

    expect(useMailboxStore.getState()).toMatchObject({
      mailbox: { label: "Work" },
      openThreadId: null,
      selectedAccountId: "one@example.com",
      selectedThreadId: null,
      showUnread: true,
    });
    expect(useMailboxStore.getState().checkedThreadIds.size).toBe(0);
  });

  it("keeps the label place already shown when it is chosen again", () => {
    const store = useMailboxStore.getState();
    store.setMailbox({ label: "Work" });
    const shown = useMailboxStore.getState().mailbox;

    store.selectMailbox(null, { label: "work" });

    expect(useMailboxStore.getState().mailbox).toBe(shown);
  });

  it("drops the selection when the unread filter changes", () => {
    withSelection("person@example.com:thread-42");
    useMailboxStore
      .getState()
      .checkThread("person@example.com:thread-42", true);
    useMailboxStore.getState().setShowUnread(true);

    expect(useMailboxStore.getState().showUnread).toBeTruthy();
    expect(useMailboxStore.getState().selectedThreadId).toBeNull();
    expect(useMailboxStore.getState().checkedThreadIds.size).toBe(0);
  });

  it("drops the selection when switching to Spam", () => {
    withSelection("person@example.com:thread-42");
    useMailboxStore
      .getState()
      .checkThread("person@example.com:thread-42", true);
    useMailboxStore.getState().setMailbox("spam");

    expect(useMailboxStore.getState().mailbox).toBe("spam");
    expect(useMailboxStore.getState().selectedThreadId).toBeNull();
    expect(useMailboxStore.getState().checkedThreadIds.size).toBe(0);
  });

  it("selects an account inbox, keeping the unread filter", () => {
    const store = useMailboxStore.getState();
    store.setMailbox("spam");
    store.setShowUnread(true);
    store.openThread("person@example.com:thread-42");
    store.checkThread("person@example.com:thread-42", true);

    store.selectInbox("other@example.com");

    const state = useMailboxStore.getState();
    expect(state.checkedThreadIds.size).toBe(0);
    expect(state).toMatchObject({
      mailbox: "inbox",
      openThreadId: null,
      selectedAccountId: "other@example.com",
      selectedThreadId: null,
      showUnread: true,
    });
  });
});

describe("remembered unread filter", () => {
  beforeEach(() => {
    useMailboxStore.setState(initialState, true);
    vi.unstubAllGlobals();
  });

  it("is on only when it was saved on", () => {
    expect(parseUnreadFilter("true")).toBeTruthy();
    expect(parseUnreadFilter("false")).toBeFalsy();
    expect(parseUnreadFilter(null)).toBeFalsy();
    expect(parseUnreadFilter("yes")).toBeFalsy();
  });

  it("saves the toggle so the next window starts with it", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    useMailboxStore.getState().setShowUnread(true);
    expect(readUnreadFilter()).toBeTruthy();

    useMailboxStore.getState().setShowUnread(false);
    expect(readUnreadFilter()).toBeFalsy();
  });

  it("starts off when storage is unavailable", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });

    expect(readUnreadFilter()).toBeFalsy();
    expect(() => useMailboxStore.getState().setShowUnread(true)).not.toThrow();
  });
});
