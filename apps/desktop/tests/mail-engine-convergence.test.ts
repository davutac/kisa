// oxlint-disable typescript/no-unsafe-type-assertion
// The engine against a server that other clients change too. Each run is a
// seeded random sequence: mail arriving, moving, being flagged, labelled and
// deleted behind Kisa's back, folders coming and going, and Kisa's own
// actions between them. Some actions meet a change that lands just before
// their command or just before they read its result back, some lose the
// server's answer or that read, and some passes are cut short or run while
// mail changes under them.
//
// The claim: after every pass that nothing interrupted, the cache holds
// exactly what the server holds. The server's side of that comparison is
// read from the fake itself, never through the code being tested.
//
// The server is the fake. This shows the engine converging against what the
// fake models, not against Gmail, iCloud or Outlook themselves.
import { genericDialect, gmailDialect } from "@repo/mail/dialects";
import type { Dialect } from "@repo/mail/dialects";
import { SystemLabel, ThreadId } from "@repo/mail/ids";
import type { LabelId } from "@repo/mail/ids";
import { createLabel, deleteLabel, renameLabel } from "@repo/mail/labels";
import {
  conversationPlaces,
  labelsOfCopies,
  listedMessages,
} from "@repo/mail/listing";
import { applyThreadAction } from "@repo/mail/mutations";
import type { ThreadAction } from "@repo/mail/mutations";
import type { FetchedMessage } from "@repo/mail/session";
import { MailEngineStore } from "@repo/mail/store";
import {
  bodyStep,
  makeDriftMemory,
  relabelStep,
  skeletonStep,
  syncAccount,
  syncMailbox,
  toImapMailbox,
} from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { FakeImapServer } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  ICLOUD_MAILBOXES,
  OUTLOOK_CAPABILITIES,
  OUTLOOK_MAILBOXES,
  accountId,
  connection,
  genericMessage,
  gmailMessage,
  insertAccount,
  resetDatabase,
  run,
  scopeFor,
} from "./fixtures/mail-engine-harness";
import { stringList } from "./fixtures/rows";

/** Sequences per server, and what happens in each. */
const SEEDS = 10;
const STEPS = 40;

/** The least a server's sequences must have done for their result to count. */
const LEAST_EXERCISED = {
  "actions done": 60,
  "answers lost": 5,
  "changes landing mid-action": 5,
  "changes landing on an action's read": 10,
  "flag and label changes compared": 10,
  "passes changing": 15,
  "passes checked": 80,
  "passes cut short": 5,
  "reads dropped mid-action": 3,
};

interface Profile {
  readonly dialect: Dialect;
  readonly name: string;
  readonly provider: "gmail" | "icloud" | "outlook";
  readonly server: () => FakeImapServer;
}

const PROFILES: readonly Profile[] = [
  {
    dialect: gmailDialect,
    name: "Gmail",
    provider: "gmail",
    server: () =>
      new FakeImapServer(
        GMAIL_MAILBOXES,
        ["CONDSTORE", "IDLE", "X-GM-EXT-1"],
        ALL_MAIL
      ),
  },
  {
    dialect: genericDialect,
    name: "a server with mod-sequences",
    provider: "icloud",
    server: () => new FakeImapServer(ICLOUD_MAILBOXES, ["CONDSTORE", "IDLE"]),
  },
  {
    dialect: genericDialect,
    name: "a server without mod-sequences",
    provider: "outlook",
    server: () => new FakeImapServer(OUTLOOK_MAILBOXES, OUTLOOK_CAPABILITIES),
  },
];

// ------------------------------------------------------------------ chance

/** A number below `bound`, the next of a sequence the seed fixes. */
type Random = (bound: number) => number;

const makeRandom = (seed: number): Random => {
  let state = seed;

  return (bound) => {
    state = (state * 48_271) % 2_147_483_647;

    return state % bound;
  };
};

const pick = <Item>(random: Random, items: readonly Item[]): Item | undefined =>
  items.at(random(Math.max(items.length, 1)));

// ------------------------------------------------- the two sides, compared

const listed = (items: readonly string[]): string =>
  [...new Set(items)].toSorted().join(", ");

interface Copy {
  readonly flags: string;
  readonly labelIds: readonly string[];
  readonly labels: string;
  readonly messageId: string;
  readonly path: string;
  readonly threadId: string | null;
  readonly uid: number;
  readonly uidValidity: string;
}

const describeCopy = (copy: Copy): string =>
  `${copy.path} #${copy.uid} (validity ${copy.uidValidity}) message ${copy.messageId} flags [${copy.flags}] labels [${copy.labels}]`;

/** Every copy the server holds in a mailbox the dialect reads. */
const serverCopies = (
  profile: Profile,
  server: FakeImapServer
): readonly Copy[] => {
  const held = server.snapshot(profile.dialect.skeletonFields);

  const read = new Set(
    profile.dialect
      .syncedMailboxes(held.map(({ mailbox }) => mailbox))
      .map((mailbox) => mailbox.path)
  );

  return held.flatMap(({ mailbox, messages, uidValidity }) =>
    read.has(mailbox.path)
      ? messages.flatMap((message) => {
          const identity = profile.dialect.identify(message);
          const labelIds = profile.dialect.locationLabels(message, mailbox);

          return identity === undefined
            ? []
            : [
                {
                  flags: listed(message.flags),
                  labelIds,
                  labels: listed(labelIds),
                  messageId: identity.messageId,
                  path: mailbox.path,
                  threadId: identity.threadId,
                  uid: message.uid,
                  uidValidity: String(uidValidity),
                },
              ];
        })
      : []
  );
};

const cachedCopies = (): readonly Copy[] =>
  connection
    .prepare<
      unknown[],
      Omit<Copy, "labelIds"> & {
        readonly labels: string;
      }
    >(
      `SELECT l.mailbox_path AS path, l.uid AS uid,
                l.uid_validity AS uidValidity, l.flags AS flags,
                l.label_ids AS labels, l.message_id AS messageId,
                m.thread_id AS threadId
         FROM mail_message_locations l
         LEFT JOIN mail_messages m
           ON m.account_id = l.account_id AND m.message_id = l.message_id
         WHERE l.account_id = ?
         ORDER BY l.mailbox_path, l.uid`
    )
    .all(accountId)
    .map((row) => {
      const labelIds = stringList(row.labels);

      return {
        ...row,
        flags: listed(stringList(row.flags)),
        labelIds,
        labels: listed(labelIds),
      };
    });

const serverMailboxes = (
  profile: Profile,
  server: FakeImapServer
): readonly string[] => {
  const mailboxes = server.snapshot({}).map(({ mailbox }) => mailbox);

  const read = new Set(
    profile.dialect.syncedMailboxes(mailboxes).map((mailbox) => mailbox.path)
  );

  return mailboxes.map(
    (mailbox) =>
      `mailbox ${mailbox.path} (${read.has(mailbox.path) ? "read" : "listed"})`
  );
};

const cachedMailboxNames = (): readonly string[] =>
  connection
    .prepare<unknown[], { readonly path: string; readonly synced: number }>(
      "SELECT path, synced FROM mail_mailboxes WHERE account_id = ? ORDER BY path"
    )
    .all(accountId)
    .map(
      (row) => `mailbox ${row.path} (${row.synced === 1 ? "read" : "listed"})`
    );

/** What one side has and the other does not, a line each. */
const differences = (
  server: readonly string[],
  cache: readonly string[]
): readonly string[] => {
  const onServer = new Set(server);
  const inCache = new Set(cache);

  return [
    ...server.flatMap((line) => (inCache.has(line) ? [] : [`server: ${line}`])),
    ...cache.flatMap((line) => (onServer.has(line) ? [] : [`cache:  ${line}`])),
  ];
};

/** Where the cache differs from the server: mailboxes, then copies. */
const againstServer = (
  profile: Profile,
  server: FakeImapServer
): readonly string[] => [
  ...differences(serverMailboxes(profile, server), cachedMailboxNames()),
  ...differences(
    serverCopies(profile, server).map(describeCopy),
    cachedCopies().map(describeCopy)
  ),
];

const placeOf = (copy: Copy): string => `${copy.path} #${copy.uid}`;

/** The cached copies of one conversation, by place. */
const cachedCopiesOf = (threadId: string): ReadonlyMap<string, Copy> =>
  new Map(
    cachedCopies()
      .filter((copy) => copy.threadId === threadId)
      .map((copy) => [placeOf(copy), copy])
  );

/**
 * What a flag or label change cached, against the server: the conversation's
 * copies whose cached row is new or changed since `before`, and where each
 * differs from the server's copy at the same place. A copy the server no
 * longer has is left out: a pass finds that.
 */
const writtenAgainstServer = (
  profile: Profile,
  server: FakeImapServer,
  threadId: string,
  before: ReadonlyMap<string, Copy>
) => {
  const onServer = new Map(
    serverCopies(profile, server).map((copy) => [placeOf(copy), copy])
  );

  const written = [...cachedCopiesOf(threadId)].flatMap(([place, copy]) => {
    const was = before.get(place);
    const held = onServer.get(place);

    return (was !== undefined && describeCopy(was) === describeCopy(copy)) ||
      held === undefined
      ? []
      : [{ cached: describeCopy(copy), held: describeCopy(held) }];
  });

  return {
    differences: written.flatMap(({ cached, held }) =>
      cached === held ? [] : [`server: ${held}`, `cache:  ${cached}`]
    ),
    written: written.length,
  };
};

// ------------------------------------- the cache's rows, against each other

interface MessageRow {
  readonly isUnread: number;
  readonly labels: string;
  readonly messageId: string;
  readonly threadId: string;
}

const cachedMessages = (): readonly MessageRow[] =>
  connection
    .prepare<unknown[], MessageRow>(
      `SELECT message_id AS messageId, thread_id AS threadId,
              label_ids AS labels, is_unread AS isUnread
       FROM mail_messages WHERE account_id = ? ORDER BY message_id`
    )
    .all(accountId);

/** A message's labels are those of the copies it is listed by, and it has a copy. */
const messageRowDifferences = (
  copies: readonly Copy[],
  messages: readonly MessageRow[]
): readonly string[] => {
  const known = new Set(messages.map((message) => message.messageId));

  const fromRows = messages.map((message) => {
    const labels = stringList(message.labels);

    return `message ${message.messageId}: labels [${listed(labels)}], ${message.isUnread === 1 ? "unread" : "read"}`;
  });

  const fromCopies = messages.map((message) => {
    const own = copies.filter((copy) => copy.messageId === message.messageId);
    const labels = labelsOfCopies(own);

    return own.length === 0
      ? `message ${message.messageId}: no copy`
      : `message ${message.messageId}: labels [${listed(labels)}], ${labels.includes(SystemLabel.unread) ? "unread" : "read"}`;
  });

  return [
    ...copies.flatMap((copy) =>
      known.has(copy.messageId)
        ? []
        : [`copy without a message: ${describeCopy(copy)}`]
    ),
    ...differences(fromCopies, fromRows).map((line) =>
      line.replace("server:", "copies:").replace("cache: ", "row:   ")
    ),
  ];
};

interface ThreadRow {
  readonly isInInbox: number;
  readonly isInSent: number;
  readonly isInSpam: number;
  readonly isInTrash: number;
  readonly isUnread: number;
  readonly labels: string;
  readonly messageCount: number;
  readonly threadId: string;
}

const describeThread = (thread: {
  readonly count: number;
  readonly isInInbox: boolean;
  readonly isInSent: boolean;
  readonly isInSpam: boolean;
  readonly isInTrash: boolean;
  readonly isUnread: boolean;
  readonly labels: readonly string[];
  readonly threadId: string;
}): string =>
  `conversation ${thread.threadId}: ${thread.count} listed, ${thread.isUnread ? "unread" : "read"}, places [${[
    thread.isInInbox ? "inbox" : "",
    thread.isInSent ? "sent" : "",
    thread.isInSpam ? "spam" : "",
    thread.isInTrash ? "trash" : "",
  ]
    .filter((place) => place.length > 0)
    .join(" ")}], labels [${listed(thread.labels)}]`;

/** A conversation's row is what its messages make it, by the listing rule. */
const threadRowDifferences = (
  messages: readonly MessageRow[]
): readonly string[] => {
  const byThread = new Map<string, { readonly labelIds: string[] }[]>();

  for (const message of messages) {
    byThread.set(message.threadId, [
      ...(byThread.get(message.threadId) ?? []),
      { labelIds: [...stringList(message.labels)] },
    ]);
  }

  const fromMessages = [...byThread].map(([threadId, ofThread]) => {
    const group = listedMessages(ofThread);

    return describeThread({
      ...conversationPlaces(ofThread),
      count: group.length,
      isUnread: group.some((message) =>
        message.labelIds.includes(SystemLabel.unread)
      ),
      labels: group.flatMap((message) => message.labelIds),
      threadId,
    });
  });

  const fromRows = connection
    .prepare<unknown[], ThreadRow>(
      `SELECT thread_id AS threadId, message_count AS messageCount,
                is_in_inbox AS isInInbox, is_in_sent AS isInSent,
                is_in_spam AS isInSpam, is_in_trash AS isInTrash,
                is_unread AS isUnread, label_ids AS labels
         FROM mail_threads WHERE account_id = ? ORDER BY thread_id`
    )
    .all(accountId)
    .map((row) =>
      describeThread({
        count: row.messageCount,
        isInInbox: row.isInInbox === 1,
        isInSent: row.isInSent === 1,
        isInSpam: row.isInSpam === 1,
        isInTrash: row.isInTrash === 1,
        isUnread: row.isUnread === 1,
        labels: stringList(row.labels),
        threadId: row.threadId,
      })
    );

  return differences(fromMessages, fromRows).map((line) =>
    line.replace("server:", "messages:").replace("cache: ", "row:     ")
  );
};

/** Where the cache's own rows disagree with each other. */
const withinCache = (): readonly string[] => {
  const messages = cachedMessages();

  return [
    ...messageRowDifferences(cachedCopies(), messages),
    ...threadRowDifferences(messages),
  ];
};

// ---------------------------------------------------- what other clients do

/** One change, described before it is made so a failure can list it. */
interface Op {
  readonly apply: () => void;
  readonly describe: string;
}

interface HeldCopy {
  readonly message: FetchedMessage;
  readonly path: string;
}

const toggled = (items: readonly string[], item: string): readonly string[] =>
  items.includes(item)
    ? items.filter((other) => other !== item)
    : [...items, item];

/** The server as other clients change it. Every choice comes from `random`. */
const makeWorld = (
  profile: Profile,
  server: FakeImapServer,
  random: Random
) => {
  let made = 0;

  const serial = (): number => {
    made += 1;

    return made;
  };

  const isGmail = profile.dialect.kind === "gmail";
  const held = () => server.snapshot({ flags: true, gmail: true });
  const mailboxes = () => held().map(({ mailbox }) => mailbox);

  /** The mailboxes mail lives in, as the dialect reads them. */
  const stores = (): readonly string[] =>
    profile.dialect.syncedMailboxes(mailboxes()).map((mailbox) => mailbox.path);

  const folders = (): readonly string[] =>
    profile.dialect.userLabels(mailboxes()).map((label) => label.path);

  const copies = (): readonly HeldCopy[] => {
    const read = new Set(stores());

    return held().flatMap(({ mailbox, messages }) =>
      read.has(mailbox.path)
        ? messages.map((message) => ({ message, path: mailbox.path }))
        : []
    );
  };

  const holds = (path: string, uid: number): boolean =>
    copies().some((copy) => copy.path === path && copy.message.uid === uid);

  const someFlags = (): readonly string[] =>
    ["\\Seen", "\\Flagged"].filter(
      (_, index) => random(index === 0 ? 2 : 4) === 0
    );

  const arriveInGmail = (): Op => {
    const id = 1000 + serial();
    const thread = 500 + random(Math.ceil(made / 2));
    const spam = mailboxes().find((mailbox) => mailbox.role === "junk")?.path;
    const path = spam !== undefined && random(8) === 0 ? spam : ALL_MAIL;

    const labels =
      path === ALL_MAIL
        ? ["\\Inbox", "\\Important", ...folders()].filter((_, index) =>
            index === 0 ? random(4) !== 0 : random(4) === 0
          )
        : [];

    const message = gmailMessage(String(id), String(thread), {
      flags: someFlags(),
      gmailLabels: labels,
    });

    return {
      apply: () => {
        server.deliver(path, message);
      },
      describe: `elsewhere: mail ${id} of conversation ${thread} arrives in ${path} labelled [${labels.join(" ")}]`,
    };
  };

  const arriveInFolder = (): Op => {
    const id = serial();
    const path = pick(random, ["INBOX", "INBOX", "INBOX", ...stores()]);
    const parent = id > 1 && random(3) === 0 ? 1 + random(id - 1) : undefined;
    const flags = someFlags();

    const message =
      parent === undefined
        ? genericMessage(`m${id}`, { flags })
        : genericMessage(`m${id}`, {
            flags,
            headers: { references: `<m${parent}@example.com>` },
          });

    return {
      apply: () => {
        if (path !== undefined && stores().includes(path)) {
          server.deliver(path, message);
        }
      },
      describe: `elsewhere: mail m${id} arrives in ${path}${parent === undefined ? "" : `, a reply to m${parent}`}`,
    };
  };

  const arrive = (): Op => (isGmail ? arriveInGmail() : arriveInFolder());

  /** What another client can do to one copy. */
  const changesTo = ({ message, path }: HeldCopy): readonly Op[] => {
    const { uid } = message;

    const destination = pick(
      random,
      stores().filter((other) => other !== path)
    );

    const flag = random(2) === 0 ? "\\Seen" : "\\Flagged";
    const label = pick(random, ["\\Inbox", "\\Important", ...folders()]);

    const ops: Op[] = [
      {
        apply: () => {
          server.setFlags(path, uid, toggled(message.flags, flag));
        },
        describe: `elsewhere: ${flag} toggled on ${path} #${uid}`,
      },
    ];

    if (destination !== undefined) {
      ops.push({
        apply: () => {
          if (holds(path, uid) && stores().includes(destination)) {
            server.move(path, uid, destination);
          }
        },
        describe: `elsewhere: ${path} #${uid} moved to ${destination}`,
      });
    }

    if (destination !== undefined && !isGmail) {
      ops.push({
        apply: () => {
          if (holds(path, uid) && stores().includes(destination)) {
            server.copy(path, uid, destination);
          }
        },
        describe: `elsewhere: ${path} #${uid} copied to ${destination}`,
      });
    }

    // Gmail keeps a message in All Mail until it is trashed.
    if (!isGmail || path !== ALL_MAIL) {
      ops.push({
        apply: () => {
          server.expunge(path, uid);
        },
        describe: `elsewhere: ${path} #${uid} deleted for good`,
      });
    }

    if (isGmail && path === ALL_MAIL && label !== undefined) {
      ops.push({
        apply: () => {
          server.setGmailLabels(
            path,
            uid,
            toggled(message.gmailLabels ?? [], label)
          );
        },
        describe: `elsewhere: label ${label} toggled on ${path} #${uid}`,
      });
    }

    return ops;
  };

  /** A label or folder made, renamed or deleted in another client. */
  const folderChanges = (): readonly Op[] => {
    const name = `${isGmail ? "Label" : "Folder"} ${serial()}`;
    const existing = pick(random, folders());

    const ops: Op[] = [
      {
        apply: () => {
          server.addMailbox(name);
        },
        describe: `elsewhere: ${name} created`,
      },
    ];

    if (existing !== undefined) {
      ops.push(
        {
          apply: () => {
            if (folders().includes(existing)) {
              server.removeMailbox(existing);
            }
          },
          describe: `elsewhere: ${existing} deleted`,
        },
        {
          apply: () => {
            if (folders().includes(existing)) {
              server.renameMailbox(existing, name);
            }
          },
          describe: `elsewhere: ${existing} renamed to ${name}`,
        }
      );
    }

    return ops;
  };

  /** A mailbox rebuilt by its server: every copy under a new UID. */
  const rebuild = (): Op => {
    const path = pick(random, stores());

    return {
      apply: () => {
        if (path !== undefined && stores().includes(path)) {
          server.resetUidValidity(path);
        }
      },
      describe: `elsewhere: ${path} rebuilt under a new UIDVALIDITY`,
    };
  };

  const external = (): Op => {
    const roll = random(20);
    const copy = pick(random, copies());

    if (roll < 6 || copy === undefined) {
      return arrive();
    }

    if (roll < 17) {
      return pick(random, changesTo(copy)) ?? arrive();
    }

    return roll < 19 ? (pick(random, folderChanges()) ?? arrive()) : rebuild();
  };

  /**
   * A change that lands while Kisa acts: mostly on a copy Kisa is acting on,
   * which is where its picture of that copy goes stale.
   */
  const meanwhile = (
    targets: readonly { readonly path: string; readonly uid: number }[]
  ): Op => {
    const target = pick(
      random,
      copies().filter((copy) =>
        targets.some(
          (wanted) =>
            wanted.path === copy.path && wanted.uid === copy.message.uid
        )
      )
    );

    return target === undefined || random(3) === 0
      ? external()
      : (pick(random, changesTo(target)) ?? external());
  };

  return { arrive, external, meanwhile, serial };
};

// ------------------------------------------------------------ what Kisa does

interface KisaAction {
  readonly describe: string;
  readonly effect: Effect.Effect<
    unknown,
    { readonly _tag: string },
    MailEngineStore
  >;
  /**
   * Whether the action is a flag or label store, which reads its copies
   * back, and not a move or copy, which reads whole mailboxes.
   */
  readonly stores?: boolean;
  /** The conversation acted on, when the action is on one. */
  readonly threadId?: string;
}

const isStore = (scope: SyncScope, action: ThreadAction): boolean =>
  action.kind === "setRead" ||
  (action.kind === "setLabel" &&
    (scope.dialect.kind === "gmail" || action.labelId === SystemLabel.starred));

/** Ways an action or a disturbed pass ends that are not a fault of Kisa's. */
const EXPECTED_ENDINGS: ReadonlySet<string> = new Set([
  "done",
  "MailboxMissingError",
  "MailConnectionError",
  "MailProtocolError",
]);

/** Runs to the end and says how it ended: `done`, or the failure's tag. */
const attempt = (
  effect: Effect.Effect<unknown, { readonly _tag: string }, MailEngineStore>
): Promise<string> =>
  run(
    effect.pipe(
      Effect.match({
        onFailure: (error) => error._tag,
        onSuccess: () => "done",
      })
    )
  );

const cachedMailboxes = () =>
  run(
    Effect.gen(function* readMailboxes() {
      const store = yield* MailEngineStore;

      return yield* store.getMailboxes(accountId);
    })
  );

const cachedThreadIds = (): readonly string[] =>
  connection
    .prepare<unknown[], { readonly threadId: string }>(
      "SELECT thread_id AS threadId FROM mail_threads WHERE account_id = ? ORDER BY thread_id"
    )
    .all(accountId)
    .map((row) => row.threadId);

const threadActions = (labels: readonly LabelId[]): readonly ThreadAction[] => [
  { kind: "setRead", read: true },
  { kind: "setRead", read: false },
  { applied: true, kind: "setLabel", labelId: SystemLabel.starred },
  { applied: false, kind: "setLabel", labelId: SystemLabel.starred },
  { applied: false, kind: "setLabel", labelId: SystemLabel.inbox },
  { applied: true, kind: "setLabel", labelId: SystemLabel.inbox },
  { kind: "trash" },
  { kind: "moveToSpam" },
  { kind: "moveToInbox" },
  { kind: "deleteForever" },
  ...labels.flatMap((labelId): ThreadAction[] => [
    { applied: true, kind: "setLabel", labelId },
    { applied: false, kind: "setLabel", labelId },
  ]),
];

/** Something a user does next: mostly to a conversation, sometimes a label. */
const chooseAction = async (
  scope: SyncScope,
  random: Random,
  serial: () => number
): Promise<KisaAction | undefined> => {
  const mailboxes = await cachedMailboxes();
  const labels = scope.dialect.userLabels(mailboxes.map(toImapMailbox));
  const label = pick(random, labels);
  const roll = random(12);

  if (roll === 0) {
    const name = `Made ${serial()}`;

    return {
      describe: `create label ${name}`,
      effect: createLabel(scope, name),
    };
  }

  if (roll === 1 && label !== undefined) {
    const name = `Named ${serial()}`;

    return {
      describe: `rename label ${label.name} to ${name}`,
      effect: renameLabel(scope, label.id, name),
    };
  }

  if (roll === 2 && label !== undefined) {
    return {
      describe: `delete label ${label.name}`,
      effect: deleteLabel(scope, label.id),
    };
  }

  const threadId = pick(random, cachedThreadIds());
  const action = pick(random, threadActions(labels.map((entry) => entry.id)));

  return threadId === undefined || action === undefined
    ? undefined
    : {
        describe: `${JSON.stringify(action)} on conversation ${threadId}`,
        effect: applyThreadAction(scope, [ThreadId.make(threadId)], action),
        stores: isStore(scope, action),
        threadId,
      };
};

/** A step repeated until it has nothing left to do. */
const toEnd = <E, R>(step: Effect.Effect<unknown, E, R>) =>
  Effect.gen(function* walk() {
    for (let turn = 0; turn < 200; turn += 1) {
      if ((yield* step) === undefined) {
        return;
      }
    }

    return yield* Effect.die(new Error("a walk did not finish"));
  });

/** A background pass with the walks that follow it, each to its end. */
const fullPass = (scope: SyncScope) =>
  Effect.gen(function* passAndWalks() {
    yield* syncAccount(scope);
    yield* toEnd(skeletonStep(scope));
    yield* toEnd(relabelStep(scope));
  });

// ------------------------------------------------------------- one sequence

interface Findings {
  /** The cache differing from the server after an undisturbed pass. */
  readonly afterPass: string[];
  /** A flag or label change caching a copy the server holds differently. */
  readonly afterStore: string[];
  readonly counts: Map<string, number>;
  /** Actions and passes that ended in a way no server explains. */
  readonly failures: string[];
  /** The cache's rows disagreeing with each other after such a pass. */
  readonly withinCache: string[];
}

const exploreSeed = async (
  profile: Profile,
  seed: number,
  repair: boolean,
  found: Findings
): Promise<void> => {
  await run(
    Effect.gen(function* forgetAccount() {
      const store = yield* MailEngineStore;
      yield* store.clearAccount(accountId);
    })
  );
  resetDatabase();
  insertAccount(profile.dialect.kind, profile.provider);

  const random = makeRandom(seed);
  const server = profile.server();
  const scope = scopeFor(server, profile.dialect);

  const passScope: SyncScope = {
    ...scope,
    drift: repair ? makeDriftMemory() : undefined,
  };

  const world = makeWorld(profile, server, random);
  const steps: string[] = [];

  const count = (what: string): void => {
    found.counts.set(what, (found.counts.get(what) ?? 0) + 1);
  };

  const where = (): string =>
    `${profile.name}, seed ${seed}, after step ${steps.length} (${steps.at(-1) ?? "start"})`;

  const report = (into: string[], lines: readonly string[]): boolean => {
    if (lines.length > 0) {
      into.push(
        [
          where(),
          ...lines.map((line) => `  ${line}`),
          `  steps: ${steps.join("; ")}`,
        ].join("\n")
      );
    }

    return lines.length > 0;
  };

  const noteEnding = (ending: string): void => {
    if (!EXPECTED_ENDINGS.has(ending)) {
      report(found.failures, [`ended with ${ending}`]);
    }
  };

  /** Whether the cache was found wrong, which ends the sequence. */
  const checkedPass = async (): Promise<boolean> => {
    steps.push("pass");
    const ending = await attempt(fullPass(passScope));

    if (ending !== "done") {
      return report(found.failures, [
        `an undisturbed pass ended with ${ending}`,
      ]);
    }

    count("passes checked");
    const differs = report(found.afterPass, againstServer(profile, server));

    return report(found.withinCache, withinCache()) || differs;
  };

  const act = async (): Promise<void> => {
    const action = await chooseAction(scope, random, world.serial);

    if (action === undefined) {
      steps.push("Kisa: nothing cached to act on");

      return;
    }

    const { threadId } = action;

    const before =
      action.stores === true && threadId !== undefined
        ? cachedCopiesOf(threadId)
        : undefined;

    const variant = random(10);
    let disturbance = "";

    const meanwhile = () =>
      world.meanwhile(
        cachedCopies().filter((copy) => copy.threadId === threadId)
      );

    if (variant >= 2 && variant < 5) {
      const change = meanwhile();
      server.beforeCommand = () => {
        server.beforeCommand = undefined;
        disturbance = `, while ${change.describe}`;
        count("changes landing mid-action");
        change.apply();
      };
    } else if (variant >= 5 && variant < 7) {
      server.loseAnswer = () => {
        server.loseAnswer = undefined;
        disturbance = ", and the answer is lost";
        count("answers lost");

        return true;
      };
    } else if (variant >= 7 && variant < 9) {
      // After the command and before Kisa reads what it left.
      const change = meanwhile();
      server.onRead = () => {
        server.onRead = undefined;
        disturbance = `, and before it is read back ${change.describe}`;
        count("changes landing on an action's read");
        change.apply();
      };
    } else if (variant === 9) {
      server.dropFetch = () => {
        server.dropFetch = undefined;
        disturbance = ", and the read after it is dropped";
        count("reads dropped mid-action");

        return true;
      };
    }

    const ending = await attempt(action.effect);
    server.beforeCommand = undefined;
    server.loseAnswer = undefined;
    server.onRead = undefined;
    server.dropFetch = undefined;
    steps.push(`Kisa: ${action.describe}${disturbance} -> ${ending}`);
    noteEnding(ending);
    count(ending === "done" ? "actions done" : "actions refused or failed");

    if (ending === "done" && before !== undefined && threadId !== undefined) {
      const cached = writtenAgainstServer(profile, server, threadId, before);

      if (cached.written > 0) {
        count("flag and label changes compared");
      }

      report(found.afterStore, cached.differences);
    }
  };

  /** One mailbox brought up to date, as a report from the server causes. */
  const refresh = async (): Promise<void> => {
    const mailboxes = await cachedMailboxes();

    const record = pick(
      random,
      mailboxes.filter((mailbox) => mailbox.synced)
    );

    if (record === undefined) {
      return;
    }

    const ending = await attempt(
      syncMailbox(scope, toImapMailbox(record), record, {
        rereadFlags: "newest",
      })
    );

    steps.push(`Kisa: refresh ${record.path} -> ${ending}`);
    noteEnding(ending);
  };

  /** A pass that other clients change mail under, or that is cut short. */
  const disturbedPass = async (kind: "changing" | "cut short") => {
    steps.push(`pass, ${kind}`);

    if (kind === "changing") {
      server.onRead = () => {
        if (random(4) === 0) {
          const change = world.external();
          steps.push(`  during it, ${change.describe}`);
          change.apply();
        }
      };
    } else {
      server.dropFetch = () => random(3) === 0;
    }

    const ending = await attempt(fullPass(passScope));
    server.onRead = undefined;
    server.dropFetch = undefined;
    steps.push(`  -> ${ending}`);
    noteEnding(ending);
    count(`passes ${kind}`);
  };

  const arrivals = 3 + random(8);

  for (let index = 0; index < arrivals; index += 1) {
    world.arrive().apply();
  }

  if (await checkedPass()) {
    return;
  }

  for (let step = 0; step < STEPS; step += 1) {
    const roll = random(10);

    if (roll < 4) {
      const change = world.external();
      steps.push(change.describe);
      change.apply();
    } else if (roll < 8) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- One step after another.
      await act();
    } else {
      // oxlint-disable-next-line eslint/no-await-in-loop -- One step after another.
      await refresh();
    }

    const then = step === STEPS - 1 ? 0 : random(20);

    if (then < 6) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- One step after another.
      if (await checkedPass()) {
        return;
      }
    } else if (then < 9) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- One step after another.
      await disturbedPass(then < 8 ? "changing" : "cut short");
    }
  }
};

const explorations = new Map<string, Promise<Findings>>();

/** Every sequence for one server, run once however many tests read it. */
const explore = (profile: Profile, repair: boolean): Promise<Findings> => {
  const key = `${profile.name} ${repair}`;

  const started =
    explorations.get(key) ??
    (async () => {
      const found: Findings = {
        afterPass: [],
        afterStore: [],
        counts: new Map(),
        failures: [],
        withinCache: [],
      };

      for (let seed = 1; seed <= SEEDS; seed += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- The sequences share one database.
        await exploreSeed(profile, seed, repair, found);
      }

      return found;
    })();

  explorations.set(key, started);

  return started;
};

describe.each(PROFILES)("random changes on $name", (profile) => {
  it("leave the cache holding what the server holds after every pass", async () => {
    const found = await explore(profile, false);

    expect(found.afterPass).toStrictEqual([]);
  });

  it("leave it so with the drift repair on as well", async () => {
    const found = await explore(profile, true);

    expect(found.failures).toStrictEqual([]);
    expect(found.withinCache).toStrictEqual([]);
    expect(found.afterPass).toStrictEqual([]);
  });

  it("have every flag and label change cache its copies as the server holds them", async () => {
    const found = await explore(profile, false);

    expect(found.afterStore).toStrictEqual([]);
  });

  it("leave the cache's own rows agreeing with each other", async () => {
    const found = await explore(profile, false);

    expect(found.withinCache).toStrictEqual([]);
  });

  it("end no action or pass in a way a server does not explain", async () => {
    const found = await explore(profile, false);

    expect(found.failures).toStrictEqual([]);
  });

  // Without this the tests above could pass on sequences where every action
  // was refused and nothing was ever compared.
  it("are sequences that act, disturb and compare", async () => {
    const { counts } = await explore(profile, false);

    expect(
      Object.entries(LEAST_EXERCISED).filter(
        ([what, least]) => (counts.get(what) ?? 0) < least
      )
    ).toStrictEqual([]);
  });
});

/** A fresh account and its server, for the cases below. */
const freshAccount = (profile: Profile) => {
  resetDatabase();
  insertAccount(profile.dialect.kind, profile.provider);
  const server = profile.server();
  const scope = scopeFor(server, profile.dialect);
  const path = profile.dialect.kind === "gmail" ? ALL_MAIL : "INBOX";

  const mail = (id: number) =>
    profile.dialect.kind === "gmail"
      ? gmailMessage(String(1000 + id), String(500 + id))
      : genericMessage(`m${id}`);

  return { mail, path, scope, server };
};

/** A fresh account whose first mail is cached. */
const syncedAccount = async (profile: Profile) => {
  const account = freshAccount(profile);
  account.server.deliver(account.path, account.mail(1));
  await run(fullPass(account.scope));

  return account;
};

/**
 * A fresh account whose walk has not started: its first mail is on the
 * server and not cached, and the mail that arrived after it is.
 */
const unwalkedAccount = async (profile: Profile) => {
  const account = freshAccount(profile);
  account.server.deliver(account.path, account.mail(1));
  await run(syncAccount(account.scope));
  account.server.deliver(account.path, account.mail(2));
  await run(syncAccount(account.scope));

  return account;
};

const cachedUids = (path: string): readonly number[] =>
  cachedCopies()
    .filter((copy) => copy.path === path)
    .map((copy) => copy.uid);

/**
 * Mail arrives, and the pass that caches it loses its connection before
 * it saves the mailbox's progress.
 */
const cachedWithoutProgress = async (
  { mail, path, scope, server }: ReturnType<typeof freshAccount>,
  ids: readonly number[]
) => {
  const uids = ids.map((id) => server.deliver(path, mail(id)));
  // The fetch of the new mail is by UID; the one after it is by range.
  server.dropFetch = (_path, selection) => selection.kind === "range";
  const cutShort = await attempt(syncAccount(scope));
  server.dropFetch = undefined;

  return { cached: cachedUids(path), cutShort, uids };
};

// What the sequences above found when run in the hundreds. A pass caches
// arriving mail and saves how far the mailbox was read in separate steps.
// Cut short between them, it leaves copies the saved count does not include,
// and when such mail leaves the server before the next pass, the count the
// server gives matches the saved one. So a pass holds every copy cached at
// or above the saved UIDNEXT against the UIDs it lists there.
describe.each(PROFILES)("a pass cut short on $name", (profile) => {
  it("leaves no copy behind of mail that left before the next pass", async () => {
    const account = await syncedAccount(profile);

    const { cached, cutShort, uids } = await cachedWithoutProgress(
      account,
      [2, 3]
    );

    const [left = 0] = uids;
    account.server.expunge(account.path, left);

    await run(fullPass(account.scope));

    expect(cutShort).toBe("MailConnectionError");
    expect(cached).toStrictEqual([1, ...uids]);
    expect(againstServer(profile, account.server)).toStrictEqual([]);
  });

  it("leaves none behind in a mailbox whose older mail is not cached yet", async () => {
    const account = await unwalkedAccount(profile);

    const { cached, cutShort, uids } = await cachedWithoutProgress(
      account,
      [3, 4]
    );

    const [left = 0, stayed = 0] = uids;
    account.server.expunge(account.path, left);

    await run(syncAccount(account.scope));

    expect(cutShort).toBe("MailConnectionError");
    expect(cached).toStrictEqual([2, ...uids]);
    expect(cachedUids(account.path)).toStrictEqual([2, stayed]);
  });
});

// A flag or label change reads its copies back from the server, so what it
// caches is what the server holds, with another client's change to the same
// copy in it. Written as Kisa expected the server to have applied it, the
// row would be one the server never held, until a pass read the copy again.
describe.each(PROFILES)(
  "an action on $name as another client changes the same copy",
  (profile) => {
    /** Kisa marks a read message unread just as another client stars it. */
    const markedUnreadWhileStarred = async () => {
      const { path, scope, server } = await syncedAccount(profile);
      const [threadId = ""] = cachedThreadIds();
      server.beforeCommand = () => {
        server.beforeCommand = undefined;
        server.setFlags(path, 1, ["\\Seen", "\\Flagged"]);
      };

      await run(
        applyThreadAction(scope, [ThreadId.make(threadId)], {
          kind: "setRead",
          read: false,
        })
      );

      return { scope, server };
    };

    it("caches the copy as the server holds it", async () => {
      const { server } = await markedUnreadWhileStarred();

      expect(againstServer(profile, server)).toStrictEqual([]);
    });

    it("has the copy as the server holds it after the next pass", async () => {
      const { scope, server } = await markedUnreadWhileStarred();

      await run(fullPass(scope));

      expect(againstServer(profile, server)).toStrictEqual([]);
    });
  }
);

// What the check of flag and label changes found when run in the hundreds.
// A command names mail by UID, and a UID names a message only under the
// UIDVALIDITY it was cached under. In a mailbox rebuilt since, the same UID
// is other mail. So every such command carries the UIDVALIDITY of the copies
// it names, and is refused before anything is sent when the mailbox has
// another. The pass that follows starts the mailbox over.
const REBUILT_CHANGES: readonly {
  readonly action: ThreadAction;
  readonly name: string;
  /** Whether the mail is in Trash when the mailbox is rebuilt. */
  readonly trashed: boolean;
}[] = [
  {
    action: { applied: true, kind: "setLabel", labelId: SystemLabel.starred },
    name: "a star",
    trashed: false,
  },
  { action: { kind: "trash" }, name: "a move to Trash", trashed: false },
  {
    action: { kind: "deleteForever" },
    name: "a delete forever",
    trashed: true,
  },
];

const bodyStates = (): readonly string[] =>
  connection
    .prepare<unknown[], { readonly state: string }>(
      "SELECT body_state AS state FROM mail_messages WHERE account_id = ? ORDER BY message_id"
    )
    .all(accountId)
    .map((row) => row.state);

describe.each(PROFILES)(
  "a mailbox on $name rebuilt since it was cached",
  (profile) => {
    /**
     * Two mails are cached in one mailbox. Elsewhere the first is deleted
     * and the mailbox is rebuilt, so the first mail's UID is the second mail
     * now. Returns the first mail's conversation and what the server holds.
     */
    const rebuilt = async (trashed: boolean) => {
      const { mail, path, scope, server } = await syncedAccount(profile);
      server.deliver(path, mail(2));
      await run(fullPass(scope));

      if (trashed) {
        await run(
          applyThreadAction(
            scope,
            cachedThreadIds().map((id) => ThreadId.make(id)),
            { kind: "trash" }
          )
        );
        await run(fullPass(scope));
      }

      const mailboxes = await cachedMailboxes();

      const where = trashed
        ? (mailboxes.find((mailbox) => mailbox.role === "trash")?.path ?? "")
        : path;

      const first = cachedCopies().find(
        (copy) => copy.path === where && copy.uid === 1
      )?.threadId;

      server.expunge(where, 1);
      server.resetUidValidity(where);

      return {
        first: ThreadId.make(first ?? ""),
        held: serverCopies(profile, server).map(describeCopy),
        scope,
        server,
      };
    };

    it.each(REBUILT_CHANGES)(
      "refuses $name there and leaves the other mail as it is",
      async ({ action, trashed }) => {
        const { first, held, scope, server } = await rebuilt(trashed);

        const ending = await attempt(applyThreadAction(scope, [first], action));
        const after = serverCopies(profile, server).map(describeCopy);
        await run(fullPass(scope));

        expect(held).toHaveLength(1);
        expect(after).toStrictEqual(held);
        expect(ending).toBe("MailboxMissingError");
        expect(againstServer(profile, server)).toStrictEqual([]);
      }
    );

    it("stores no body there, where it would be other mail's", async () => {
      const { scope } = await rebuilt(false);

      const ending = await attempt(bodyStep(scope));

      expect(bodyStates()).toStrictEqual(["none", "none"]);
      expect(ending).toBe("MailboxMissingError");
    });
  }
);

// The drift repair compares counts, and counts cannot tell a cache that is
// right from one that is wrong twice: a copy too many beside a copy too few.
// So it is exact only from a cache that was exact before.
describe("a cache with one copy too many and one too few", () => {
  it.fails("is noticed by a pass with the drift repair", async () => {
    const [, profile = PROFILES[0]] = PROFILES;
    const { mail, path, scope, server } = await syncedAccount(profile);
    server.deliver(path, mail(2));
    await run(fullPass(scope));
    // UID 2 is lost from the cache, and UID 9 is a copy the server lacks.
    connection
      .prepare(
        "UPDATE mail_message_locations SET uid = 9 WHERE account_id = ? AND mailbox_path = ? AND uid = 2"
      )
      .run(accountId, path);

    await run(fullPass({ ...scope, drift: makeDriftMemory() }));

    expect(againstServer(profile, server)).toStrictEqual([]);
  });
});
