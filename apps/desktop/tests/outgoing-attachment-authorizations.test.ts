import {
  mkdtemp,
  realpath,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OutgoingAttachmentAuthorizations } from "../src/main/mail/outgoing-attachment-authorizations";

const temporaryDirectories: string[] = [];

const makeAttachment = async (
  contents = "user-selected contents"
): Promise<{ directory: string; filePath: string }> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kisa-attachment-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "notes.txt");
  await writeFile(filePath, contents);
  return { directory, filePath };
};

describe("outgoing attachment authorizations", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  it("keeps canonical paths in main-owned draft records", async () => {
    const { filePath } = await makeAttachment();
    const authorizations = new OutgoingAttachmentAuthorizations();
    const [attachment] = await authorizations.authorizeSelections(11, {
      files: [{ mediaType: "text/plain", path: filePath }],
    });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }

    expect(attachment).toMatchObject({
      filename: "notes.txt",
      mediaType: "text/plain",
      size: 22,
    });
    expect(attachment).not.toHaveProperty("path");
    const stored = authorizations.serializeDraftAttachments(11, [attachment]);
    const canonicalPath = await realpath(filePath);
    expect(stored).toMatchObject([
      {
        authorizationVersion: 1,
        filename: "notes.txt",
        path: canonicalPath,
      },
    ]);
    await authorizations.releaseOwner(11);
  });

  it("restores only marked records as caller-bound references", async () => {
    const { filePath } = await makeAttachment();
    const authorizations = new OutgoingAttachmentAuthorizations();
    const [attachment] = await authorizations.authorizeSelections(11, {
      files: [{ mediaType: "text/plain", path: filePath }],
    });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }
    const stored = authorizations.serializeDraftAttachments(11, [attachment]);

    const restored = authorizations.restoreDraftAttachments(12, stored);
    const restoredAgain = authorizations.restoreDraftAttachments(12, stored);
    expect(() =>
      authorizations.serializeDraftAttachments(12, [attachment])
    ).toThrow("no longer authorized");
    expect(restored).toHaveLength(1);
    expect(restored[0]?.referenceId).not.toBe(attachment.referenceId);
    expect(restoredAgain[0]?.referenceId).toBe(restored[0]?.referenceId);
    expect(
      authorizations.restoreDraftAttachments(12, [
        {
          filename: "legacy.txt",
          id: "legacy",
          mediaType: "text/plain",
          path: "/tmp/renderer-controlled.txt",
          size: 1,
        },
      ])
    ).toStrictEqual([]);

    await Promise.all([
      authorizations.releaseOwner(11),
      authorizations.releaseOwner(12),
    ]);
  });

  it("binds one-use send capabilities to the caller and open descriptor", async () => {
    const { directory, filePath } = await makeAttachment("original");
    const authorizations = new OutgoingAttachmentAuthorizations();
    const [attachment] = await authorizations.authorizeSelections(21, {
      files: [{ mediaType: "text/plain", path: filePath }],
    });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }

    await expect(
      authorizations.prepare(22, [attachment.referenceId])
    ).rejects.toThrow("no longer authorized");
    const [prepared] = await authorizations.prepare(21, [
      attachment.referenceId,
    ]);
    if (prepared === undefined) {
      throw new Error("Expected a prepared attachment");
    }
    await rename(filePath, path.join(directory, "selected-original.txt"));
    await writeFile(filePath, "replacement");

    await expect(
      authorizations.consume(22, [prepared.capability])
    ).rejects.toThrow("expired");
    const [loaded] = await authorizations.consume(21, [prepared.capability]);
    expect(loaded).toBeDefined();
    expect(Buffer.from(loaded?.bytes ?? []).toString()).toBe("original");
    await expect(
      authorizations.consume(21, [prepared.capability])
    ).rejects.toThrow("expired");

    await authorizations.releaseOwner(21);
  });

  it("rejects replacement and expired authorizations", async () => {
    let now = 100;
    const { directory, filePath } = await makeAttachment();
    const authorizations = new OutgoingAttachmentAuthorizations({
      capabilityTtlMs: 10,
      now: () => now,
    });
    const [attachment] = await authorizations.authorizeSelections(31, {
      files: [{ mediaType: "text/plain", path: filePath }],
    });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }
    const stored = authorizations.serializeDraftAttachments(31, [attachment]);

    await rename(filePath, path.join(directory, "selected-original.txt"));
    await writeFile(filePath, "replacement");
    const [restored] = authorizations.restoreDraftAttachments(31, stored);
    if (restored === undefined) {
      throw new Error("Expected a restored attachment");
    }
    await expect(
      authorizations.prepare(31, [restored.referenceId])
    ).rejects.toThrow("Could not read attachment");

    const replacement = await authorizations.authorizeSelections(31, {
      files: [{ mediaType: "text/plain", path: filePath }],
    });
    await writeFile(filePath, "changedfile");
    await utimes(filePath, new Date(1000), new Date(Date.now() + 60_000));
    await expect(
      authorizations.prepare(31, [
        replacement[0]?.referenceId ?? "missing-reference",
      ])
    ).rejects.toThrow("Could not read attachment");

    const current = await authorizations.authorizeSelections(31, {
      files: [{ mediaType: "text/plain", path: filePath }],
    });
    const [prepared] = await authorizations.prepare(31, [
      current[0]?.referenceId ?? "missing-reference",
    ]);
    if (prepared === undefined) {
      throw new Error("Expected a prepared attachment");
    }
    now = 111;
    await expect(
      authorizations.consume(31, [prepared.capability])
    ).rejects.toThrow("expired");

    await authorizations.releaseOwner(31);
  });

  it("bounds capability consumption", async () => {
    const authorizations = new OutgoingAttachmentAuthorizations();

    await expect(
      authorizations.consume(
        41,
        Array.from({ length: 101 }, (_, index) => `capability-${index}`)
      )
    ).rejects.toThrow("invalid");
  });
});
