import { gmailMessages } from "@repo/database/schemas";
import { and, desc, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { AiReplyRequest } from "../../shared/ipc/ai";
import { withDatabaseClient } from "../database";
import { AiThreadContextError } from "./errors";

const MAX_CONTEXT_MESSAGES = 50;
const MAX_CONTEXT_BODY_CHARS = 60_000;
const MAX_MESSAGE_BODY_CHARS = 12_000;

export interface AiThreadContextMessage {
  readonly body: string;
  readonly from: string;
  readonly sentAt: number;
  readonly subject: string;
  readonly to: readonly string[];
}

export interface AiThreadContext {
  readonly messages: readonly AiThreadContextMessage[];
  readonly omittedEarlierMessages: boolean;
  readonly subject: string;
}

const selectBoundedMessages = (
  rows: readonly {
    readonly bodyText: string | null;
    readonly fromAddress: string;
    readonly internalDate: number;
    readonly subject: string;
    readonly toAddresses: readonly string[] | null;
  }[]
): AiThreadContext["messages"] => {
  const selected: AiThreadContextMessage[] = [];
  let remainingCharacters = MAX_CONTEXT_BODY_CHARS;

  for (const row of rows) {
    if (remainingCharacters <= 0) {
      break;
    }

    const body = (row.bodyText ?? "")
      .slice(0, Math.min(MAX_MESSAGE_BODY_CHARS, remainingCharacters))
      .trim();
    remainingCharacters -= body.length;
    selected.push({
      body,
      from: row.fromAddress,
      sentAt: row.internalDate,
      subject: row.subject,
      to: row.toAddresses ?? [],
    });
  }

  return selected.toReversed();
};

export const loadAiThreadContext = Effect.fn("loadAiThreadContext")(
  function* loadAiThreadContext(
    request: Pick<AiReplyRequest, "accountId" | "threadId">
  ) {
    const result = yield* withDatabaseClient(async (database) => {
      const thread = await database.query.gmailThreads.findFirst({
        where: {
          accountEmail: request.accountId,
          threadId: request.threadId,
        },
      });

      if (thread === undefined) {
        return;
      }

      const rows = await database
        .select({
          bodyText: gmailMessages.bodyText,
          fromAddress: gmailMessages.fromAddress,
          internalDate: gmailMessages.internalDate,
          subject: gmailMessages.subject,
          toAddresses: gmailMessages.toAddresses,
        })
        .from(gmailMessages)
        .where(
          and(
            eq(gmailMessages.accountEmail, request.accountId),
            eq(gmailMessages.threadId, request.threadId)
          )
        )
        .orderBy(desc(gmailMessages.internalDate))
        .limit(MAX_CONTEXT_MESSAGES);

      return {
        messages: selectBoundedMessages(rows),
        omittedEarlierMessages:
          thread.messageCount > rows.length ||
          rows.some(
            (row) => (row.bodyText?.length ?? 0) > MAX_MESSAGE_BODY_CHARS
          ) ||
          rows.reduce((total, row) => total + (row.bodyText?.length ?? 0), 0) >
            MAX_CONTEXT_BODY_CHARS,
        subject: thread.subject,
      } satisfies AiThreadContext;
    }).pipe(
      Effect.mapError(
        () =>
          new AiThreadContextError({
            message: "Could not load the email conversation for AI",
          })
      )
    );

    if (result === undefined || result.messages.length === 0) {
      return yield* new AiThreadContextError({
        message: "This email conversation is not available in the local cache",
      });
    }

    return result;
  }
);
