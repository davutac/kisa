// oxlint-disable typescript/no-unsafe-type-assertion
// A server with neither SPECIAL-USE nor folders the engine recognises: every
// action that needs Trash, Spam or Archive refuses before touching mail.
import { genericDialect } from "@repo/mail/dialects";
import { SystemLabel, ThreadId, userLabelId } from "@repo/mail/ids";
import type { LabelId } from "@repo/mail/ids";
import { deleteLabel } from "@repo/mail/labels";
import { applyThreadAction } from "@repo/mail/mutations";
import type { ThreadAction } from "@repo/mail/mutations";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeImapServer, envelope } from "./fixtures/fake-imap-server";
import {
  OUTLOOK_CAPABILITIES,
  connection,
  genericMessage,
  insertAccount,
  resetDatabase,
  run,
  scopeFor,
  syncFully,
} from "./fixtures/mail-engine-harness";
import { found } from "./fixtures/rows";

/** Server commands that change or remove mail. */
const MUTATING = [
  "append",
  "copy",
  "create",
  "delete",
  "expunge",
  "label",
  "move",
  "rename",
  "store",
];

/**
 * One conversation: "x" in the Inbox with a second copy in Projects, and a
 * reply "y" whose only copy is in Projects.
 */
const syncBareServer = async () => {
  insertAccount("generic", "imap");

  const server = new FakeImapServer(
    [{ path: "INBOX" }, { path: "Projects" }],
    OUTLOOK_CAPABILITIES
  );

  server.deliver("INBOX", genericMessage("x"));
  server.deliver("Projects", genericMessage("x"));
  server.deliver(
    "Projects",
    genericMessage("y", {
      envelope: envelope({
        inReplyTo: "<x@example.com>",
        messageId: "<y@example.com>",
        subject: "y",
      }),
      headers: { references: "<x@example.com>" },
    })
  );
  const scope = scopeFor(server, genericDialect);
  await syncFully(scope);

  const { thread_id: threadId } = found(
    connection
      .prepare<unknown[], { thread_id: string }>(
        "SELECT thread_id FROM mail_messages WHERE subject = 'x'"
      )
      .get()
  );

  return { scope, server, threadId: ThreadId.make(threadId) };
};

const locations = () =>
  connection
    .prepare(
      "SELECT mailbox_path, uid FROM mail_message_locations ORDER BY mailbox_path, uid"
    )
    .all();

const mutatingCalls = (server: FakeImapServer) =>
  server.calls.filter((call) =>
    MUTATING.some((command) => call.startsWith(`${command} `))
  );

const setLabel = (labelId: LabelId, applied: boolean): ThreadAction => ({
  applied,
  kind: "setLabel",
  labelId,
});

describe("actions whose folder the account lacks", () => {
  beforeEach(resetDatabase);

  it.each([
    ["trash", { kind: "trash" }],
    ["report spam", { kind: "moveToSpam" }],
    ["archive", setLabel(SystemLabel.inbox, false)],
    ["delete forever", { kind: "deleteForever" }],
    // x keeps its Inbox copy, but y's only copy would need Archive.
    ["remove a folder label", setLabel(userLabelId("Projects"), false)],
  ] satisfies [string, ThreadAction][])(
    "refuses to %s without changing any mail",
    async (_name, action) => {
      const { scope, server, threadId } = await syncBareServer();
      const before = locations();

      await expect(
        run(applyThreadAction(scope, [threadId], action))
      ).rejects.toMatchObject({ _tag: "MailProtocolError" });

      expect(mutatingCalls(server)).toStrictEqual([]);
      expect(locations()).toStrictEqual(before);
    }
  );

  it("has nothing to bring back as not spam", async () => {
    const { scope, server, threadId } = await syncBareServer();
    const before = locations();

    await run(applyThreadAction(scope, [threadId], { kind: "moveToInbox" }));

    expect(mutatingCalls(server)).toStrictEqual([]);
    expect(locations()).toStrictEqual(before);
  });

  it("keeps a folder it has no Archive to empty into", async () => {
    const { scope, server } = await syncBareServer();
    const before = locations();

    await expect(
      run(deleteLabel(scope, userLabelId("Projects")))
    ).rejects.toMatchObject({ _tag: "MailProtocolError" });

    expect(mutatingCalls(server)).toStrictEqual([]);
    expect(locations()).toStrictEqual(before);
  });
});
