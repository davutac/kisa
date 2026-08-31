import { execFile } from "node:child_process";
import {
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { OutgoingAttachmentAuthorizations } from "../src/main/mail/outgoing-attachment-authorizations";
import { decodeStoredOutgoingAttachmentsStrict } from "../src/main/mail/outgoing-attachment-files";
import { MAX_INLINE_IMAGE_BYTES } from "../src/shared/attachments";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

const makeAttachment = async (
  contents: string | Uint8Array = "user-selected contents"
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

  it("rejects malformed stored attachment collections as a whole", () => {
    expect(decodeStoredOutgoingAttachmentsStrict("")).toBeUndefined();
    expect(
      decodeStoredOutgoingAttachmentsStrict({ length: 0 })
    ).toBeUndefined();
    expect(
      decodeStoredOutgoingAttachmentsStrict([{ filename: "partial" }])
    ).toBeUndefined();
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

    await Promise.all([
      authorizations.releaseOwner(11),
      authorizations.releaseOwner(12),
    ]);
  });

  it("returns unavailable placeholders for unmarked records", async () => {
    const authorizations = new OutgoingAttachmentAuthorizations();
    const [unavailable] = authorizations.restoreDraftAttachments(12, [
      {
        filename: "legacy.txt",
        id: "legacy",
        mediaType: "text/plain",
        path: "/tmp/renderer-controlled.txt",
        size: 1,
      },
    ]);
    expect(unavailable).toMatchObject({
      filename: "Attachment unavailable — remove and reattach",
      mediaType: "application/octet-stream",
      size: 0,
    });
    expect(unavailable).not.toHaveProperty("path");
    await expect(
      authorizations.prepare(12, [
        { referenceId: unavailable?.referenceId ?? "missing" },
      ])
    ).rejects.toThrow("no longer authorized");
    expect(() =>
      authorizations.serializeDraftAttachments(
        12,
        unavailable === undefined ? [] : [unavailable]
      )
    ).toThrow("no longer authorized");

    await authorizations.releaseOwner(12);
  });

  it("bounds malformed restored draft collections", async () => {
    const authorizations = new OutgoingAttachmentAuthorizations();
    expect(authorizations.restoreDraftAttachments(12, "")).toHaveLength(1);
    expect(
      authorizations.restoreDraftAttachments(
        12,
        Array.from({ length: 101 }, () => ({ invalid: true }))
      )
    ).toHaveLength(1);

    await authorizations.releaseOwner(12);
  });

  it("bounds and validates attachment collections before serialization", async () => {
    const { filePath } = await makeAttachment();
    const authorizations = new OutgoingAttachmentAuthorizations();
    const [attachment] = await authorizations.authorizeSelections(13, {
      files: [{ mediaType: "text/plain", path: filePath }],
    });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }

    expect(() =>
      authorizations.serializeDraftAttachments(
        13,
        Array.from({ length: 101 }, () => attachment)
      )
    ).toThrow("invalid");
    expect(() =>
      authorizations.serializeDraftAttachments(13, [attachment, attachment])
    ).toThrow("invalid");

    const [record] = authorizations.serializeDraftAttachments(13, [attachment]);
    if (record === undefined) {
      throw new Error("Expected a stored attachment");
    }
    const oversized = [1, 2, 3].map((index) => ({
      ...record,
      id: `oversized-${index}`,
      size: 10_000_000,
    }));
    const restored = authorizations.restoreDraftAttachments(13, oversized);
    expect(() =>
      authorizations.serializeDraftAttachments(13, restored)
    ).toThrow("25 MB");

    await authorizations.releaseOwner(13);
  });

  it("persists inline content ids without exposing file paths", async () => {
    const { filePath } = await makeAttachment();
    const authorizations = new OutgoingAttachmentAuthorizations();
    const [attachment] = await authorizations.authorizeSelections(11, {
      files: [{ mediaType: "image/png", path: filePath }],
    });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }

    const stored = authorizations.serializeDraftAttachments(11, [
      { ...attachment, contentId: "image@inline.kisa.email" },
    ]);
    expect(stored[0]).toMatchObject({
      contentId: "image@inline.kisa.email",
      mediaType: "image/png",
    });
    const [restored] = authorizations.restoreDraftAttachments(12, stored);
    expect(restored).toMatchObject({
      contentId: "image@inline.kisa.email",
      mediaType: "image/png",
    });
    expect(restored).not.toHaveProperty("path");

    await Promise.all([
      authorizations.releaseOwner(11),
      authorizations.releaseOwner(12),
    ]);
  });

  it("reloads an inline image preview from a restored draft reference", async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71]);
    const { filePath } = await makeAttachment(bytes);
    const authorizations = new OutgoingAttachmentAuthorizations();
    const [attachment] = await authorizations.authorizeSelections(11, {
      files: [{ mediaType: "image/png", path: filePath }],
    });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }
    const stored = authorizations.serializeDraftAttachments(11, [
      { ...attachment, contentId: "image@inline.kisa.email" },
    ]);
    const [restored] = authorizations.restoreDraftAttachments(12, stored);
    if (restored === undefined) {
      throw new Error("Expected a restored attachment");
    }

    await expect(
      Effect.runPromise(
        authorizations.loadInlineImagePreview(11, restored.referenceId)
      )
    ).rejects.toThrow("no longer authorized");
    await expect(
      Effect.runPromise(
        authorizations.loadInlineImagePreview(12, restored.referenceId)
      )
    ).resolves.toStrictEqual({ bytes, mediaType: "image/png" });

    await Promise.all([
      authorizations.releaseOwner(11),
      authorizations.releaseOwner(12),
    ]);
  });

  it("rejects unsupported, oversized, and duplicate inline metadata", async () => {
    const unsupportedFile = await makeAttachment();
    const oversizedFile = await makeAttachment(
      new Uint8Array(MAX_INLINE_IMAGE_BYTES + 1)
    );
    const authorizations = new OutgoingAttachmentAuthorizations();
    await expect(
      authorizations.authorizeSelections(13, {
        files: [
          {
            mediaType: "image/png\r\nX-Injected: true",
            path: unsupportedFile.filePath,
          },
        ],
      })
    ).rejects.toThrow("media type is invalid");
    const [unsupported] = await authorizations.authorizeSelections(13, {
      files: [{ mediaType: "image/heic", path: unsupportedFile.filePath }],
    });
    const [oversized] = await authorizations.authorizeSelections(13, {
      files: [{ mediaType: "image/png", path: oversizedFile.filePath }],
    });
    const duplicates = await authorizations.authorizeSelections(13, {
      files: [
        { mediaType: "image/png", path: unsupportedFile.filePath },
        { mediaType: "image/png", path: unsupportedFile.filePath },
      ],
    });
    if (unsupported === undefined || oversized === undefined) {
      throw new Error("Expected authorized attachments");
    }

    expect(() =>
      authorizations.serializeDraftAttachments(13, [
        { ...unsupported, contentId: "unsupported@inline.kisa.email" },
      ])
    ).toThrow("JPEG, PNG, GIF, and WebP");
    await expect(
      authorizations.prepare(13, [
        {
          contentId: "oversized@inline.kisa.email",
          referenceId: oversized.referenceId,
        },
      ])
    ).rejects.toThrow("up to 2 MB");
    await expect(
      authorizations.prepare(
        13,
        duplicates.map(({ referenceId }) => ({
          contentId: "duplicate@inline.kisa.email",
          referenceId,
        }))
      )
    ).rejects.toThrow("invalid");

    await authorizations.releaseOwner(13);
  });

  it("binds one-use send capabilities to the caller and open descriptor", async () => {
    const { directory, filePath } = await makeAttachment("original");
    const authorizations = new OutgoingAttachmentAuthorizations();
    const [attachment] = await authorizations.authorizeSelections(21, {
      files: [{ mediaType: "image/png", path: filePath }],
    });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }

    await expect(
      authorizations.prepare(22, [{ referenceId: attachment.referenceId }])
    ).rejects.toThrow("no longer authorized");
    const [prepared] = await authorizations.prepare(21, [
      {
        contentId: "image@inline.kisa.email",
        referenceId: attachment.referenceId,
      },
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
    expect({
      contentId: loaded?.contentId,
      contents: Buffer.from(loaded?.bytes ?? []).toString(),
    }).toStrictEqual({
      contentId: "image@inline.kisa.email",
      contents: "original",
    });
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
      authorizations.prepare(31, [{ referenceId: restored.referenceId }])
    ).rejects.toThrow("Could not read attachment");

    const replacement = await authorizations.authorizeSelections(31, {
      files: [{ mediaType: "text/plain", path: filePath }],
    });
    await writeFile(filePath, "changedfile");
    await utimes(filePath, new Date(1000), new Date(Date.now() + 60_000));
    await expect(
      authorizations.prepare(31, [
        {
          referenceId: replacement[0]?.referenceId ?? "missing-reference",
        },
      ])
    ).rejects.toThrow("Could not read attachment");

    const current = await authorizations.authorizeSelections(31, {
      files: [{ mediaType: "text/plain", path: filePath }],
    });
    const [prepared] = await authorizations.prepare(31, [
      { referenceId: current[0]?.referenceId ?? "missing-reference" },
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

  it.skipIf(process.platform === "win32")(
    "rejects FIFO and symlink replacements without blocking",
    async () => {
      const { directory, filePath } = await makeAttachment("original");
      const authorizations = new OutgoingAttachmentAuthorizations();
      const [attachment] = await authorizations.authorizeSelections(35, {
        files: [{ mediaType: "text/plain", path: filePath }],
      });
      if (attachment === undefined) {
        throw new Error("Expected an authorized attachment");
      }
      const stored = authorizations.serializeDraftAttachments(35, [attachment]);

      await unlink(filePath);
      await execFileAsync("mkfifo", [filePath]);
      const [fifo] = authorizations.restoreDraftAttachments(35, stored);
      await expect(
        authorizations.prepare(35, [
          { referenceId: fifo?.referenceId ?? "missing-reference" },
        ])
      ).rejects.toThrow("Could not read attachment");

      await unlink(filePath);
      const replacement = path.join(directory, "replacement.txt");
      await writeFile(replacement, "original");
      await symlink(replacement, filePath);
      const [link] = authorizations.restoreDraftAttachments(35, stored);
      await expect(
        authorizations.prepare(35, [
          { referenceId: link?.referenceId ?? "missing-reference" },
        ])
      ).rejects.toThrow("Could not read attachment");

      await authorizations.releaseOwner(35);
    }
  );

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
