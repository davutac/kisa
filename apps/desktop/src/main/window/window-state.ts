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

export type WindowStateType = "attachment-preview" | "main" | "thread";

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

const WINDOW_STATE_CONFIG = {
  "attachment-preview": {
    defaultState: { height: 760, width: 920 },
    filename: "attachment-preview-window-state.json",
    minimumSize: { height: 420, width: 520 },
  },
  main: {
    defaultState: DEFAULT_WINDOW_STATE,
    filename: "window-state.json",
    minimumSize: MIN_WINDOW_SIZE,
  },
  thread: {
    defaultState: { height: 720, width: 760 },
    filename: "thread-window-state.json",
    minimumSize: { height: 420, width: 520 },
  },
} as const satisfies Record<
  WindowStateType,
  {
    readonly defaultState: WindowState;
    readonly filename: string;
    readonly minimumSize: { readonly height: number; readonly width: number };
  }
>;

const getWindowStatePath = (type: WindowStateType): string =>
  path.join(app.getPath("userData"), WINDOW_STATE_CONFIG[type].filename);

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
  static readonly new = (args: {
    cause?: unknown;
    path: string;
    reason: WindowStateErrorReason;
  }): WindowStateError =>
    new WindowStateError({
      ...args,
      message: getWindowStateErrorMessage(args),
    });
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
        WindowStateError.new({
          cause,
          path: windowStatePath,
          reason: "read",
        }),
      try: () => readFileSync(windowStatePath, "utf-8"),
    })
);

const decodeWindowState = Schema.decodeUnknownEffect(
  Schema.fromJsonString(WindowStateSchema)
);

const normalizeWindowState = (
  { height, isMaximized, width, x, y }: WindowState,
  type: WindowStateType
): WindowState => {
  const { minimumSize } = WINDOW_STATE_CONFIG[type];
  const normalizedHeight = Math.max(height, minimumSize.height);
  const normalizedWidth = Math.max(width, minimumSize.width);
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
  function* readPersistedWindowStateEffect(
    windowStatePath: string,
    type: WindowStateType
  ) {
    const fileContents = yield* readWindowStateFile(windowStatePath);
    const windowState = yield* decodeWindowState(fileContents).pipe(
      Effect.mapError((cause) =>
        WindowStateError.new({
          cause,
          path: windowStatePath,
          reason: "decode",
        })
      )
    );
    return normalizeWindowState(windowState, type);
  }
);

const persistWindowState = Effect.fn("persistWindowState")((
  type: WindowStateType,
  windowState: WindowState
) => {
  const windowStatePath = getWindowStatePath(type);

  return Effect.try({
    catch: (cause) =>
      WindowStateError.new({
        cause,
        path: windowStatePath,
        reason: "write",
      }),
    try: () => {
      mkdirSync(app.getPath("userData"), { recursive: true });
      writeFileSync(
        windowStatePath,
        `${JSON.stringify(windowState, null, 2)}\n`
      );
    },
  });
});

export const readWindowState = (
  type: WindowStateType = "main"
): WindowState => {
  const windowStatePath = getWindowStatePath(type);
  const { defaultState } = WINDOW_STATE_CONFIG[type];

  if (!existsSync(windowStatePath)) {
    return defaultState;
  }

  const windowStateExit = Effect.runSyncExit(
    readPersistedWindowState(windowStatePath, type)
  );
  return Exit.isSuccess(windowStateExit) ? windowStateExit.value : defaultState;
};

export const writeWindowState = (
  window: BrowserWindow,
  type: WindowStateType = "main"
): void => {
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
  Effect.runSyncExit(persistWindowState(type, windowState));
};
