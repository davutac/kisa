import { describe, expect, it } from "@effect/vitest";

import {
  getInitialReplyRecipients,
  shouldShowReplyAll,
} from "../src/renderer/src/mail/reply-recipients";
import type { GmailThreadMessage } from "../src/shared/ipc/mail";

const messageFrom = (
  id: string,
  from: string,
  headers: Partial<
    Pick<GmailThreadMessage, "bcc" | "cc" | "replyTo" | "to">
  > = {}
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

describe(shouldShowReplyAll, () => {
  it("hides reply all when the sender is the only non-self target", () => {
    const message = messageFrom("1", "Sender <sender@example.com>", {
      to: "Me <me@example.com>",
    });

    expect(shouldShowReplyAll("me@example.com", message)).toBeFalsy();
  });

  it("shows reply all for another To or Cc recipient", () => {
    const toMessage = messageFrom("2", "sender@example.com", {
      to: "me@example.com, teammate@example.com",
    });
    const ccMessage = messageFrom("3", "sender@example.com", {
      cc: "teammate@example.com",
      to: "me@example.com",
    });

    expect(shouldShowReplyAll("me@example.com", toMessage)).toBeTruthy();
    expect(shouldShowReplyAll("me@example.com", ccMessage)).toBeTruthy();
  });

  it("ignores self, duplicate, and Bcc addresses", () => {
    const message = messageFrom("4", "Sender <sender@example.com>", {
      bcc: "hidden@example.com",
      cc: "ME@example.com, SENDER@example.com",
      to: "me@example.com",
    });

    expect(shouldShowReplyAll("me@example.com", message)).toBeFalsy();
  });

  it("uses the To list when the selected message was sent by the account", () => {
    const oneRecipient = messageFrom("5", "me@example.com", {
      to: "one@example.com",
    });
    const multipleRecipients = messageFrom("6", "me@example.com", {
      to: "one@example.com, two@example.com",
    });

    expect(shouldShowReplyAll("me@example.com", oneRecipient)).toBeFalsy();
    expect(
      shouldShowReplyAll("me@example.com", multipleRecipients)
    ).toBeTruthy();
  });
});
