import { createHash, randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type { StoredMailDraftAttachment } from "@repo/database/schemas";
import { Effect, Schema } from "effect";

import { OutgoingAttachmentAuthorizationError } from "./outgoing-attachment-authorization-error";
import {
  closeOutgoingAttachment,
  openOutgoingAttachment,
  readOutgoingAttachment,
} from "./outgoing-attachment-files";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const DRAFT_DIRECTORY_PATTERN = /^[\da-f]{64}$/u;
const ATTACHMENT_FILE_PATTERN = /^[\da-f-]{36}$/u;

// oxlint-disable-next-line unicorn/throw-new-error
export class DraftAttachmentStoreError extends Schema.TaggedError<DraftAttachmentStoreError>()(
  "DraftAttachmentStoreError",
  { message: Schema.String }
) {}

const storeError = (): DraftAttachmentStoreError =>
  new DraftAttachmentStoreError({
    message: "Could not store scheduled attachment",
  });

const adoptionError = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejection boundary maps the authorized-file failure into the store error channel.
  error: unknown
): DraftAttachmentStoreError | OutgoingAttachmentAuthorizationError =>
  error instanceof OutgoingAttachmentAuthorizationError ? error : storeError();

const draftDirectoryName = (draftId: string): string =>
  createHash("sha256").update(draftId).digest("hex");

const toStoredRecord = (
  source: StoredMailDraftAttachment,
  canonicalPath: string,
  stats: Stats
): StoredMailDraftAttachment => ({
  authorizationVersion: 1,
  birthtimeMs: stats.birthtimeMs,
  device: String(stats.dev),
  filename: source.filename,
  id: source.id,
  inode: String(stats.ino),
  mediaType: source.mediaType,
  mtimeMs: stats.mtimeMs,
  path: canonicalPath,
  size: stats.size,
  storage: "app-owned",
});

const NodeError = Schema.Struct({ code: Schema.String });

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Node filesystem rejections are decoded at this adapter boundary.
const isNodeErrorCode = (error: unknown, codes: readonly string[]): boolean => {
  const decoded = Schema.decodeUnknownOption(NodeError)(error);
  return decoded._tag === "Some" && codes.includes(decoded.value.code);
};

const tryStorePromise = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: storeError, try: run });

const readDirectory = (
  directory: string
): Effect.Effect<readonly Dirent[], DraftAttachmentStoreError> =>
  Effect.tryPromise({
    catch: storeError,
    try: async () => {
      try {
        return await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (isNodeErrorCode(error, ["ENOENT"])) {
          return [];
        }
        throw error;
      }
    },
  });

const removeFile = (
  filePath: string
): Effect.Effect<void, DraftAttachmentStoreError> =>
  Effect.tryPromise({
    catch: storeError,
    try: async () => {
      try {
        await unlink(filePath);
      } catch (error) {
        if (!isNodeErrorCode(error, ["ENOENT"])) {
          throw error;
        }
      }
    },
  });

const removeDirectory = (
  directory: string
): Effect.Effect<void, DraftAttachmentStoreError> =>
  Effect.tryPromise({
    catch: storeError,
    try: async () => {
      try {
        await rmdir(directory);
      } catch (error) {
        if (!isNodeErrorCode(error, ["ENOENT", "ENOTEMPTY"])) {
          throw error;
        }
      }
    },
  });

export interface DraftAttachmentAdoption {
  readonly attachments: readonly StoredMailDraftAttachment[];
  readonly created: readonly StoredMailDraftAttachment[];
}

export interface DraftAttachmentStore {
  readonly root: string;
  readonly adopt: (
    draftId: string,
    attachments: readonly StoredMailDraftAttachment[]
  ) => Effect.Effect<
    DraftAttachmentAdoption,
    DraftAttachmentStoreError | OutgoingAttachmentAuthorizationError
  >;
  readonly cleanupOrphans: (
    referenced: readonly StoredMailDraftAttachment[]
  ) => Effect.Effect<void, DraftAttachmentStoreError>;
  readonly delete: (
    attachments: readonly StoredMailDraftAttachment[]
  ) => Effect.Effect<void, DraftAttachmentStoreError>;
  readonly deleteDraft: (
    draftId: string
  ) => Effect.Effect<void, DraftAttachmentStoreError>;
  readonly deleteNotRetained: (
    previous: readonly StoredMailDraftAttachment[],
    retained: readonly StoredMailDraftAttachment[]
  ) => Effect.Effect<void, DraftAttachmentStoreError>;
}

export const bestEffortDraftAttachmentCleanup = <A, E, R>(
  cleanup: Effect.Effect<A, E, R>
): Effect.Effect<void, never, R> =>
  cleanup.pipe(
    Effect.asVoid,
    // oxlint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- This handles the Effect error channel and deliberately keeps cleanup best effort.
    Effect.catch(() =>
      Effect.logWarning("Could not clean up draft attachment storage")
    )
  );

export const makeDraftAttachmentStore = (
  userDataPath: string
): DraftAttachmentStore => {
  const root = path.resolve(userDataPath, "attachments", "drafts");
  const resolveRoot = (): Effect.Effect<string, DraftAttachmentStoreError> =>
    Effect.tryPromise({
      catch: storeError,
      try: async () => {
        try {
          return await realpath(root);
        } catch (error) {
          if (isNodeErrorCode(error, ["ENOENT"])) {
            return root;
          }
          throw error;
        }
      },
    });
  const draftDirectory = (draftId: string, ownedRoot: string): string =>
    path.join(ownedRoot, draftDirectoryName(draftId));
  const isOwnedPath = (
    attachment: StoredMailDraftAttachment,
    ownedRoot: string
  ): boolean => {
    if (attachment.storage !== "app-owned") {
      return false;
    }
    const resolved = path.resolve(attachment.path);
    const directory = path.dirname(resolved);
    return (
      path.dirname(directory) === ownedRoot &&
      DRAFT_DIRECTORY_PATTERN.test(path.basename(directory)) &&
      ATTACHMENT_FILE_PATTERN.test(path.basename(resolved))
    );
  };
  const isOwnedByDraft = (
    draftId: string,
    attachment: StoredMailDraftAttachment,
    ownedRoot: string
  ): boolean =>
    isOwnedPath(attachment, ownedRoot) &&
    path.dirname(path.resolve(attachment.path)) ===
      draftDirectory(draftId, ownedRoot);

  const deleteAttachments = Effect.fn("DraftAttachmentStore.delete")(
    function* deleteAttachments(
      attachments: readonly StoredMailDraftAttachment[]
    ) {
      const ownedRoot = yield* resolveRoot();
      const directories = new Set<string>();
      yield* Effect.forEach(
        attachments,
        (attachment) => {
          if (!isOwnedPath(attachment, ownedRoot)) {
            return Effect.void;
          }
          const ownedPath = path.resolve(attachment.path);
          directories.add(path.dirname(ownedPath));
          return removeFile(ownedPath);
        },
        { concurrency: "unbounded" }
      );
      yield* Effect.forEach(directories, removeDirectory, {
        concurrency: "unbounded",
        discard: true,
      });
    }
  );

  const copyAttachment = Effect.fn("DraftAttachmentStore.copy")(
    function* copyAttachment(
      draftId: string,
      attachment: StoredMailDraftAttachment
    ) {
      const bytes = yield* Effect.acquireUseRelease(
        Effect.tryPromise({
          catch: adoptionError,
          try: () => openOutgoingAttachment(attachment),
        }),
        (source) =>
          Effect.tryPromise({
            catch: adoptionError,
            try: () => readOutgoingAttachment(source),
          }).pipe(Effect.map((loaded) => loaded.bytes)),
        (source) => Effect.promise(() => closeOutgoingAttachment(source.file))
      );

      return yield* tryStorePromise(async () => {
        await mkdir(root, { mode: DIRECTORY_MODE, recursive: true });
        const ownedRoot = await realpath(root);
        const directory = draftDirectory(draftId, ownedRoot);
        await mkdir(directory, { mode: DIRECTORY_MODE, recursive: true });
        await chmod(root, DIRECTORY_MODE);
        await chmod(directory, DIRECTORY_MODE);
        const targetPath = path.join(directory, randomUUID());
        const temporaryPath = path.join(directory, `.${randomUUID()}.tmp`);
        let temporaryFile: Awaited<ReturnType<typeof open>> | undefined;
        let moved = false;
        try {
          temporaryFile = await open(temporaryPath, "wx", FILE_MODE);
          await temporaryFile.writeFile(bytes);
          await temporaryFile.sync();
          await temporaryFile.close();
          temporaryFile = undefined;
          await rename(temporaryPath, targetPath);
          moved = true;
          const canonicalPath = await realpath(targetPath);
          const stats = await stat(canonicalPath);
          return toStoredRecord(attachment, canonicalPath, stats);
        } catch (error) {
          await temporaryFile?.close().catch(() => null);
          await unlink(moved ? targetPath : temporaryPath).catch(() => null);
          throw error;
        }
      });
    }
  );

  const adopt = Effect.fn("DraftAttachmentStore.adopt")(function* adopt(
    draftId: string,
    attachments: readonly StoredMailDraftAttachment[]
  ) {
    const ownedRoot = yield* resolveRoot();
    const adoptFrom = (
      index: number
    ): Effect.Effect<
      DraftAttachmentAdoption,
      DraftAttachmentStoreError | OutgoingAttachmentAuthorizationError
    > => {
      const attachment = attachments[index];
      if (attachment === undefined) {
        return Effect.succeed({ attachments: [], created: [] });
      }
      if (isOwnedByDraft(draftId, attachment, ownedRoot)) {
        return adoptFrom(index + 1).pipe(
          Effect.map((rest) => ({
            attachments: [attachment, ...rest.attachments],
            created: rest.created,
          }))
        );
      }
      return copyAttachment(draftId, attachment).pipe(
        Effect.flatMap((copied) =>
          adoptFrom(index + 1).pipe(
            Effect.map((rest) => ({
              attachments: [copied, ...rest.attachments],
              created: [copied, ...rest.created],
            })),
            // oxlint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- This is Effect error-channel recovery, not Promise chaining.
            Effect.catch((error) =>
              bestEffortDraftAttachmentCleanup(
                deleteAttachments([copied])
              ).pipe(Effect.andThen(Effect.fail(error)))
            )
          )
        )
      );
    };
    return yield* adoptFrom(0);
  });

  const deleteNotRetained = Effect.fn("DraftAttachmentStore.deleteNotRetained")(
    function* deleteNotRetained(
      previous: readonly StoredMailDraftAttachment[],
      retained: readonly StoredMailDraftAttachment[]
    ) {
      const ownedRoot = yield* resolveRoot();
      const retainedPaths = new Set(
        retained
          .filter((attachment) => isOwnedPath(attachment, ownedRoot))
          .map((attachment) => path.resolve(attachment.path))
      );
      yield* deleteAttachments(
        previous.filter(
          (attachment) =>
            isOwnedPath(attachment, ownedRoot) &&
            !retainedPaths.has(path.resolve(attachment.path))
        )
      );
    }
  );

  const deleteDraft = Effect.fn("DraftAttachmentStore.deleteDraft")(
    function* deleteDraft(draftId: string) {
      const ownedRoot = yield* resolveRoot();
      const directory = draftDirectory(draftId, ownedRoot);
      const entries = yield* readDirectory(directory);
      yield* Effect.forEach(
        entries,
        (entry) =>
          entry.isFile() || entry.isSymbolicLink()
            ? removeFile(path.join(directory, entry.name))
            : Effect.void,
        { concurrency: "unbounded", discard: true }
      );
      yield* removeDirectory(directory);
    }
  );

  const cleanupOrphans = Effect.fn("DraftAttachmentStore.cleanupOrphans")(
    function* cleanupOrphans(referenced: readonly StoredMailDraftAttachment[]) {
      const ownedRoot = yield* resolveRoot();
      const retainedPaths = new Set(
        referenced
          .filter((attachment) => isOwnedPath(attachment, ownedRoot))
          .map((attachment) => path.resolve(attachment.path))
      );
      const draftDirectories = yield* readDirectory(ownedRoot);
      for (const draftEntry of draftDirectories) {
        if (
          !draftEntry.isDirectory() ||
          !DRAFT_DIRECTORY_PATTERN.test(draftEntry.name)
        ) {
          continue;
        }
        const directory = path.join(ownedRoot, draftEntry.name);
        const entries = yield* readDirectory(directory);
        yield* Effect.forEach(
          entries,
          (entry) => {
            const candidate = path.resolve(directory, entry.name);
            return (entry.isFile() || entry.isSymbolicLink()) &&
              !retainedPaths.has(candidate)
              ? removeFile(candidate)
              : Effect.void;
          },
          { concurrency: "unbounded", discard: true }
        );
        yield* removeDirectory(directory);
      }
    }
  );

  return {
    adopt,
    cleanupOrphans,
    delete: deleteAttachments,
    deleteDraft,
    deleteNotRetained,
    root,
  };
};

let configuredStore: DraftAttachmentStore | undefined;

export const configureDraftAttachmentStore = (
  userDataPath: string
): DraftAttachmentStore => {
  configuredStore = makeDraftAttachmentStore(userDataPath);
  return configuredStore;
};

export const getOptionalDraftAttachmentStore = ():
  | DraftAttachmentStore
  | undefined => configuredStore;
