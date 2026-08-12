import { describe, expect, it } from "@effect/vitest";

import { createThreadConversationStore } from "../src/renderer/src/components/mail/thread-conversation-store";
import { getAdjacentMessageId } from "../src/renderer/src/mail/message-selection";

const messageIds = ["oldest", "middle", "newest"];

describe(getAdjacentMessageId, () => {
  it("moves through messages in rendered order and stops at the edges", () => {
    expect(getAdjacentMessageId(messageIds, "middle", 1)).toBe("newest");
    expect(getAdjacentMessageId(messageIds, "middle", -1)).toBe("oldest");
    expect(getAdjacentMessageId(messageIds, "newest", 1)).toBe("newest");
    expect(getAdjacentMessageId(messageIds, "oldest", -1)).toBe("oldest");
  });

  it("recovers a stale selection from the edge matching the direction", () => {
    expect(getAdjacentMessageId(messageIds, "missing", 1)).toBe("oldest");
    expect(getAdjacentMessageId(messageIds, "missing", -1)).toBe("newest");
    expect(getAdjacentMessageId([], "missing", 1)).toBeNull();
  });
});

describe("thread conversation store", () => {
  it("starts with the latest message selected and expanded", () => {
    const store = createThreadConversationStore("newest");

    expect(store.getState()).toMatchObject({
      expandedMessageId: "newest",
      selectedMessageId: "newest",
    });
  });

  it("opens one message while closing the previous one", () => {
    const store = createThreadConversationStore("newest");

    store.getState().openMessage("middle");

    expect(store.getState()).toMatchObject({
      expandedMessageId: "middle",
      selectedMessageId: "middle",
    });
  });

  it("keeps a collapsed message selected as the action target", () => {
    const store = createThreadConversationStore("newest");

    store.getState().toggleMessage("newest");

    expect(store.getState()).toMatchObject({
      expandedMessageId: null,
      selectedMessageId: "newest",
    });
  });

  it("selects and expands an inactive message when it is toggled", () => {
    const store = createThreadConversationStore("newest");

    store.getState().toggleMessage("oldest");

    expect(store.getState()).toMatchObject({
      expandedMessageId: "oldest",
      selectedMessageId: "oldest",
    });
  });

  it("preserves selection across new mail and falls back when it disappears", () => {
    const store = createThreadConversationStore("middle");

    store.getState().reconcileMessages(messageIds);
    expect(store.getState().selectedMessageId).toBe("middle");

    store.getState().reconcileMessages(["oldest", "newest"]);
    expect(store.getState()).toMatchObject({
      expandedMessageId: "newest",
      selectedMessageId: "newest",
    });
  });
});
