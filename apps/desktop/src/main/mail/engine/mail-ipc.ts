import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { mailLabels } from "@repo/database/schemas";
import { LabelId } from "@repo/mail/ids";
import type { ThreadAction } from "@repo/mail/mutations";
import { and, eq } from "drizzle-orm";
import { Effect, Exit } from "effect";

import type {
  MailMessageSendRequest,
  MailThreadMessageSendRequest,
  MailSendOutcome,
  MailBulkThreadMutationOperation,
  MailBulkThreadMutationRequest,
  MailBulkThreadMutationResult,
  MailCachedThreadPageRequest,
  MailLabelCatalogRequest,
  MailLabelCreateRequest,
  MailLabelDeleteRequest,
  MailLabelInputColor,
  MailLabelSummary,
  MailLabelUpdateRequest,
  MailSpamStatusRequest,
  MailUnreadLabelsRequest,
  MailThreadLabelRequest,
  MailThreadLoadRequest,
  MailThreadReadStateRequest,
  MailThreadRequest,
} from "../../../shared/ipc/mail";
import {
  OutgoingAttachmentAuthorizationError,
  outgoingAttachmentAuthorizations,
} from "../outgoing-attachment-authorizations";
import { MailDatabase } from "./mail-database";
import {
  MailEngineError,
  applyThreadActions,
  createAccountLabel,
  deleteAccountLabel,
  inAccountEngine,
  inEngine,
  loadThread,
  partitionReportable,
  renameAccountLabel,
  requestMailSync,
  setThreadReadState,
} from "./mail-engine";
import {
  readHasUnreadSpam,
  readLabelCatalog,
  readThreadPage,
  readUnreadLabels,
} from "./mail-reads";
import { sendNewMessage, sendThreadMessage } from "./mail-send";

// The renderer-facing operations over the engine's cache. Each one reads
// SQLite through the database process; only opening a conversation and
// changing read state may reach the mail server.

const readDatabase = <A>(
  message: string,
  run: (database: RemoteDatabaseClient) => Promise<A>
) =>
  inEngine(
    Effect.gen(function* readMailDatabase() {
      const database = yield* MailDatabase;
      return yield* database.use(message, run);
    })
  );

export const listCachedThreadPage = (request: MailCachedThreadPageRequest) =>
  readDatabase("Could not load email", (database) =>
    readThreadPage(database, request)
  );

export const listLabelCatalog = (request: MailLabelCatalogRequest) =>
  readDatabase("Could not load labels", (database) =>
    readLabelCatalog(database, request.accountId)
  );

/**
 * Labels and folders are listed by every sync, so a refresh is a sync of the
 * account; the catalog returned is what the cache has now.
 */
export const refreshLabelCatalog = (request: MailLabelCatalogRequest) =>
  Effect.sync(() => {
    requestMailSync(request.accountId);
  }).pipe(Effect.andThen(listLabelCatalog(request)));

export const loadSpamStatus = (request: MailSpamStatusRequest) =>
  readDatabase("Could not check spam", async (database) => ({
    hasUnreadSpam: await readHasUnreadSpam(database, request.accountIds),
  }));

export const loadUnreadLabels = (request: MailUnreadLabelsRequest) =>
  readDatabase("Could not check labels", (database) =>
    readUnreadLabels(database, request.accountIds)
  );

export const openThread = (request: MailThreadLoadRequest) =>
  inAccountEngine(request.accountId, loadThread(request));

export const changeThreadReadState = (request: MailThreadReadStateRequest) =>
  inAccountEngine(
    request.accountId,
    setThreadReadState({
      accountId: request.accountId,
      isRead: !request.isUnread,
      threadId: request.threadId,
    })
  );

const actOnThread = (request: MailThreadRequest, action: ThreadAction) =>
  inAccountEngine(
    request.accountId,
    applyThreadActions(request.accountId, [request.threadId], action)
  );

export const setThreadLabel = (request: MailThreadLabelRequest) =>
  actOnThread(request, {
    applied: request.applied,
    kind: "setLabel",
    labelId: LabelId.make(request.labelId),
  });

export const trashThread = (request: MailThreadRequest) =>
  actOnThread(request, { kind: "trash" });

export const deleteThreadForever = (request: MailThreadRequest) =>
  actOnThread(request, { kind: "deleteForever" });

/** Out of Spam (or Trash) and back into the Inbox. */
export const markThreadNotSpam = (request: MailThreadRequest) =>
  actOnThread(request, { kind: "moveToInbox" });

/** Into Spam: every copy but the user's own sent mail and drafts. */
export const reportThreadSpam = (request: MailThreadRequest) =>
  actOnThread(request, { kind: "moveToSpam" });

const toThreadAction = (
  operation: MailBulkThreadMutationOperation
): ThreadAction => {
  switch (operation.kind) {
    case "setLabel": {
      return {
        applied: operation.applied,
        kind: "setLabel",
        labelId: LabelId.make(operation.labelId),
      };
    }
    case "setReadState": {
      return { kind: "setRead", read: !operation.isUnread };
    }
    default: {
      return { kind: operation.kind };
    }
  }
};

/**
 * Report spam refuses a conversation of only the user's own mail. Set apart
 * before its round, it fails alone, rather than passing as reported because
 * the others in the round had something to move.
 */
const splitRound = Effect.fn("MailIpc.splitRound")(function* splitRound(
  accountId: string,
  round: readonly MailThreadRequest[],
  operation: MailBulkThreadMutationOperation
) {
  if (operation.kind !== "moveToSpam") {
    return { refused: [], toChange: round };
  }
  const { ownOnly } = yield* inAccountEngine(
    accountId,
    partitionReportable(
      accountId,
      round.map((thread) => thread.threadId)
    )
  );
  const refused = new Set<string>(ownOnly);
  return {
    refused: round.filter((thread) => refused.has(thread.threadId)),
    toChange: round.filter((thread) => !refused.has(thread.threadId)),
  };
});

const MAX_BULK_THREADS = 5000;
/**
 * Conversations per server round; a failure leaves the other rounds done. No
 * more than one thread list event carries (`MAX_UPSERTS` in the engine), so
 * every conversation of a round reaches the renderer changed.
 */
const BULK_CHUNK_SIZE = 200;

/**
 * One action over a selection that may span accounts. Each account's
 * conversations are changed in rounds, and the reply says which ones did not
 * change so the interface can put them back.
 */
export const bulkMutateThreads = Effect.fn("MailIpc.bulkMutateThreads")(
  function* bulkMutateThreads(request: MailBulkThreadMutationRequest) {
    const threads = [
      ...new Map(
        request.threads.map((thread) => [
          `${thread.accountId}\u0000${thread.threadId}`,
          thread,
        ])
      ).values(),
    ];
    if (threads.length === 0 || threads.length > MAX_BULK_THREADS) {
      return yield* new MailEngineError({
        message: `Select between 1 and ${MAX_BULK_THREADS} conversations`,
      });
    }

    const action = toThreadAction(request.operation);
    const byAccount = new Map<string, MailThreadRequest[]>();
    for (const thread of threads) {
      byAccount.set(thread.accountId, [
        ...(byAccount.get(thread.accountId) ?? []),
        thread,
      ]);
    }

    const succeeded: MailThreadRequest[] = [];
    const failed: MailThreadRequest[] = [];
    for (const [accountId, accountThreads] of byAccount) {
      for (
        let start = 0;
        start < accountThreads.length;
        start += BULK_CHUNK_SIZE
      ) {
        const round = accountThreads.slice(start, start + BULK_CHUNK_SIZE);
        const split = yield* Effect.exit(
          splitRound(accountId, round, request.operation)
        );
        if (Exit.isFailure(split)) {
          failed.push(...round);
          continue;
        }
        const { refused, toChange } = split.value;
        failed.push(...refused);
        if (toChange.length === 0) {
          continue;
        }
        const exit = yield* Effect.exit(
          inAccountEngine(
            accountId,
            applyThreadActions(
              accountId,
              toChange.map((thread) => thread.threadId),
              action
            )
          )
        );
        (Exit.isSuccess(exit) ? succeeded : failed).push(...toChange);
      }
    }

    return { failed, succeeded } satisfies MailBulkThreadMutationResult;
  }
);

/** Label colours are Kisa's own; IMAP has nowhere to keep them. */
const saveLabelColor = (
  accountId: string,
  labelId: string,
  background: MailLabelInputColor
) =>
  readDatabase("Could not save the label colour", (database) =>
    database
      .update(mailLabels)
      .set({ backgroundColor: background, textColor: null })
      .where(
        and(
          eq(mailLabels.accountId, accountId),
          eq(mailLabels.labelId, labelId)
        )
      )
      .run()
  );

const readSavedLabel = Effect.fn("MailIpc.readSavedLabel")(
  function* readSavedLabel(
    accountId: string,
    label: { readonly id: string; readonly name: string }
  ) {
    const catalog = yield* listLabelCatalog({ accountId });
    return (
      catalog.labels.find((candidate) => candidate.id === label.id) ??
      ({
        id: label.id,
        name: label.name,
        type: "user",
      } satisfies MailLabelSummary)
    );
  }
);

export const createAccountLabelFromRequest = Effect.fn(
  "MailIpc.createAccountLabel"
)(function* createAccountLabelFromRequest(request: MailLabelCreateRequest) {
  const label = yield* inAccountEngine(
    request.accountId,
    createAccountLabel(request.accountId, request.name)
  );
  if (request.color !== undefined) {
    yield* saveLabelColor(request.accountId, label.id, request.color);
  }
  return yield* readSavedLabel(request.accountId, label);
});

export const updateAccountLabel = Effect.fn("MailIpc.updateAccountLabel")(
  function* updateAccountLabel(request: MailLabelUpdateRequest) {
    const label = yield* inAccountEngine(
      request.accountId,
      renameAccountLabel(request.accountId, request.labelId, request.name)
    );
    // An unchanged colour is sent as `undefined`.
    if (request.color !== undefined) {
      yield* saveLabelColor(request.accountId, label.id, request.color);
    }
    return yield* readSavedLabel(request.accountId, label);
  }
);

export const deleteAccountLabelFromRequest = (
  request: MailLabelDeleteRequest
) =>
  inAccountEngine(
    request.accountId,
    deleteAccountLabel(request.accountId, request.labelId)
  );

/** The files the composer attached, released to this send only. */
const consumeAttachments = (
  ownerWebContentsId: number,
  capabilities: MailMessageSendRequest["attachments"]
) =>
  Effect.tryPromise({
    catch: (error) =>
      error instanceof OutgoingAttachmentAuthorizationError
        ? error
        : new OutgoingAttachmentAuthorizationError({
            message: "Could not read attachments",
          }),
    try: () =>
      outgoingAttachmentAuthorizations.consume(
        ownerWebContentsId,
        capabilities.map(({ capability }) => capability)
      ),
  });

const toOutcome = (result: { readonly refused: readonly string[] }) =>
  ({ refusedRecipients: [...result.refused] }) satisfies MailSendOutcome;

export const sendNewMessageFromRequest = Effect.fn("MailIpc.sendNewMessage")(
  function* sendNewMessageFromRequest(
    request: MailMessageSendRequest,
    ownerWebContentsId: number
  ) {
    const attachments = yield* consumeAttachments(
      ownerWebContentsId,
      request.attachments
    );
    const result = yield* inAccountEngine(
      request.accountId,
      sendNewMessage({ ...request, attachments })
    );
    return toOutcome(result);
  }
);

export const sendThreadMessageFromRequest = Effect.fn(
  "MailIpc.sendThreadMessage"
)(function* sendThreadMessageFromRequest(
  request: MailThreadMessageSendRequest,
  ownerWebContentsId: number
) {
  const attachments = yield* consumeAttachments(
    ownerWebContentsId,
    request.attachments
  );
  const result = yield* inAccountEngine(
    request.accountId,
    sendThreadMessage({ ...request, attachments })
  );
  return toOutcome(result);
});
