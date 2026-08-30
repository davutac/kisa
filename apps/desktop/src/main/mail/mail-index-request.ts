import type {
  AccountId,
  ListThreadsRequest,
  PageCursor,
} from "@repo/gmail/models";

import { toBeforeQuery } from "./mail-backfill-cursor";

/** One Gmail list page and therefore one durable index checkpoint. */
export const MAIL_INDEX_PAGE_SIZE = 100;

/** Gmail Chat records are not email and do not carry a useful mail body. */
const MAIL_INDEX_QUERY = "-in:chats";

export const toMailIndexPageRequest = (
  accountId: AccountId,
  cursor: PageCursor | undefined,
  oldestIndexedAt: number | null
): ListThreadsRequest =>
  cursor === undefined
    ? {
        accountId,
        includeSpamTrash: true,
        pageSize: MAIL_INDEX_PAGE_SIZE,
        search:
          oldestIndexedAt === null
            ? MAIL_INDEX_QUERY
            : toBeforeQuery(MAIL_INDEX_QUERY, oldestIndexedAt),
      }
    : { accountId, cursor };
