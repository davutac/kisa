import { describe, expect, it } from "@effect/vitest";

import { getInitialReplyRecipients } from "../src/renderer/src/mail/reply-recipients";
import type { GmailThreadMessage } from "../src/shared/ipc/mail";

const messageFrom = (
  id: string,
  from: string,
  headers: Partial<Pick<GmailThreadMessage, "cc" | "replyTo" | "to">> = {}
): GmailThreadMessage => ({
  attachments: [],
  body: {},
  from,
  id,
  labelIds: [],
  sentAt: 0,
  snippet: "",
  subject: "",
  ...headers,
});

describe(getInitialReplyRecipients, () => {
  it("uses the latest sender and latest To and Cc recipients for reply all", () => {
    const latestMessage = messageFrom("1", "Sender <sender@example.com>", {
      cc: "ALICE@example.com, Bob <bob@example.com>",
      replyTo: "replies@example.com",
      to: "Me <me@example.com>, Alice <alice@example.com>",
    });

    expect(
      getInitialReplyRecipients("ME@example.com", "reply-all", latestMessage)
    ).toStrictEqual({
      bcc: [],
      cc: ["bob@example.com"],
      to: ["replies@example.com", "alice@example.com"],
    });
  });

  it("uses only the latest message for reply", () => {
    const latestMessage = messageFrom("2", "bob@example.com", {
      replyTo: "team@example.com",
    });

    expect(
      getInitialReplyRecipients("me@example.com", "reply", latestMessage).to
    ).toStrictEqual(["team@example.com"]);
  });

  it("leaves recipients empty for forward", () => {
    const latestMessage = messageFrom("3", "sender@example.com", {
      cc: "copy@example.com",
      to: "me@example.com",
    });

    expect(
      getInitialReplyRecipients("me@example.com", "forward", latestMessage)
    ).toStrictEqual({ bcc: [], cc: [], to: [] });
  });
});
