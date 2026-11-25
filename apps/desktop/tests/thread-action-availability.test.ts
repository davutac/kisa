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
    const listed = [
      ["inbox"],
      ["sent"],
      ["spam"],
      ["trash"],
      // In the Inbox and in a folder a server calls Trash.
      ["inbox", "label:trash"],
    ];

    expect(
      listed.map((places) => [
        canArchiveThread(places),
        canStarThread(places),
        canReportThreadSpam(places),
      ])
    ).toStrictEqual([
      [true, true, true],
      [false, true, true],
      [false, false, false],
      [false, false, false],
      [true, true, true],
    ]);
  });

  it("offers Move to Inbox for a received message outside the Inbox, not for the user's own mail", () => {
    expect({
      archived: hasArchivedMessage(["label:work"], [received, sent]),
      inInbox: hasArchivedMessage(["inbox"], [{ labelIds: ["INBOX"] }]),
      inSpam: hasArchivedMessage(["spam"], [{ labelIds: ["SPAM"] }]),
      ownDraft: hasArchivedMessage([], [{ labelIds: ["DRAFT"] }]),
      sentOnly: hasArchivedMessage(["sent"], [sent, sent]),
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
