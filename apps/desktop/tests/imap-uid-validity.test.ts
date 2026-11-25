// A stand-in is passed where the adapter expects imapflow's whole client.
// oxlint-disable anti-slop/no-chained-type-assertions typescript/no-unsafe-type-assertion
// The adapter's own guard, against a stand-in for imapflow's client. The
// engine's tests run against a fake server that implements the session
// itself, so they cannot show that the adapter compares a mailbox's
// UIDVALIDITY with the caller's, nor that it sends nothing when they differ.
import { AccountId } from "@repo/mail/ids";
import type { ImapSession } from "@repo/mail/session";
import { Effect } from "effect";
import type { ImapFlow } from "imapflow";
import { describe, expect, it } from "vitest";

import { makeSession } from "../src/main/mail/engine/imap-session";

const accountId = AccountId.make("test@example.com");
const PATH = "INBOX";

/** A fetch the server answers with no message. */
// oxlint-disable-next-line eslint/no-empty-function -- Nothing to yield.
const noMessages = async function* noMessages() {};

/**
 * A client with one mailbox. `held` is the UIDVALIDITY the server has it
 * under, given at each selection; `selected` is the one of a selection made
 * earlier, as imapflow keeps a mailbox selected between commands. `calls`
 * lists what was sent.
 */
const standIn = (held: bigint, selected?: bigint) => {
  const calls: string[] = [];
  const sent =
    (name: string) =>
    (range: string): Promise<boolean> => {
      calls.push(`${name} ${range}`);
      return Promise.resolve(true);
    };
  const client = {
    capabilities: new Map([
      ["MOVE", true],
      ["UIDPLUS", true],
    ]),
    fetch: (range: string) => {
      calls.push(`fetch ${range}`);
      return noMessages();
    },
    fetchOne: (range: string) => {
      calls.push(`fetch ${range}`);
      return Promise.resolve(false);
    },
    getMailboxLock: () => {
      if (client.mailbox === false) {
        client.mailboxOpen();
      }
      return Promise.resolve({
        // oxlint-disable-next-line eslint/no-empty-function -- Nothing is held.
        release: () => {},
      });
    },
    mailbox:
      selected === undefined
        ? (false as const)
        : { path: PATH, uidValidity: selected },
    mailboxOpen: () => {
      calls.push("select");
      Object.assign(client, { mailbox: { path: PATH, uidValidity: held } });
      return Promise.resolve();
    },
    messageCopy: sent("copy"),
    messageDelete: sent("expunge"),
    messageFlagsAdd: sent("store"),
    messageMove: sent("move"),
    search: () => {
      calls.push("search");
      return Promise.resolve([3, 1]);
    },
  };
  return {
    calls,
    session: makeSession(accountId, client as unknown as ImapFlow),
  };
};

/** Every call that takes or returns UIDs, each under `uidValidity`. */
const uidCommands = (
  session: ImapSession,
  uidValidity: bigint
): readonly (readonly [string, Effect.Effect<unknown, unknown>])[] => [
  ["copy", session.copy(PATH, uidValidity, [1], "Archive")],
  ["expunge", session.expunge(PATH, uidValidity, [1])],
  [
    "fetch",
    session.fetch(
      PATH,
      uidValidity,
      { kind: "uids", uids: [1] },
      { flags: true }
    ),
  ],
  ["fetchSection", session.fetchSection(PATH, uidValidity, 1, "2", 1024)],
  ["move", session.move(PATH, uidValidity, [1], "Archive")],
  ["search", session.search(PATH, uidValidity, { kind: "all" })],
  ["setFlags", session.setFlags(PATH, uidValidity, [1], "add", ["\\Seen"])],
  [
    "setGmailLabels",
    session.setGmailLabels(PATH, uidValidity, [1], "add", ["Work"]),
  ],
];

describe("the IMAP session's UIDVALIDITY guard", () => {
  it("sends every UID command in a mailbox selected under the caller's UIDVALIDITY", async () => {
    const { calls, session } = standIn(7n, 7n);

    for (const [, command] of uidCommands(session, 7n)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- One command after another.
      await Effect.runPromise(command);
    }

    // No selection is made again, and each command went out once.
    expect(calls).toStrictEqual([
      "copy 1",
      "expunge 1",
      "fetch 1",
      "fetch 1",
      "move 1",
      "search",
      "store 1",
      "store 1",
    ]);
  });

  it.each(uidCommands(standIn(8n, 8n).session, 7n).map(([name]) => name))(
    "sends no %s in a mailbox that has another UIDVALIDITY",
    async (name) => {
      const { calls, session } = standIn(8n, 8n);
      const command = uidCommands(session, 7n).find(
        ([candidate]) => candidate === name
      )?.[1];

      await expect(
        Effect.runPromise(command ?? Effect.void)
      ).rejects.toMatchObject({ _tag: "MailboxMissingError", path: PATH });
      // The mailbox is selected once more, to be sure, and nothing follows.
      expect(calls).toStrictEqual(["select"]);
    }
  );

  it("selects a mailbox again when its selection is older than a rebuild the caller knows of", async () => {
    const { calls, session } = standIn(8n, 7n);

    await Effect.runPromise(session.setFlags(PATH, 8n, [1], "add", ["\\Seen"]));

    expect(calls).toStrictEqual(["select", "store 1"]);
  });

  it("refuses a mailbox selected for the first time under another UIDVALIDITY", async () => {
    const { calls, session } = standIn(8n);

    await expect(
      Effect.runPromise(session.expunge(PATH, 7n, [1]))
    ).rejects.toMatchObject({ _tag: "MailboxMissingError" });
    expect(calls).toStrictEqual(["select", "select"]);
  });

  it("asks whether mail is there without a UIDVALIDITY", async () => {
    const { calls, session } = standIn(8n, 8n);

    const found = await Effect.runPromise(
      session.hasMessage(PATH, { kind: "all" })
    );

    expect({ calls, found }).toStrictEqual({ calls: ["search"], found: true });
  });
});
