import { beforeEach, describe, expect, it } from "@effect/vitest";

import { useMailboxStore } from "../src/renderer/src/state/mailbox";

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
});
