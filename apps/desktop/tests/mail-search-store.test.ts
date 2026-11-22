import { beforeEach, describe, expect, it } from "vitest";

import { useMailSearchStore } from "../src/renderer/src/state/mail-search";

const initialState = useMailSearchStore.getState();
const receipts = {
  filters: [{ field: "from", value: "sender@example.com" }],
  text: "receipt",
} as const;

describe("mail search store", () => {
  beforeEach(() => {
    useMailSearchStore.setState(initialState, true);
  });

  it("fills the mailbox list with a query's results", () => {
    useMailSearchStore.getState().showResults(receipts);

    expect(useMailSearchStore.getState()).toMatchObject({
      isActive: true,
      query: receipts,
      revision: initialState.revision + 1,
    });
  });

  it("starts a new result set each time results are shown", () => {
    const store = useMailSearchStore.getState();
    store.showResults(receipts);
    store.showResults({ filters: [], text: "invoice" });

    expect(useMailSearchStore.getState()).toMatchObject({
      query: { filters: [], text: "invoice" },
      revision: initialState.revision + 2,
    });
  });

  it("exits to the mailbox and forgets the query", () => {
    const store = useMailSearchStore.getState();
    store.showResults(receipts);
    store.exit();

    expect(useMailSearchStore.getState()).toMatchObject({
      isActive: false,
      query: initialState.query,
    });
  });

  it("ignores exit when no results are shown", () => {
    useMailSearchStore.getState().exit();

    expect(useMailSearchStore.getState()).toBe(initialState);
  });
});
