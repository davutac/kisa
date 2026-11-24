import { AccountId, MessageId } from "@repo/mail/ids";
import { MailEngineStore } from "@repo/mail/store";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { run } from "./fixtures/mail-engine-harness";

const ANA = AccountId.make("ana@example.com");
const BEN = AccountId.make("ben@example.com");
const SHARED = MessageId.make("shared");
const OTHER = MessageId.make("other");

const originsOf = (accountId: AccountId) =>
  Effect.gen(function* readOrigins() {
    const store = yield* MailEngineStore;
    const origins = yield* store.copyOrigins(accountId, [SHARED, OTHER]);
    return Object.fromEntries(origins);
  });

describe("where trashed copies came from", () => {
  it("keeps each account's record apart, and forgets only what it is told to", async () => {
    const remembered = await run(
      Effect.gen(function* rememberAndForget() {
        const store = yield* MailEngineStore;
        yield* store.rememberCopyOrigins(
          ANA,
          [SHARED, OTHER],
          [
            { mailboxPath: "Sent Messages", messageId: SHARED },
            { mailboxPath: "Drafts", messageId: OTHER },
          ]
        );
        yield* store.rememberCopyOrigins(
          BEN,
          [SHARED],
          [{ mailboxPath: "Sent Items", messageId: SHARED }]
        );
        yield* store.forgetCopyOrigins(ANA, [OTHER]);
        return { ana: yield* originsOf(ANA), ben: yield* originsOf(BEN) };
      })
    );

    expect(remembered).toStrictEqual({
      ana: { shared: ["Sent Messages"] },
      ben: { shared: ["Sent Items"] },
    });
  });

  it("drops one account's record when its mail is cleared, and only its own", async () => {
    const remembered = await run(
      Effect.gen(function* clearOne() {
        const store = yield* MailEngineStore;
        yield* store.rememberCopyOrigins(
          ANA,
          [SHARED],
          [{ mailboxPath: "Sent Messages", messageId: SHARED }]
        );
        yield* store.rememberCopyOrigins(
          BEN,
          [SHARED],
          [{ mailboxPath: "Sent Items", messageId: SHARED }]
        );
        yield* store.clearAccount(ANA);
        const result = {
          ana: yield* originsOf(ANA),
          ben: yield* originsOf(BEN),
        };
        yield* store.clearAccount(BEN);
        return result;
      })
    );

    expect(remembered).toStrictEqual({
      ana: {},
      ben: { shared: ["Sent Items"] },
    });
  });
});
