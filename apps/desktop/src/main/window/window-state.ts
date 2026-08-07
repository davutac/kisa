import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Effect, Exit, Schema } from "effect";
import type { BrowserWindow } from "electron";
import { app, screen } from "electron";

const MIN_VISIBLE_WINDOW_EDGE_LENGTH = 100;
export const MIN_WINDOW_SIZE = {
  height: 560,
  width: 860,
} as const;

const WINDOW_STATE_FILE = "window-state.json";

const WindowStateSchema = Schema.Struct({
  height: Schema.Finite,
  isMaximized: Schema.optional(Schema.Boolean),
  width: Schema.Finite,
  x: Schema.optional(Schema.Finite),
  y: Schema.optional(Schema.Finite),
});

type WindowState = Schema.Schema.Type<typeof WindowStateSchema>;

const DEFAULT_WINDOW_STATE: WindowState = {
  height: 670,
  width: 900,
};

const getWindowStatePath = (): string =>
  path.join(app.getPath("userData"), WINDOW_STATE_FILE);

const formatErrorCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

type WindowStateErrorReason = "decode" | "read" | "write";

const getWindowStateErrorMessage = (args: {
  cause?: unknown;
  path: string;
  reason: WindowStateErrorReason;
}): string => {
  switch (args.reason) {
    case "read": {
      return `Failed to read window state from ${args.path}: ${formatErrorCause(args.cause)}`;
    }
    case "decode": {
      return `Failed to decode window state from ${args.path}: ${formatErrorCause(args.cause)}`;
    }
    case "write": {
      return `Failed to write window state to ${args.path}: ${formatErrorCause(args.cause)}`;
    }
    default: {
      const exhaustiveReason: never = args.reason;
      return exhaustiveReason;
    }
  }
};

// oxlint-disable-next-line unicorn/throw-new-error
class WindowStateError extends Schema.TaggedErrorClass<WindowStateError>()(
  "WindowStateError",
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    path: Schema.String,
    reason: Schema.Literals(["decode", "read", "write"]),
  }
) {
  constructor(args: {
    cause?: unknown;
    path: string;
    reason: WindowStateErrorReason;
  }) {
    super({
      ...args,
      message: getWindowStateErrorMessage(args),
    });
  }
}

const isWindowVisibleOnScreen = (
  bounds: Required<Pick<WindowState, "height" | "width" | "x" | "y">>
): boolean =>
  screen.getAllDisplays().some(({ workArea }) => {
    const horizontalOverlap =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x);
    const verticalOverlap =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y);

    return (
      horizontalOverlap >= MIN_VISIBLE_WINDOW_EDGE_LENGTH &&
      verticalOverlap >= MIN_VISIBLE_WINDOW_EDGE_LENGTH
    );
  });

const readWindowStateFile = Effect.fn("readWindowStateFile")(
  (windowStatePath: string) =>
    Effect.try({
      catch: (cause) =>
        new WindowStateError({ cause, path: windowStatePath, reason: "read" }),
      try: () => readFileSync(windowStatePath, "utf-8"),
    })
);

const decodeWindowState = Schema.decodeUnknownEffect(
  Schema.fromJsonString(WindowStateSchema)
);

const normalizeWindowState = ({
  height,
  isMaximized,
  width,
  x,
  y,
}: WindowState): WindowState => {
  const normalizedHeight = Math.max(height, MIN_WINDOW_SIZE.height);
  const normalizedWidth = Math.max(width, MIN_WINDOW_SIZE.width);
  const hasVisiblePosition =
    x !== undefined &&
    y !== undefined &&
    isWindowVisibleOnScreen({
      height: normalizedHeight,
      width: normalizedWidth,
      x,
      y,
    });

  return {
    height: normalizedHeight,
    ...(isMaximized === true ? { isMaximized: true } : {}),
    width: normalizedWidth,
    ...(hasVisiblePosition ? { x, y } : {}),
  };
};

const readPersistedWindowState = Effect.fn("readPersistedWindowState")(
  function* readPersistedWindowStateEffect(windowStatePath: string) {
    const fileContents = yield* readWindowStateFile(windowStatePath);
    const windowState = yield* decodeWindowState(fileContents).pipe(
      Effect.mapError(
        (cause) =>
          new WindowStateError({
            cause,
            path: windowStatePath,
            reason: "decode",
          })
      )
    );
    return normalizeWindowState(windowState);
  }
);

const persistWindowState = Effect.fn("persistWindowState")((
  windowState: WindowState
) => {
  const windowStatePath = getWindowStatePath();

  return Effect.try({
    catch: (cause) =>
      new WindowStateError({ cause, path: windowStatePath, reason: "write" }),
    try: () => {
      mkdirSync(app.getPath("userData"), { recursive: true });
      writeFileSync(
        windowStatePath,
        `${JSON.stringify(windowState, null, 2)}\n`
      );
    },
  });
});

export const readWindowState = (): WindowState => {
  const windowStatePath = getWindowStatePath();

  if (!existsSync(windowStatePath)) {
    return DEFAULT_WINDOW_STATE;
  }

  const windowStateExit = Effect.runSyncExit(
    readPersistedWindowState(windowStatePath)
  );
  return Exit.isSuccess(windowStateExit)
    ? windowStateExit.value
    : DEFAULT_WINDOW_STATE;
};

export const writeWindowState = (window: BrowserWindow): void => {
  if (window.isMinimized() || window.isFullScreen()) {
    return;
  }

  const bounds = window.isMaximized()
    ? window.getNormalBounds()
    : window.getBounds();
  const windowState: WindowState = {
    ...bounds,
    isMaximized: window.isMaximized(),
  };

  // Persisting window state is best-effort and should never block startup.
  Effect.runSyncExit(persistWindowState(windowState));
};
