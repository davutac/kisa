import type { FileHandle } from "node:fs/promises";
import {
  mkdtemp,
  open,
  rename,
  rm,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { StoredMailDraftAttachment } from "@repo/database/schemas";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeDraftAttachmentStore } from "../src/main/mail/draft-attachment-store";
import { authorizeOutgoingAttachmentFiles } from "../src/main/mail/outgoing-attachment-files";
import {
  decodeScheduledAttachments,
  loadScheduledAttachments,
} from "../src/main/mail/scheduled-mail-attachments";
import { MAX_GMAIL_ATTACHMENT_BYTES } from "../src/shared/ipc/mail";

const temporaryDirectories: string[] = [];

const authorizeAttachment = async (
  contents = "original"
): Promise<{
  readonly filePath: string;
  readonly record: StoredMailDraftAttachment;
}> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "kisa-scheduled-attachment-")
  );
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "attachment.txt");
  await writeFile(filePath, contents);
  const [record] = await authorizeOutgoingAttachmentFiles(
    [{ mediaType: "text/plain", path: filePath }],
    () => "attachment-1"
  );
  if (record === undefined) {
    throw new Error("Expected an authorized attachment");
  }
  const store = makeDraftAttachmentStore(path.join(directory, "user-data"));
  const adoption = await Effect.runPromise(
    store.adopt("scheduled-draft", [record])
  );
  const [owned] = adoption.attachments;
  if (owned === undefined) {
    throw new Error("Expected an app-owned attachment");
  }
  return { filePath: owned.path, record: owned };
};

const expectAttachmentFailure = async (
  loading: Promise<unknown>,
  reason:
    | "attachment-changed"
    | "attachment-invalid"
    | "attachment-missing"
    | "attachment-too-large"
): Promise<void> => {
  await expect(loading).rejects.toMatchObject({
    name: "ScheduledMailAttachmentError",
    reason,
  });
};

describe("scheduled attachment loading", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory) => {
        await rm(directory, { force: true, recursive: true });
      })
    );
  });

  it("classifies a missing authorized file without returning attachment bytes", async () => {
    expect.hasAssertions();
    const { filePath, record } = await authorizeAttachment();
    await unlink(filePath);

    await expectAttachmentFailure(
      loadScheduledAttachments([record]),
      "attachment-missing"
    );
  });

  it("rejects a malformed stored attachment collection as a whole", async () => {
    expect.hasAssertions();
    await expect(
      Effect.runPromise(
        decodeScheduledAttachments([{ filename: "partial.txt" }])
      )
    ).rejects.toMatchObject({
      name: "ScheduledMailAttachmentError",
      reason: "attachment-invalid",
    });
  });

  it("rejects a legacy source-file authorization at delivery time", async () => {
    expect.hasAssertions();
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "kisa-scheduled-legacy-attachment-")
    );
    temporaryDirectories.push(directory);
    const sourcePath = path.join(directory, "legacy.txt");
    await writeFile(sourcePath, "legacy");
    const [legacy] = await authorizeOutgoingAttachmentFiles(
      [{ mediaType: "text/plain", path: sourcePath }],
      () => "legacy-attachment"
    );
    if (legacy === undefined) {
      throw new Error("Expected an authorized legacy attachment");
    }

    await expectAttachmentFailure(
      loadScheduledAttachments([legacy]),
      "attachment-invalid"
    );
  });

  it("classifies a replaced authorized file as changed", async () => {
    expect.hasAssertions();
    const replacement = await authorizeAttachment();
    await rename(replacement.filePath, `${replacement.filePath}.original`);
    await writeFile(replacement.filePath, "original");
    await expectAttachmentFailure(
      loadScheduledAttachments([replacement.record]),
      "attachment-changed"
    );
  });

  it("classifies a modified authorized file as changed", async () => {
    expect.hasAssertions();
    const modified = await authorizeAttachment();
    await writeFile(modified.filePath, "modified");
    const changedTime = new Date(modified.record.mtimeMs + 60_000);
    await utimes(modified.filePath, changedTime, changedTime);
    await expectAttachmentFailure(
      loadScheduledAttachments([modified.record]),
      "attachment-changed"
    );
  });

  it("rejects an aggregate oversized collection before opening its paths", async () => {
    expect.hasAssertions();
    const { record } = await authorizeAttachment();
    const halfLimit = Math.floor(MAX_GMAIL_ATTACHMENT_BYTES / 2) + 1;
    const oversized = [
      {
        ...record,
        id: "attachment-1",
        path: "/missing/first",
        size: halfLimit,
      },
      {
        ...record,
        id: "attachment-2",
        path: "/missing/second",
        size: halfLimit,
      },
    ];

    await expectAttachmentFailure(
      loadScheduledAttachments(oversized),
      "attachment-too-large"
    );
  });

  it("detects a same-size modification while the authorized descriptor is being read", async () => {
    expect.hasAssertions();
    const { filePath, record } = await authorizeAttachment("original");
    const probe = await open(filePath, "r");
    // Node does not export the runtime FileHandle prototype. This assertion is
    // limited to the deterministic descriptor-read mutation test below.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const prototype = Object.getPrototypeOf(probe) as Pick<FileHandle, "read">;
    const originalRead = prototype.read;
    await probe.close();

    vi.spyOn(prototype, "read").mockImplementationOnce(
      async function mutateAfterFirstRead(
        this: FileHandle,
        ...arguments_: unknown[]
      ) {
        // The overload is selected dynamically by the production read call.
        // oxlint-disable-next-line typescript/no-unsafe-assignment
        const result = await Reflect.apply(originalRead, this, arguments_);
        await writeFile(filePath, "changed!");
        const changedTime = new Date(record.mtimeMs + 60_000);
        await utimes(filePath, changedTime, changedTime);
        // oxlint-disable-next-line typescript/no-unsafe-return
        return result;
      }
    );

    await expectAttachmentFailure(
      loadScheduledAttachments([record]),
      "attachment-changed"
    );
  });
});
