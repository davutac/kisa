import { AccountId, PageCursor } from "@repo/gmail/models";
import { describe, expect, it } from "vitest";

import { toMailIndexPageRequest } from "../src/main/mail/mail-index-request";

describe(toMailIndexPageRequest, () => {
  const accountId = AccountId.make("person@example.com");

  it("indexes all email, including Spam and Trash, but excludes Chats", () => {
    expect(toMailIndexPageRequest(accountId, undefined, null)).toStrictEqual({
      accountId,
      includeSpamTrash: true,
      pageSize: 100,
      search: "-in:chats",
    });
  });

  it("resumes an interrupted walk with a safe overlap", () => {
    const oldestIndexedAt = new Date(2019, 2, 14, 18, 4).getTime();

    expect(
      toMailIndexPageRequest(accountId, undefined, oldestIndexedAt)
    ).toStrictEqual({
      accountId,
      includeSpamTrash: true,
      pageSize: 100,
      search: "-in:chats before:2019/03/15",
    });
  });

  it("uses Gmail's opaque cursor after the first page", () => {
    const cursor = PageCursor.make("cursor");

    expect(toMailIndexPageRequest(accountId, cursor, null)).toStrictEqual({
      accountId,
      cursor,
    });
  });
});
