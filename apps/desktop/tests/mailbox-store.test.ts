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
    const { mailbox, selectedAccountId, selectedThreadId, showUnread } =
      useMailboxStore.getState();

    expect(mailbox).toBe("inbox");
    expect(selectedAccountId).toBeNull();
    expect(selectedThreadId).toBeNull();
    expect(useMailboxStore.getState().openThreadId).toBeNull();
    expect(showUnread).toBeFalsy();
  });

  it("keeps the selection while it stays in the same mailbox", () => {
    withSelection("person@example.com:thread-42");
    useMailboxStore.getState().selectThread("person@example.com:thread-7");

    expect(useMailboxStore.getState().selectedThreadId).toBe(
      "person@example.com:thread-7"
    );
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
    useMailboxStore.getState().selectAccount("other@example.com");

    expect(useMailboxStore.getState().selectedAccountId).toBe(
      "other@example.com"
    );
    expect(useMailboxStore.getState().selectedThreadId).toBeNull();
  });

  it("drops the selection when the unread filter changes", () => {
    withSelection("person@example.com:thread-42");
    useMailboxStore.getState().setShowUnread(true);

    expect(useMailboxStore.getState().showUnread).toBeTruthy();
    expect(useMailboxStore.getState().selectedThreadId).toBeNull();
  });

  it("drops the selection when switching to Spam", () => {
    withSelection("person@example.com:thread-42");
    useMailboxStore.getState().setMailbox("spam");

    expect(useMailboxStore.getState().mailbox).toBe("spam");
    expect(useMailboxStore.getState().selectedThreadId).toBeNull();
  });
});
