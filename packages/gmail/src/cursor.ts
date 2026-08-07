import { Effect, Schema } from "effect";

import { GmailValidationError } from "./errors";
import type { ListThreadsRequest } from "./models";
import { AccountId, LabelId, PageCursor } from "./models";

const PageSize = Schema.Int.check(
  Schema.isBetween({
    maximum: 500,
    minimum: 1,
  })
);

const CursorPayload = Schema.Struct({
  accountId: AccountId,
  includeSpamTrash: Schema.Boolean,
  labelIds: Schema.Array(LabelId),
  pageSize: PageSize,
  pageToken: Schema.NonEmptyString,
  search: Schema.optional(Schema.String),
  version: Schema.Literal(1),
});

type CursorPayload = typeof CursorPayload.Type;

const decodePayload = Schema.decodeUnknownEffect(CursorPayload);

const validationError = (message: string): GmailValidationError =>
  new GmailValidationError({ message });

export const encodeCursor = (payload: CursorPayload): PageCursor =>
  PageCursor.make(
    Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url")
  );

export const decodeCursor = Effect.fn("GmailCursor.decode")(function* decode(
  cursor: PageCursor
) {
  const encoded = yield* Effect.try({
    catch: () => validationError("The mailbox cursor is invalid"),
    try: () => JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")),
  });

  return yield* decodePayload(encoded).pipe(
    Effect.mapError(() => validationError("The mailbox cursor is invalid"))
  );
});

export const resolvePageRequest = Effect.fn("GmailCursor.resolvePageRequest")(
  function* resolve(request: ListThreadsRequest) {
    if ("cursor" in request) {
      const cursor = yield* decodeCursor(request.cursor);

      if (cursor.accountId !== request.accountId) {
        return yield* validationError(
          "The mailbox cursor does not belong to the requested account"
        );
      }

      return {
        accountId: cursor.accountId,
        includeSpamTrash: cursor.includeSpamTrash,
        labelIds: cursor.labelIds,
        pageSize: cursor.pageSize,
        pageToken: cursor.pageToken,
        search: cursor.search,
      } as const;
    }

    const pageSize = request.pageSize ?? 50;

    if (pageSize < 1 || pageSize > 500) {
      return yield* validationError("pageSize must be between 1 and 500");
    }

    return {
      accountId: request.accountId,
      includeSpamTrash: request.includeSpamTrash ?? false,
      labelIds: request.labelIds ?? [],
      pageSize,
      pageToken: undefined,
      search: request.search?.trim() || undefined,
    } as const;
  }
);
