import { writeFile } from "node:fs/promises";
import path from "node:path";

import { is } from "@electron-toolkit/utils";
import type { GmailError } from "@repo/gmail/errors";
import type { GmailGateway } from "@repo/gmail/gateway";
import type { GmailMime } from "@repo/gmail/mime";
import { AccountId, AttachmentId, MessageId } from "@repo/gmail/models";
import { Gmail } from "@repo/gmail/service";
import type { GmailStore } from "@repo/gmail/store";
import { Effect, Layer, Schema } from "effect";
import type { BrowserWindow } from "electron";
import { dialog } from "electron";

import { getAttachmentPreviewKind } from "../../shared/attachments";
import type {
  GmailAttachmentPreview,
  GmailAttachmentRequest,
  GmailAttachmentSaveOutcome,
} from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database";
import { createBrowserWindow } from "../window/browser-window";
import { readWindowState, writeWindowState } from "../window/window-state";
import { GmailGatewayLive } from "./gmail-gateway";
import { GmailMimeLive } from "./gmail-mime";
import { GmailStoreLive } from "./gmail-store";

const MAX_ATTACHMENT_BYTES = 50_000_000;
const PREVIEW_WINDOW_SIZE = {
  height: 760,
  minHeight: 420,
  minWidth: 520,
  width: 920,
} as const;
const WINDOWS_RESERVED_FILENAME =
  /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\.|$)/iu;
const UNSAFE_FILENAME_CHARACTERS = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu;
const WINDOWS_INVALID_FILENAME_CHARACTERS = /[<>:"|?*]/gu;

interface ResolvedAttachment {
  readonly accountId: string;
  readonly attachmentId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly messageId: string;
  readonly size: number;
}

interface LoadedAttachment {
  readonly bytes: Uint8Array;
  readonly metadata: ResolvedAttachment;
}

interface PreviewSession {
  readonly load: Effect.Effect<LoadedAttachment, AttachmentActionError>;
  loaded?: LoadedAttachment;
  readonly metadata: ResolvedAttachment;
  readonly window: BrowserWindow;
}

// oxlint-disable-next-line unicorn/throw-new-error
class AttachmentActionError extends Schema.TaggedErrorClass<AttachmentActionError>()(
  "AttachmentActionError",
  { message: Schema.String }
) {}

const actionError = (message: string): AttachmentActionError =>
  new AttachmentActionError({ message });

const GmailLive = Gmail.layerWithoutDependencies.pipe(
  Layer.provideMerge(
    Layer.mergeAll(GmailStoreLive, GmailGatewayLive, GmailMimeLive)
  )
);

type GmailServices = Gmail | GmailGateway | GmailMime | GmailStore;

const runGmail = <A, E extends GmailError>(
  effect: Effect.Effect<A, E, GmailServices>
): Effect.Effect<A, AttachmentActionError> =>
  effect.pipe(
    Effect.provide(GmailLive),
    Effect.mapError(() => actionError("Could not load attachment"))
  );

export const sanitizeAttachmentFilename = (filename: string): string => {
  const leaf = path.posix.basename(
    filename.normalize("NFKC").replaceAll("\\", "/")
  );
  const cleaned = leaf
    .replaceAll(UNSAFE_FILENAME_CHARACTERS, "")
    .replaceAll(WINDOWS_INVALID_FILENAME_CHARACTERS, "")
    .trim()
    .replaceAll(/[. ]+$/gu, "")
    .slice(0, 180);
  const usable = cleaned.length === 0 ? "attachment" : cleaned;

  return WINDOWS_RESERVED_FILENAME.test(usable) ? `_${usable}` : usable;
};

const resolveAttachment = Effect.fn("resolveAttachment")(
  function* resolveAttachment(request: GmailAttachmentRequest) {
    const row = yield* withDatabaseClient((database) =>
      database.query.gmailMessages.findFirst({
        where: {
          accountEmail: request.accountId,
          messageId: request.messageId,
        },
      })
    ).pipe(Effect.mapError(() => actionError("Could not find attachment")));
    const attachment = row?.attachments?.find(
      (candidate) => candidate.attachmentId === request.attachmentId
    );

    if (attachment === undefined) {
      return yield* actionError("This attachment is not available yet");
    }

    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      return yield* actionError("This attachment is too large to open");
    }

    return {
      accountId: request.accountId,
      attachmentId: request.attachmentId,
      filename: sanitizeAttachmentFilename(attachment.filename),
      mediaType: attachment.mediaType,
      messageId: request.messageId,
      size: attachment.size,
    } satisfies ResolvedAttachment;
  }
);

const fetchAttachment = Effect.fn("fetchAttachment")(function* fetchAttachment(
  metadata: ResolvedAttachment
) {
  const attachment = yield* runGmail(
    Gmail.pipe(
      Effect.flatMap((gmail) =>
        gmail.getAttachment({
          accountId: AccountId.make(metadata.accountId),
          attachmentId: AttachmentId.make(metadata.attachmentId),
          filename: metadata.filename,
          mediaType: metadata.mediaType,
          messageId: MessageId.make(metadata.messageId),
        })
      )
    )
  );

  if (attachment.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return yield* actionError("This attachment is too large to open");
  }

  return { bytes: attachment.bytes, metadata } satisfies LoadedAttachment;
});

const chooseSaveDestination = Effect.fn("chooseSaveDestination")(
  function* chooseSaveDestination(window: BrowserWindow, filename: string) {
    return yield* Effect.tryPromise({
      catch: () => actionError("Could not choose where to save attachment"),
      try: () =>
        dialog.showSaveDialog(window, {
          defaultPath: filename,
          properties: ["createDirectory", "showOverwriteConfirmation"],
          title: "Save attachment",
        }),
    });
  }
);

const writeAttachment = Effect.fn("writeAttachment")(function* writeAttachment(
  filePath: string,
  bytes: Uint8Array
) {
  yield* Effect.tryPromise({
    catch: () => actionError("Could not save attachment"),
    try: () => writeFile(filePath, bytes, { mode: 0o600 }),
  });
});

const saveLoadedAttachment = Effect.fn("saveLoadedAttachment")(
  function* saveLoadedAttachment(
    window: BrowserWindow,
    loaded: () => Effect.Effect<LoadedAttachment, AttachmentActionError>,
    filename: string
  ) {
    const destination = yield* chooseSaveDestination(window, filename);

    if (destination.canceled || destination.filePath.length === 0) {
      return "cancelled" satisfies GmailAttachmentSaveOutcome;
    }

    const attachment = yield* loaded();
    yield* writeAttachment(destination.filePath, attachment.bytes);
    return "saved" satisfies GmailAttachmentSaveOutcome;
  }
);

const previewSessions = new Map<number, PreviewSession>();

const getLoadedPreview = Effect.fn("getLoadedPreview")(
  function* getLoadedPreview(session: PreviewSession) {
    const loaded = yield* session.load;
    session.loaded = loaded;
    return loaded;
  }
);

const loadPreviewRenderer = (window: BrowserWindow): Promise<void> => {
  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];

  if (is.dev && rendererUrl !== undefined) {
    const url = new URL(rendererUrl);
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/attachment-preview.html`;
    return window.loadURL(url.toString());
  }

  return window.loadFile(
    path.join(import.meta.dirname, "../renderer/attachment-preview.html")
  );
};

const createPreviewWindow = Effect.fn("createPreviewWindow")(
  function* createPreviewWindow(metadata: ResolvedAttachment) {
    const { isMaximized, ...windowBounds } =
      readWindowState("attachment-preview");
    const window = createBrowserWindow({
      ...PREVIEW_WINDOW_SIZE,
      ...windowBounds,
      preload: path.join(
        import.meta.dirname,
        "../preload/attachment-preview.cjs"
      ),
      title: metadata.filename,
    });
    if (isMaximized === true) {
      window.maximize();
    }
    const webContentsId = window.webContents.id;
    const load = yield* Effect.cached(fetchAttachment(metadata));
    const session: PreviewSession = { load, metadata, window };

    previewSessions.set(webContentsId, session);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.once("ready-to-show", () => window.show());
    window.on("close", () => {
      writeWindowState(window, "attachment-preview");
    });
    window.on("closed", () => {
      previewSessions.get(webContentsId)?.loaded?.bytes.fill(0);
      previewSessions.delete(webContentsId);
    });

    yield* Effect.tryPromise({
      catch: () => actionError("Could not open attachment preview"),
      try: () => loadPreviewRenderer(window),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          previewSessions.delete(webContentsId);
          window.destroy();
        })
      )
    );
  }
);

export const openAttachmentPreview = Effect.fn("openAttachmentPreview")(
  function* openAttachmentPreview(request: GmailAttachmentRequest) {
    const metadata = yield* resolveAttachment(request);

    if (
      getAttachmentPreviewKind(metadata.filename, metadata.mediaType) ===
      undefined
    ) {
      return yield* actionError("This attachment cannot be previewed");
    }

    yield* createPreviewWindow(metadata);
  }
);

export const saveAttachment = Effect.fn("saveAttachment")(
  function* saveAttachment(
    request: GmailAttachmentRequest,
    window: BrowserWindow
  ) {
    const metadata = yield* resolveAttachment(request);

    return yield* saveLoadedAttachment(
      window,
      () => fetchAttachment(metadata),
      metadata.filename
    );
  }
);

const getPreviewSession = (
  webContentsId: number
): Effect.Effect<PreviewSession, AttachmentActionError> => {
  const session = previewSessions.get(webContentsId);
  return session === undefined
    ? Effect.fail(actionError("Attachment preview is no longer available"))
    : Effect.succeed(session);
};

export const loadAttachmentPreview = Effect.fn("loadAttachmentPreview")(
  function* loadAttachmentPreview(webContentsId: number) {
    const session = yield* getPreviewSession(webContentsId);
    const loaded = yield* getLoadedPreview(session);
    const kind = getAttachmentPreviewKind(
      loaded.metadata.filename,
      loaded.metadata.mediaType
    );

    if (kind === undefined) {
      return yield* actionError("This attachment cannot be previewed");
    }

    return {
      bytes: loaded.bytes,
      filename: loaded.metadata.filename,
      kind,
      mediaType: loaded.metadata.mediaType,
    } satisfies GmailAttachmentPreview;
  }
);

export const saveAttachmentPreview = Effect.fn("saveAttachmentPreview")(
  function* saveAttachmentPreview(webContentsId: number) {
    const session = yield* getPreviewSession(webContentsId);

    return yield* saveLoadedAttachment(
      session.window,
      () => getLoadedPreview(session),
      session.metadata.filename
    );
  }
);
