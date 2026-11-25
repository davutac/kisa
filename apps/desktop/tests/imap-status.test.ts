// A stand-in is passed where the adapter expects imapflow's whole client.
// oxlint-disable anti-slop/no-chained-type-assertions typescript/no-unsafe-type-assertion
// How the adapter reads a STATUS that got no answer. imapflow gives `false`
// both for a mailbox the server will not open and for a connection lost
// under the command, and a pass treats the two differently: it goes on
// without the mailbox, and stops without the connection. The engine's tests
// run against a fake server that fails each way by name, so only this shows
// the adapter telling them apart.
import { AccountId } from "@repo/mail/ids";
import { Effect } from "effect";
import type { ImapFlow } from "imapflow";
import { describe, expect, it } from "vitest";

import { makeSession } from "../src/main/mail/engine/imap-session";

const accountId = AccountId.make("test@example.com");
const PATH = "Shared/Reports";

/** A client whose STATUS ends as `status` does, on a connection that is `usable` or not. */
const sessionWith = (status: () => Promise<unknown>, usable: boolean) =>
  makeSession(accountId, {
    capabilities: new Map(),
    status,
    usable,
  } as unknown as ImapFlow);

const ending = (status: () => Promise<unknown>, usable = true) =>
  Effect.runPromise(
    sessionWith(status, usable)
      .status(PATH)
      .pipe(
        Effect.match({
          onFailure: (error) => error._tag,
          onSuccess: () => "answered",
        })
      )
  );

describe("a STATUS the adapter got no answer to", () => {
  it("is a mailbox that will not open when the server refused it", async () => {
    await expect(ending(() => Promise.resolve(false))).resolves.toBe(
      "MailboxMissingError"
    );
  });

  it("is a lost connection when the connection went with it", async () => {
    await expect(ending(() => Promise.resolve(false), false)).resolves.toBe(
      "MailConnectionError"
    );
  });

  it("is a mailbox that will not open when the server no longer lists it", async () => {
    // What imapflow raises once a LIST confirms the mailbox is gone.
    const notFound = Object.assign(new Error("Mailbox doesn't exist"), {
      code: "NotFound",
    });

    await expect(ending(() => Promise.reject(notFound))).resolves.toBe(
      "MailboxMissingError"
    );
  });

  it("is a mailbox that will not open when the answer has no UIDVALIDITY", async () => {
    await expect(
      ending(() => Promise.resolve({ messages: 3, path: PATH, uidNext: 4 }))
    ).resolves.toBe("MailboxMissingError");
  });

  it("is the mailbox's state when the server answered", async () => {
    const session = sessionWith(
      () =>
        Promise.resolve({
          highestModseq: 12n,
          messages: 3,
          path: PATH,
          uidNext: 4,
          uidValidity: 7n,
          unseen: 1,
        }),
      true
    );

    await expect(
      Effect.runPromise(session.status(PATH))
    ).resolves.toMatchObject({
      highestModseq: 12n,
      messages: 3,
      uidNext: 4,
      uidValidity: 7n,
      unseen: 1,
    });
  });
});
