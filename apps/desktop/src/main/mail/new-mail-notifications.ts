import { Effect, Schema } from "effect";
import { app, nativeImage, Notification } from "electron";
import type { NativeImage } from "electron";
import sharp from "sharp";

import type {
  GmailSenderBrand,
  GmailThreadRequest,
} from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database";
import {
  createWindow,
  getMainWindow,
  openThreadWindow,
} from "../window/create-window";

const GMAIL_INBOX_LABEL = "INBOX";
const GMAIL_UNREAD_LABEL = "UNREAD";
const MAX_NOTIFICATION_CANDIDATES = 25;
const MAX_NOTIFICATIONS_PER_SYNC = 5;
const MAX_NOTIFICATION_BODY_BYTES = 128;
const MAX_NOTIFICATION_HEADING_BYTES = 64;
const MAX_CACHED_BRAND_ICONS = 50;
const MAX_ACTIVE_NOTIFICATIONS = 50;
const BRAND_ICON_SIZE = 128;
const OPEN_ACTION_INDEX = 0;
const MARK_AS_READ_ACTION_INDEX = 1;
const TRASH_ACTION_INDEX = 2;
const UNSAFE_RASTER_SVG_PATTERN =
  /<image|<style|@import|\b(?:href|src)\s*=|url\(/iu;

export interface NewMailNotificationMessage {
  readonly accountId: string;
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly messageId: string;
  readonly snippet: string;
  readonly subject: string;
  readonly threadId: string;
}

export interface NewMailNotificationCopy {
  readonly body: string;
  readonly subtitle: string;
  readonly title: string;
}

// oxlint-disable-next-line unicorn/throw-new-error
class NewMailNotificationError extends Schema.TaggedErrorClass<NewMailNotificationError>()(
  "NewMailNotificationError",
  { message: Schema.String }
) {}

const cleanNotificationText = (value: string): string =>
  [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      const isControl =
        codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
      const isBidirectionalControl =
        (character >= "\u202A" && character <= "\u202E") ||
        (character >= "\u2066" && character <= "\u2069");

      return isControl || isBidirectionalControl ? " " : character;
    })
    .join("")
    .replaceAll(/\s+/gu, " ")
    .trim();

const truncateNotificationText = (value: string, maxBytes: number): string => {
  const clean = cleanNotificationText(value);

  if (Buffer.byteLength(clean, "utf-8") <= maxBytes) {
    return clean;
  }

  const ellipsis = "…";
  const contentBytes = maxBytes - Buffer.byteLength(ellipsis, "utf-8");
  let bytes = 0;
  let truncated = "";

  for (const character of clean) {
    const characterBytes = Buffer.byteLength(character, "utf-8");

    if (bytes + characterBytes > contentBytes) {
      break;
    }

    truncated += character;
    bytes += characterBytes;
  }

  return `${truncated.trimEnd()}${ellipsis}`;
};

export const toNewMailNotificationCopy = (
  message: NewMailNotificationMessage
): NewMailNotificationCopy => {
  const senderName = cleanNotificationText(message.fromName ?? "");
  const senderAddress = cleanNotificationText(message.fromAddress);
  const subject = cleanNotificationText(message.subject) || "(No subject)";
  const snippet = cleanNotificationText(message.snippet);
  const sender =
    senderName.length === 0 || senderName === senderAddress
      ? senderAddress
      : `${senderName} <${senderAddress}>`;

  return {
    body: truncateNotificationText(snippet, MAX_NOTIFICATION_BODY_BYTES),
    subtitle: truncateNotificationText(subject, MAX_NOTIFICATION_HEADING_BYTES),
    title: truncateNotificationText(
      sender.length === 0 ? message.fromAddress : sender,
      MAX_NOTIFICATION_HEADING_BYTES
    ),
  };
};

const focusMainWindow = (): void => {
  const window = getMainWindow() ?? createWindow();

  if (window.isDestroyed()) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  app.focus({ steal: true });
  window.focus();
};

const openNotificationThread = Effect.fn("openNotificationThread")(
  function* openNotificationThread(message: NewMailNotificationMessage) {
    const window = yield* Effect.tryPromise({
      catch: () =>
        new NewMailNotificationError({
          message: "Could not open a notification conversation",
        }),
      try: () =>
        openThreadWindow({
          accountId: message.accountId,
          threadId: message.threadId,
        }),
    });

    if (window.isDestroyed()) {
      return yield* new NewMailNotificationError({
        message: "Notification conversation window was closed",
      });
    }

    window.show();
    app.focus({ steal: true });
    window.focus();
  },
  // oxlint-disable-next-line promise/prefer-await-to-then -- This is Effect error recovery, not Promise.prototype.catch.
  Effect.catch(() =>
    Effect.try({
      catch: () =>
        new NewMailNotificationError({
          message: "Could not focus the application window",
        }),
      try: focusMainWindow,
    }).pipe(Effect.ignore)
  )
);

const activeNotifications = new Map<
  Notification,
  Pick<NewMailNotificationMessage, "accountId" | "threadId">
>();
const brandIcons = new Map<string, NativeImage>();

export const dismissThreadNotifications = (
  accountId: string,
  threadId: string
): void => {
  for (const [notification, message] of activeNotifications) {
    if (message.accountId !== accountId || message.threadId !== threadId) {
      continue;
    }

    activeNotifications.delete(notification);

    try {
      notification.close();
    } catch {
      // Notification dismissal is best-effort after the mail mutation succeeds.
    }
  }
};

const toBrandIcon = Effect.fn("toBrandIcon")(function* toBrandIcon(
  brand: GmailSenderBrand
) {
  const cached = brandIcons.get(brand.imageDataUrl);

  if (cached !== undefined) {
    return cached;
  }

  const separatorIndex = brand.imageDataUrl.indexOf(",");

  if (separatorIndex === -1) {
    return null;
  }

  const svg = Buffer.from(
    brand.imageDataUrl.slice(separatorIndex + 1),
    "base64"
  );

  // The BIMI validator protects the renderer. Rasterization adds a local-file
  // surface in librsvg, so notification icons accept only self-contained SVG.
  if (UNSAFE_RASTER_SVG_PATTERN.test(svg.toString("utf-8"))) {
    return null;
  }

  const png = yield* Effect.tryPromise({
    catch: () =>
      new NewMailNotificationError({
        message: "Could not rasterize a sender brand",
      }),
    try: () =>
      sharp(svg)
        .resize(BRAND_ICON_SIZE, BRAND_ICON_SIZE, {
          fit: "contain",
        })
        .png()
        .toBuffer(),
  });
  const icon = nativeImage.createFromBuffer(png);

  if (icon.isEmpty()) {
    return null;
  }

  if (brandIcons.size >= MAX_CACHED_BRAND_ICONS) {
    const oldest = brandIcons.keys().next().value;

    if (oldest !== undefined) {
      brandIcons.delete(oldest);
    }
  }

  brandIcons.set(brand.imageDataUrl, icon);
  return icon;
});

const showNotification = (
  message: NewMailNotificationMessage,
  brandIcon: NativeImage | null,
  markThreadRead: (request: GmailThreadRequest) => void,
  trashThread: (request: GmailThreadRequest) => void
): void => {
  const copy = toNewMailNotificationCopy(message);
  const accountTitle = truncateNotificationText(
    message.accountId,
    MAX_NOTIFICATION_HEADING_BYTES
  );
  const notification = new Notification({
    actions: [
      { text: "Open", type: "button" },
      { text: "Mark as read", type: "button" },
      { text: "Trash", type: "button" },
    ],
    body: copy.body,
    groupId: message.accountId,
    groupTitle: accountTitle,
    id: `${message.accountId}:${message.messageId}`,
    subtitle: copy.subtitle,
    title: copy.title,
    ...(brandIcon === null ? {} : { icon: brandIcon }),
  });
  const release = (): void => {
    activeNotifications.delete(notification);
  };
  const request = {
    accountId: message.accountId,
    threadId: message.threadId,
  };
  let wasActivated = false;
  const runOnce = (action: () => void): void => {
    if (wasActivated) {
      return;
    }

    wasActivated = true;
    release();
    action();
  };
  const activate = (): void => {
    runOnce(() => {
      void Effect.runPromise(openNotificationThread(message));
    });
  };
  const markAsRead = (): void => {
    runOnce(() => markThreadRead(request));
  };
  const trash = (): void => {
    runOnce(() => trashThread(request));
  };

  notification.once("action", ({ actionIndex }) => {
    if (actionIndex === TRASH_ACTION_INDEX) {
      trash();
      return;
    }

    if (actionIndex === MARK_AS_READ_ACTION_INDEX) {
      markAsRead();
      return;
    }

    if (actionIndex === OPEN_ACTION_INDEX) {
      activate();
    }
  });
  notification.once("click", activate);
  notification.once("close", release);
  notification.once("failed", release);

  if (activeNotifications.size >= MAX_ACTIVE_NOTIFICATIONS) {
    const oldest = activeNotifications.keys().next().value;

    if (oldest !== undefined) {
      activeNotifications.delete(oldest);
      oldest.close();
    }
  }

  activeNotifications.set(notification, message);
  notification.show();
};

const loadNotificationMessages = Effect.fn("loadNotificationMessages")(
  function* loadNotificationMessages(
    accountId: string,
    addedMessageIds: readonly string[]
  ) {
    if (addedMessageIds.length === 0) {
      return [];
    }

    const candidateIds = addedMessageIds.slice(-MAX_NOTIFICATION_CANDIDATES);

    return yield* withDatabaseClient(async (database) => {
      const settings = await database.query.accountSettings.findFirst({
        columns: { notificationsEnabled: true },
        where: { accountEmail: accountId },
      });

      if (settings?.notificationsEnabled === false) {
        return [];
      }

      const messages = await database.query.gmailMessages.findMany({
        orderBy: { internalDate: "desc" },
        where: {
          accountEmail: accountId,
          messageId: { in: candidateIds },
        },
      });
      const eligible = messages
        .filter(
          (message) =>
            message.labelIds?.includes(GMAIL_INBOX_LABEL) === true &&
            message.labelIds.includes(GMAIL_UNREAD_LABEL)
        )
        .slice(0, MAX_NOTIFICATIONS_PER_SYNC);

      if (eligible.length === 0) {
        return [];
      }

      const threads = await database.query.gmailThreads.findMany({
        columns: { snippet: true, threadId: true },
        where: {
          accountEmail: accountId,
          threadId: {
            in: [...new Set(eligible.map(({ threadId }) => threadId))],
          },
        },
      });
      const snippetsByThread = new Map(
        threads.map((thread) => [thread.threadId, thread.snippet] as const)
      );

      return eligible.map((message): NewMailNotificationMessage => ({
        accountId,
        fromAddress: message.fromAddress,
        messageId: message.messageId,
        snippet: snippetsByThread.get(message.threadId) ?? "",
        subject: message.subject,
        threadId: message.threadId,
        ...(message.fromName === null ? {} : { fromName: message.fromName }),
      }));
    }).pipe(
      Effect.mapError(
        () =>
          new NewMailNotificationError({
            message: "Could not load new email notifications",
          })
      )
    );
  }
);

type ResolveSenderBrand = (
  message: NewMailNotificationMessage
) => Effect.Effect<GmailSenderBrand | null, unknown>;

export const showNewMailNotifications = Effect.fn("showNewMailNotifications")(
  function* showNewMailNotifications(
    accountId: string,
    addedMessageIds: readonly string[],
    resolveSenderBrand: ResolveSenderBrand,
    markThreadRead: (request: GmailThreadRequest) => void,
    trashThread: (request: GmailThreadRequest) => void
  ) {
    if (!Notification.isSupported()) {
      return;
    }

    const messages = yield* loadNotificationMessages(
      accountId,
      addedMessageIds
    );

    for (const message of messages) {
      const brand = yield* resolveSenderBrand(message).pipe(
        Effect.orElseSucceed(() => null)
      );
      const brandIcon = yield* brand === null
        ? Effect.succeed(null)
        : toBrandIcon(brand).pipe(Effect.orElseSucceed(() => null));

      yield* Effect.try({
        catch: () =>
          new NewMailNotificationError({
            message: "Could not show a new email notification",
          }),
        try: () =>
          showNotification(message, brandIcon, markThreadRead, trashThread),
      }).pipe(Effect.ignore);
    }
  }
);
