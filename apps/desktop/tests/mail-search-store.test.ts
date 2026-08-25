import { beforeEach, describe, expect, it } from "vitest";

import { useMailSearchStore } from "../src/renderer/src/state/mail-search";

const initialState = useMailSearchStore.getState();

describe("mail search store", () => {
  beforeEach(() => {
    useMailSearchStore.setState(initialState, true);
  });

  it("starts a fresh all-mail search session", () => {
    useMailSearchStore.getState().activate();

    expect(useMailSearchStore.getState()).toMatchObject({
      isActive: true,
      isDirty: false,
      query: {
        filters: [],
        text: "",
      },
    });
  });

  it("preserves the active session when activated again", () => {
    const store = useMailSearchStore.getState();
    store.activate();
    useMailSearchStore.getState().updateQuery({
      filters: [{ field: "from", value: "sender@example.com" }],
      text: "receipt",
    });
    useMailSearchStore.getState().activate();

    expect(useMailSearchStore.getState()).toMatchObject({
      isDirty: true,
      query: {
        filters: [{ field: "from", value: "sender@example.com" }],
        text: "receipt",
      },
    });
  });

  it("exits without retaining dirty state", () => {
    const store = useMailSearchStore.getState();
    store.activate();
    useMailSearchStore.getState().updateQuery({ filters: [], text: "mail" });
    useMailSearchStore.getState().exit();

    expect(useMailSearchStore.getState()).toMatchObject({
      isActive: false,
      isDirty: false,
    });
  });

  it("ignores query updates outside an active session", () => {
    useMailSearchStore.getState().updateQuery({ filters: [], text: "receipt" });

    expect(useMailSearchStore.getState()).toMatchObject({
      isActive: false,
      isDirty: false,
      query: initialState.query,
    });
  });
});
