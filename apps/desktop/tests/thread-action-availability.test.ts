import { describe, expect, it } from "vitest";

import {
  canArchiveThread,
  canReportThreadSpam,
  canStarThread,
  getBulkStarTarget,
  hasArchivedMessage,
  hasReceivedMessage,
} from "../src/renderer/src/mail/thread-action-availability";

const received = { labelIds: [] };
const sent = { labelIds: ["SENT"] };

describe("which thread actions apply", () => {
  it("archives only what is in the Inbox, and stars and reports outside Spam and Trash", () => {
    const places = [
      ["INBOX"],
      ["SENT"],
      ["SPAM"],
      ["TRASH"],
      ["INBOX", "TRASH"],
    ];

    expect(
      places.map((labels) => [
        canArchiveThread(labels),
        canStarThread(labels),
        canReportThreadSpam(labels),
      ])
    ).toStrictEqual([
      [true, true, true],
      [false, true, true],
      [false, false, false],
      [false, false, false],
      [false, false, false],
    ]);
  });

  it("offers Move to Inbox for a received message outside the Inbox, not for the user's own mail", () => {
    expect({
      archived: hasArchivedMessage(["u:Work"], [received, sent]),
      inInbox: hasArchivedMessage(["INBOX"], [{ labelIds: ["INBOX"] }]),
      inSpam: hasArchivedMessage(["SPAM"], [{ labelIds: ["SPAM"] }]),
      ownDraft: hasArchivedMessage([], [{ labelIds: ["DRAFT"] }]),
      sentOnly: hasArchivedMessage(["SENT"], [sent, sent]),
    }).toStrictEqual({
      archived: true,
      inInbox: false,
      inSpam: false,
      ownDraft: false,
      sentOnly: false,
    });
  });

  it("has something to report only when someone else wrote part of it", () => {
    expect([
      hasReceivedMessage([sent, received]),
      hasReceivedMessage([sent, { labelIds: ["DRAFT"] }]),
    ]).toStrictEqual([true, false]);
  });

  it("stars a selection unless every conversation already has a star", () => {
    expect([
      getBulkStarTarget([{ labels: ["STARRED"] }, { labels: [] }]),
      getBulkStarTarget([{ labels: ["STARRED"] }, { labels: ["STARRED"] }]),
    ]).toStrictEqual([true, false]);
  });
});
