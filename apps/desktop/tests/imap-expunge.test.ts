import { describe, expect, it } from "vitest";

import { expungeExactly } from "../src/main/mail/engine/imap-session";

/** The UIDs of a UID set such as `1:3,7`. */
const uidsOf = (range: string) =>
  range.split(",").flatMap((part) => {
    const [from = "", to = from] = part.split(":");
    const numbers: number[] = [];

    for (let uid = Number(from); uid <= Number(to); uid += 1) {
      numbers.push(uid);
    }

    return numbers;
  });

/** A selected mailbox: UID → flags, and the commands a client sent. */
const mailbox = (flags: Record<number, readonly string[]>) => {
  const state = new Map(
    Object.entries(flags).map(([uid, list]) => [Number(uid), new Set(list)])
  );

  const calls: string[] = [];

  const client = {
    messageDelete: (range: string) => {
      calls.push(`delete ${range}`);

      for (const uid of uidsOf(range)) {
        state.get(uid)?.add("\\Deleted");
      }

      // A plain EXPUNGE takes everything marked \Deleted.
      for (const [uid, list] of state) {
        if (list.has("\\Deleted")) {
          state.delete(uid);
        }
      }

      return Promise.resolve(true);
    },
    messageFlagsAdd: (range: string) => {
      calls.push(`mark ${range}`);

      for (const uid of uidsOf(range)) {
        state.get(uid)?.add("\\Deleted");
      }

      return Promise.resolve(true);
    },
    messageFlagsRemove: (range: string) => {
      calls.push(`unmark ${range}`);

      for (const uid of uidsOf(range)) {
        state.get(uid)?.delete("\\Deleted");
      }

      return Promise.resolve(true);
    },
    search: () =>
      Promise.resolve(
        [...state].flatMap(([uid, list]) =>
          list.has("\\Deleted") && uid !== 2 ? [uid] : []
        )
      ),
  };

  return { calls, client, state };
};

describe("removing exactly the chosen messages", () => {
  it("uses UID EXPUNGE when the server has UIDPLUS", async () => {
    const { calls, client } = mailbox({ 1: [], 2: [] });

    // SAFETY: the fake has the four client methods expungeExactly calls.
    await expungeExactly(client as never, "2", true);

    expect(calls).toStrictEqual(["delete 2"]);
  });

  it("keeps another program's deleted-marked mail without UIDPLUS", async () => {
    const { calls, client, state } = mailbox({
      1: [],
      2: [],
      3: ["\\Deleted"],
    });

    // SAFETY: the fake has the four client methods expungeExactly calls.
    await expungeExactly(client as never, "2", false);

    expect([...state.keys()]).toStrictEqual([1, 3]);
    expect(state.get(3)?.has("\\Deleted")).toBeTruthy();
    expect(calls).toStrictEqual(["unmark 3", "delete 2", "mark 3"]);
  });

  // A plain EXPUNGE takes everything still marked. If the server did not
  // take the mark off the other program's mail, that mail would go too.
  it("expunges nothing when the other program's mail could not be unmarked", async () => {
    const { calls, client, state } = mailbox({ 2: [], 3: ["\\Deleted"] });

    const refusing = {
      ...client,
      messageFlagsRemove: (range: string) => {
        calls.push(`unmark ${range}`);

        return Promise.resolve(false);
      },
    };

    // SAFETY: the fake has the four client methods expungeExactly calls.
    await expect(
      expungeExactly(refusing as never, "2", false)
    ).resolves.toBeFalsy();
    expect([...state.keys()]).toStrictEqual([2, 3]);
    expect(calls).toStrictEqual(["unmark 3"]);
  });

  it("marks the other program's mail again when the expunge fails", async () => {
    const { client, state } = mailbox({ 2: [], 3: ["\\Deleted"] });

    const failing = {
      ...client,
      messageDelete: () => Promise.reject(new Error("connection lost")),
    };

    // SAFETY: the fake has the four client methods expungeExactly calls.
    await expect(expungeExactly(failing as never, "2", false)).rejects.toThrow(
      "connection lost"
    );
    expect(state.get(3)?.has("\\Deleted")).toBeTruthy();
  });
});
