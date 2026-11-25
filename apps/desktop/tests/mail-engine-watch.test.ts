import { beforeEach, describe, expect, it } from "@effect/vitest";
// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable typescript/no-unsafe-type-assertion vitest/no-standalone-expect
// When the engine waits on a server for news of the Inbox, and what it does
// with each kind. The server is a fake; the store and its database are real.
import { genericDialect, gmailDialect } from "@repo/mail/dialects";
import { ThreadId } from "@repo/mail/ids";
import { setThreadRead } from "@repo/mail/mutations";
import { MailEngineStore } from "@repo/mail/store";
import type { ThreadChanges } from "@repo/mail/store";
import type { SyncScope } from "@repo/mail/sync";
import { watchForNews, watchTargets, watchTogether } from "@repo/mail/watch";
import type { MailboxWatchOptions } from "@repo/mail/watch";
import { Deferred, Effect, Fiber, Semaphore } from "effect";
import { TestClock } from "effect/testing";

import { FakeImapServer } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  ICLOUD_MAILBOXES,
  OUTLOOK_CAPABILITIES,
  OUTLOOK_MAILBOXES,
  TestStore,
  accountId,
  connection,
  genericMessage,
  gmailMessage,
  insertAccount,
  resetDatabase,
  run,
  scopeFor,
  syncFully,
  threadRow,
} from "./fixtures/mail-engine-harness";

const ICLOUD_CAPABILITIES = ["CONDSTORE", "IDLE"];

/** Options for one wait, with what its refreshes reported. */
const watching = (overrides: Partial<MailboxWatchOptions> = {}) => {
  const refreshes: ThreadChanges[] = [];
  const stopped: Deferred.Deferred<void> = Deferred.makeUnsafe();
  const options: MailboxWatchOptions = {
    compare: true,
    maxMs: 300_000,
    refreshSpacingMs: 0,
    refreshed: (changes) =>
      Effect.sync(() => {
        refreshes.push(changes);
      }),
    stop: stopped,
    ...overrides,
  };
  return {
    options,
    refreshes,
    stop: (): void => {
      Deferred.doneUnsafe(stopped, Effect.void);
    },
  };
};

const targetsOf = (scope: SyncScope) =>
  Effect.gen(function* readTargets() {
    const store = yield* MailEngineStore;
    return watchTargets(yield* store.getMailboxes(scope.accountId));
  });

/** The account's Inbox wait, as the engine starts it. */
const watchInbox = (scope: SyncScope, options: MailboxWatchOptions) =>
  Effect.gen(function* inboxWait() {
    const targets = yield* targetsOf(scope);
    return targets === undefined
      ? ("unavailable" as const)
      : yield* watchForNews(scope, targets.primary, options);
  });

/** The wait beside it: Sent, or All Mail on Gmail. */
const watchBeside = (scope: SyncScope, options: MailboxWatchOptions) =>
  Effect.gen(function* besideWait() {
    const extra = (yield* targetsOf(scope))?.extra;
    return extra === undefined
      ? ("unavailable" as const)
      : yield* watchForNews(scope, extra, options);
  });

const count = (sql: string): number =>
  (connection.prepare(sql).get(accountId) as { readonly n: number }).n;
const unreadThreads = (): number =>
  count(
    "SELECT COUNT(*) AS n FROM mail_threads WHERE account_id = ? AND is_unread = 1"
  );
const inboxCopies = (): number =>
  count(
    "SELECT COUNT(*) AS n FROM mail_message_locations WHERE account_id = ? AND mailbox_path = 'INBOX'"
  );
const sentCopies = (): number =>
  count(
    "SELECT COUNT(*) AS n FROM mail_message_locations WHERE account_id = ? AND mailbox_path = 'Sent Messages'"
  );
const anyThreadId = (): ThreadId =>
  ThreadId.make(
    (
      connection
        .prepare("SELECT thread_id FROM mail_threads WHERE account_id = ?")
        .get(accountId) as { readonly thread_id: string }
    ).thread_id
  );

/** An account with two read messages in its Inbox, synced. */
const syncedInbox = async (
  capabilities = ICLOUD_CAPABILITIES,
  mailboxes = ICLOUD_MAILBOXES
) => {
  insertAccount("generic");
  const server = new FakeImapServer(mailboxes, capabilities);
  const uids = [
    server.deliver("INBOX", genericMessage("first")),
    server.deliver("INBOX", genericMessage("second")),
  ] as const;
  const scope = scopeFor(server, genericDialect);
  await syncFully(scope);
  return { scope, server, uids };
};

/** A Gmail account with one read message, synced. */
const syncedGmail = async () => {
  insertAccount("gmail");
  const server = new FakeImapServer(GMAIL_MAILBOXES);
  const uid = server.deliver(ALL_MAIL, gmailMessage("200", "200"));
  const scope = scopeFor(server, gmailDialect);
  await syncFully(scope);
  return { scope, server, uid };
};

describe(watchForNews, () => {
  beforeEach(resetDatabase);

  it("waits in the Inbox and ends when mail arrives", async () => {
    const { scope, server } = await syncedInbox();
    const { options } = watching();

    const waiting = server.nextWatch();
    const outcome = run(watchInbox(scope, options));
    await waiting;
    server.deliver("INBOX", genericMessage("third"));

    await expect(outcome).resolves.toBe("arrived");
    expect(server.watches).toStrictEqual(["INBOX"]);
  });

  it("reports mail that arrived between the last pass and the wait without waiting", async () => {
    const { scope, server } = await syncedInbox();
    server.deliver("INBOX", genericMessage("third"));

    await expect(run(watchInbox(scope, watching().options))).resolves.toBe(
      "ahead"
    );
    expect(server.watches).toStrictEqual([]);
  });

  // A server whose answers differ on every look would otherwise start a pass
  // each time and never be waited on.
  it("waits without comparing once that comparison has started a pass", async () => {
    const { scope, server } = await syncedInbox();
    server.deliver("INBOX", genericMessage("third"));
    const { options, stop } = watching({ compare: false });

    const waiting = server.nextWatch();
    const outcome = run(watchInbox(scope, options));
    await waiting;
    stop();

    await expect(outcome).resolves.toBe("quiet");
  });

  it("caches a flag changed elsewhere when the server reports it, and goes on waiting", async () => {
    const { scope, server, uids } = await syncedInbox();
    const { options, refreshes, stop } = watching();

    const waiting = server.nextWatch();
    const outcome = run(watchInbox(scope, options));
    await waiting;
    const waitingAgain = server.nextWatch();
    server.setFlags("INBOX", uids[0], []);
    await waitingAgain;

    expect(unreadThreads()).toBe(1);
    expect(refreshes.map((changes) => changes.changed.length)).toStrictEqual([
      1,
    ]);
    stop();
    await expect(outcome).resolves.toBe("quiet");
  });

  it("drops mail removed elsewhere when the server reports it", async () => {
    const { scope, server, uids } = await syncedInbox();
    const { options, stop } = watching();

    const waiting = server.nextWatch();
    const outcome = run(watchInbox(scope, options));
    await waiting;
    const waitingAgain = server.nextWatch();
    server.expunge("INBOX", uids[1]);
    await waitingAgain;

    expect(inboxCopies()).toBe(1);
    stop();
    await expect(outcome).resolves.toBe("quiet");
  });

  // The server tells the waiting connection about a change Kisa made on its
  // other one, often before that change has reached the cache. The refresh
  // waits its turn, finds the cache already right, and tells the windows
  // nothing.
  it("waits for a change Kisa is making itself, then finds nothing to write", async () => {
    const { scope, server } = await syncedInbox();
    const turn = Semaphore.makeUnsafe(1);
    const { options, refreshes, stop } = watching();

    const waiting = server.nextWatch();
    const outcome = run(
      watchInbox(
        { ...scope, exclusive: (effect) => turn.withPermit(effect) },
        options
      )
    );
    await waiting;
    const waitingAgain = server.nextWatch();
    await run(turn.withPermit(setThreadRead(scope, anyThreadId(), false)));
    await waitingAgain;

    expect(unreadThreads()).toBe(1);
    expect(refreshes).toStrictEqual([{ changed: [], removed: [] }]);
    stop();
    await expect(outcome).resolves.toBe("quiet");
  });

  // Outlook: nothing says which flags changed, so the newest copies are read.
  it("reads the newest copies' flags again on a server without mod-sequences", async () => {
    const { scope, server, uids } = await syncedInbox(
      OUTLOOK_CAPABILITIES,
      OUTLOOK_MAILBOXES
    );
    const { options, stop } = watching();

    const waiting = server.nextWatch();
    const outcome = run(watchInbox(scope, options));
    await waiting;
    const fetchesBefore = server.fetches.length;
    const waitingAgain = server.nextWatch();
    server.setFlags("INBOX", uids[0], []);
    await waitingAgain;

    expect(unreadThreads()).toBe(1);
    expect(server.fetches.slice(fetchesBefore)).toMatchObject([
      { changedSince: undefined, path: "INBOX" },
    ]);
    stop();
    await expect(outcome).resolves.toBe("quiet");
  });

  // The pass that follows takes mail the refresh cached as known, so the
  // refresh's own report is the only word of its arrival.
  it("ends the wait when a refresh is the first to see new mail, and says so", async () => {
    const { scope, server, uids } = await syncedInbox();
    const { options, refreshes } = watching();

    const waiting = server.nextWatch();
    const outcome = run(watchInbox(scope, options));
    await waiting;
    server.setFlags("INBOX", uids[0], []);
    server.deliver("INBOX", genericMessage("third"));

    await expect(outcome).resolves.toBe("arrived");
    expect(refreshes.map((changes) => changes.arrived?.length)).toStrictEqual([
      1,
    ]);
  });

  it("holds a second refresh back, and gives way at once when asked to stop", async () => {
    const { scope, server, uids } = await syncedInbox();
    const { options, refreshes, stop } = watching({
      refreshSpacingMs: 3_600_000,
    });

    const waiting = server.nextWatch();
    const outcome = run(watchInbox(scope, options));
    await waiting;
    const waitingAgain = server.nextWatch();
    server.setFlags("INBOX", uids[0], []);
    await waitingAgain;
    server.setFlags("INBOX", uids[1], []);
    stop();

    await expect(outcome).resolves.toBe("quiet");
    expect(refreshes).toHaveLength(1);
    expect(unreadThreads()).toBe(1);
  });

  it.effect("refreshes again at once when the spacing has passed", () =>
    Effect.gen(function* spaced() {
      const { scope, server, uids } = yield* Effect.promise(() =>
        syncedInbox()
      );
      const { options, refreshes, stop } = watching({ refreshSpacingMs: 2000 });

      const waiting = server.nextWatch();
      const fiber = yield* Effect.forkChild(watchInbox(scope, options));
      yield* Effect.promise(() => waiting);
      const waitingAgain = server.nextWatch();
      server.setFlags("INBOX", uids[0], []);
      yield* Effect.promise(() => waitingAgain);
      yield* TestClock.adjust(2000);
      const waitingOnceMore = server.nextWatch();
      server.setFlags("INBOX", uids[1], []);
      yield* Effect.promise(() => waitingOnceMore);

      expect(refreshes).toHaveLength(2);
      stop();
      expect(yield* Fiber.join(fiber)).toBe("quiet");
    }).pipe(Effect.provide(TestStore))
  );

  it("does not wait on a server without IDLE", async () => {
    const { scope, server } = await syncedInbox(["CONDSTORE"]);

    await expect(run(watchInbox(scope, watching().options))).resolves.toBe(
      "unavailable"
    );
    expect(server.watches).toStrictEqual([]);
  });

  it("does not wait before the account's mailboxes are known", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ICLOUD_CAPABILITIES);

    await expect(
      run(watchInbox(scopeFor(server, genericDialect), watching().options))
    ).resolves.toBe("unavailable");
  });
});

describe("waiting on Gmail, where the Inbox is a view of All Mail", () => {
  beforeEach(resetDatabase);

  it("compares All Mail, which is what a pass reads", async () => {
    const { scope, server } = await syncedGmail();
    server.deliver(ALL_MAIL, gmailMessage("201", "201"));

    await expect(run(watchInbox(scope, watching().options))).resolves.toBe(
      "ahead"
    );
    expect(server.watches).toStrictEqual([]);
  });

  it("waits in the Inbox, which is what the server reports on", async () => {
    const { scope, server } = await syncedGmail();

    const waiting = server.nextWatch();
    const outcome = run(watchInbox(scope, watching().options));
    await waiting;
    server.deliver("INBOX", gmailMessage("201", "201"));

    await expect(outcome).resolves.toBe("arrived");
    expect(server.watches).toStrictEqual(["INBOX"]);
  });

  it("answers a report on the Inbox by reading All Mail's changes", async () => {
    const { scope, server, uid } = await syncedGmail();
    const { options, stop } = watching();

    const waiting = server.nextWatch();
    const outcome = run(watchInbox(scope, options));
    await waiting;
    const waitingAgain = server.nextWatch();
    server.setFlags(ALL_MAIL, uid, []);
    server.report("INBOX", "changed");
    await waitingAgain;

    expect(threadRow("200")).toMatchObject({ is_unread: 1 });
    stop();
    await expect(outcome).resolves.toBe("quiet");
  });
});

describe(watchTargets, () => {
  beforeEach(resetDatabase);

  it("waits on Sent beside the Inbox where the Inbox is synced", async () => {
    const { scope } = await syncedInbox();

    await expect(run(targetsOf(scope))).resolves.toStrictEqual({
      extra: {
        arrivals: "refresh",
        cachedPath: "Sent Messages",
        path: "Sent Messages",
      },
      primary: { arrivals: "pass", cachedPath: "INBOX", path: "INBOX" },
    });
  });

  it("waits on All Mail beside the Inbox on Gmail, and reads All Mail for both", async () => {
    const { scope } = await syncedGmail();

    await expect(run(targetsOf(scope))).resolves.toStrictEqual({
      extra: { arrivals: "refresh", cachedPath: ALL_MAIL, path: ALL_MAIL },
      primary: { arrivals: "pass", cachedPath: ALL_MAIL, path: "INBOX" },
    });
  });

  it("waits on the Inbox alone where no folder is known to be Sent", async () => {
    const { scope } = await syncedInbox(ICLOUD_CAPABILITIES, [
      { path: "INBOX" },
      { path: "Receipts" },
    ]);

    await expect(run(targetsOf(scope))).resolves.toMatchObject({
      extra: undefined,
      primary: { path: "INBOX" },
    });
  });
});

describe("the wait beside the Inbox's", () => {
  beforeEach(resetDatabase);

  // Kisa's own sent copies land in Sent, and on Gmail every save of a draft
  // written elsewhere lands in All Mail: a pass for each would never rest.
  it("caches mail that arrives there in place, and goes on waiting", async () => {
    const { scope, server } = await syncedInbox();
    const { options, refreshes, stop } = watching();

    const waiting = server.nextWatch();
    const outcome = run(watchBeside(scope, options));
    await waiting;
    const waitingAgain = server.nextWatch();
    server.deliver("Sent Messages", genericMessage("sent"));
    await waitingAgain;

    expect(sentCopies()).toBe(1);
    expect(refreshes.map((changes) => changes.arrived?.length)).toStrictEqual([
      1,
    ]);
    stop();
    await expect(outcome).resolves.toBe("quiet");
  });

  it("caches mail that is already there before it waits", async () => {
    const { scope, server } = await syncedInbox();
    server.deliver("Sent Messages", genericMessage("sent"));
    const { options, stop } = watching();

    const waiting = server.nextWatch();
    const outcome = run(watchBeside(scope, options));
    await waiting;

    expect(sentCopies()).toBe(1);
    expect(server.watches).toStrictEqual(["Sent Messages"]);
    stop();
    await expect(outcome).resolves.toBe("quiet");
  });

  it("waits on All Mail for Gmail, and reads what arrives there", async () => {
    const { scope, server } = await syncedGmail();
    const { options, stop } = watching();

    const waiting = server.nextWatch();
    const outcome = run(watchBeside(scope, options));
    await waiting;
    const waitingAgain = server.nextWatch();
    server.deliver(ALL_MAIL, gmailMessage("201", "201", { gmailLabels: [] }));
    await waitingAgain;

    expect(threadRow("201")).toMatchObject({ is_in_inbox: 0 });
    expect(server.watches).toStrictEqual([ALL_MAIL, ALL_MAIL]);
    stop();
    await expect(outcome).resolves.toBe("quiet");
  });
});

/** Lets forked waits run as far as they can. */
const settle = Effect.forEach(
  Array.from({ length: 20 }),
  () => Effect.yieldNow,
  { discard: true }
);

/** A wait that ends only when asked to, and says how it ended. */
const untilStopped =
  (log: string[], name: string) => (stop: Deferred.Deferred<void>) =>
    Deferred.await(stop).pipe(
      Effect.andThen(
        Effect.sync(() => {
          log.push(`${name} stopped`);
        })
      ),
      Effect.as("quiet" as const),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          log.push(`${name} interrupted`);
        })
      )
    );

describe(watchTogether, () => {
  // Interrupting a wait drops its connection; the next pass only needs it to
  // finish.
  it.effect(
    "asks the wait beside the Inbox's to stop when that one ends, and waits for it",
    () =>
      Effect.gen(function* endsTogether() {
        const log: string[] = [];
        const stop: Deferred.Deferred<void> = Deferred.makeUnsafe();

        const outcome = yield* watchTogether(
          () => Effect.succeed("arrived" as const),
          [untilStopped(log, "beside")],
          stop
        );

        expect(outcome).toBe("arrived");
        expect(log).toStrictEqual(["beside stopped"]);
      })
  );

  // A third connection the server refuses must cost nothing: the account
  // then behaves as it did with one wait.
  it.effect(
    "keeps the Inbox's wait going when the one beside it fails or cannot run",
    () =>
      Effect.gen(function* additive() {
        const news: Deferred.Deferred<"arrived"> = Deferred.makeUnsafe();
        const stop: Deferred.Deferred<void> = Deferred.makeUnsafe();
        const asked: Deferred.Deferred<void>[] = [];

        const fiber = yield* Effect.forkScoped(
          watchTogether(
            (halt) => {
              asked.push(halt);
              return Deferred.await(news);
            },
            [
              () => Effect.fail("refused"),
              () => Effect.succeed("unavailable" as const),
            ],
            stop
          )
        );
        yield* settle;
        const [halt] = asked;
        expect(halt && Deferred.isDoneUnsafe(halt)).toBeFalsy();

        yield* Deferred.succeed(news, "arrived");
        expect(yield* Fiber.join(fiber)).toBe("arrived");
      })
  );

  it.effect(
    "fails as the Inbox's wait fails, once the one beside it has stopped",
    () =>
      Effect.gen(function* failsTogether() {
        const log: string[] = [];
        const stop: Deferred.Deferred<void> = Deferred.makeUnsafe();

        const failure = yield* Effect.flip(
          watchTogether(
            () => Effect.fail("connection lost"),
            [untilStopped(log, "beside")],
            stop
          )
        );

        expect(failure).toBe("connection lost");
        expect(log).toStrictEqual(["beside stopped"]);
      })
  );

  it.effect("asks every wait to stop when it is told to stop", () =>
    Effect.gen(function* stopsAll() {
      const log: string[] = [];
      const stop: Deferred.Deferred<void> = Deferred.makeUnsafe();

      const fiber = yield* Effect.forkScoped(
        watchTogether(
          untilStopped(log, "inbox"),
          [untilStopped(log, "beside")],
          stop
        )
      );
      yield* settle;
      yield* Deferred.succeed(stop, undefined);

      expect(yield* Fiber.join(fiber)).toBe("quiet");
      expect(log.toSorted()).toStrictEqual(["beside stopped", "inbox stopped"]);
    })
  );

  // Quit and disconnect: the connections are about to be closed.
  it.effect("interrupted, interrupts every wait", () =>
    Effect.gen(function* interruptsAll() {
      const log: string[] = [];
      const stop: Deferred.Deferred<void> = Deferred.makeUnsafe();

      const fiber = yield* Effect.forkScoped(
        watchTogether(
          untilStopped(log, "inbox"),
          [untilStopped(log, "beside")],
          stop
        )
      );
      yield* settle;
      yield* Fiber.interrupt(fiber);

      expect(log.toSorted()).toStrictEqual([
        "beside interrupted",
        "inbox interrupted",
      ]);
    })
  );
});
