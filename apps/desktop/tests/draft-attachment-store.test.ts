import {
  access,
  mkdtemp,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { StoredMailDraftAttachment } from "@repo/database/schemas";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { makeDraftAttachmentStore } from "../src/main/mail/draft-attachment-store";
import { authorizeOutgoingAttachmentFiles } from "../src/main/mail/outgoing-attachment-files";
import { loadScheduledAttachments } from "../src/main/mail/scheduled-mail-attachments";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "kisa-draft-attachment-store-")
  );
  temporaryDirectories.push(directory);
  return directory;
};

const authorizeAttachment = async (
  directory: string,
  id: string,
  contents: string
): Promise<{
  readonly filePath: string;
  readonly record: StoredMailDraftAttachment;
}> => {
  const filePath = path.join(directory, `${id}.txt`);
  await writeFile(filePath, contents);
  const [record] = await authorizeOutgoingAttachmentFiles(
    [{ mediaType: "text/plain", path: filePath }],
    () => id
  );
  if (record === undefined) {
    throw new Error("Expected an authorized attachment");
  }
  return { filePath, record };
};

describe("draft attachment store", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  it("copies an attachment into private app storage and survives source deletion", async () => {
    const directory = await makeTemporaryDirectory();
    const userDataPath = path.join(directory, "user-data");
    const source = await authorizeAttachment(
      directory,
      "attachment-1",
      "hello"
    );
    const store = makeDraftAttachmentStore(userDataPath);

    const adoption = await Effect.runPromise(
      store.adopt("draft-1", [source.record])
    );
    const [owned] = adoption.attachments;
    if (owned === undefined) {
      throw new Error("Expected a copied attachment");
    }
    expect(owned.storage).toBe("app-owned");
    const directoryStats = await stat(path.dirname(owned.path));
    const fileStats = await stat(owned.path);
    expect(
      process.platform === "win32" ? 0o700 : directoryStats.mode % 512
    ).toBe(0o700);
    expect(process.platform === "win32" ? 0o600 : fileStats.mode % 512).toBe(
      0o600
    );

    await unlink(source.filePath);
    await expect(loadScheduledAttachments([owned])).resolves.toStrictEqual([
      expect.objectContaining({
        bytes: Buffer.from("hello"),
        filename: "attachment-1.txt",
      }),
    ]);

    await Effect.runPromise(store.delete([owned]));
    await expect(access(owned.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back copies when adopting the complete attachment set fails", async () => {
    const directory = await makeTemporaryDirectory();
    const first = await authorizeAttachment(directory, "first", "first");
    const second = await authorizeAttachment(directory, "second", "second");
    const store = makeDraftAttachmentStore(path.join(directory, "user-data"));
    await unlink(second.filePath);

    await expect(
      Effect.runPromise(store.adopt("draft-2", [first.record, second.record]))
    ).rejects.toBeDefined();
    await expect(readdir(store.root)).resolves.toStrictEqual([]);
  });

  it("removes orphaned copies while retaining referenced attachments", async () => {
    const directory = await makeTemporaryDirectory();
    const first = await authorizeAttachment(directory, "first", "first");
    const second = await authorizeAttachment(directory, "second", "second");
    const store = makeDraftAttachmentStore(path.join(directory, "user-data"));
    const retained = await Effect.runPromise(
      store.adopt("draft-3", [first.record])
    );
    const orphaned = await Effect.runPromise(
      store.adopt("draft-4", [second.record])
    );
    const [retainedAttachment] = retained.attachments;
    const [orphanedAttachment] = orphaned.attachments;
    if (retainedAttachment === undefined || orphanedAttachment === undefined) {
      throw new Error("Expected copied attachments");
    }

    await Effect.runPromise(store.cleanupOrphans([retainedAttachment]));

    await expect(access(retainedAttachment.path)).resolves.toBeUndefined();
    await expect(access(orphanedAttachment.path)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
