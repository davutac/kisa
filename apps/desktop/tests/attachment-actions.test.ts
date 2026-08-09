// These intentionally partial module adapters keep the test at the attachment
// action seam rather than constructing Gmail and Electron runtimes.
// oxlint-disable typescript/no-unsafe-type-assertion vitest/prefer-import-in-mock
import { Effect } from "effect";
import type * as Electron from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  openAttachmentPreview,
  sanitizeAttachmentFilename,
  saveAttachment,
} from "../src/main/mail/attachment-actions";
import {
  readWindowState,
  writeWindowState,
} from "../src/main/window/window-state";

interface TestWindow {
  readonly emit: (event: string) => void;
  readonly loadFile: ReturnType<typeof vi.fn>;
  readonly options: Electron.BrowserWindowConstructorOptions;
}

const state = vi.hoisted(() => ({
  createdWindows: [] as TestWindow[],
  databaseReads: 0,
  saveDialog:
    vi.fn<
      (
        window: Electron.BrowserWindow,
        options: Electron.SaveDialogOptions
      ) => Promise<Electron.SaveDialogReturnValue>
    >(),
}));

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

vi.mock("../src/main/mail/gmail-gateway", async () => {
  const { Layer } = await import("effect");
  return { GmailGatewayLive: Layer.empty };
});

vi.mock("../src/main/mail/gmail-mime", async () => {
  const { Layer } = await import("effect");
  return { GmailMimeLive: Layer.empty };
});

vi.mock("../src/main/mail/gmail-store", async () => {
  const { Layer } = await import("effect");
  return { GmailStoreLive: Layer.empty };
});

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {
    readonly loadFile = vi.fn<() => Promise<void>>(async () => {});
    readonly loadURL = vi.fn<() => Promise<void>>(async () => {});
    readonly options: Electron.BrowserWindowConstructorOptions;
    readonly webContents = {
      id: state.createdWindows.length + 1,
      on: vi.fn<(...arguments_: unknown[]) => void>(),
      setWindowOpenHandler: vi.fn<(...arguments_: unknown[]) => void>(),
    };
    readonly destroy = vi.fn<() => void>();
    private readonly handlers = new Map<string, (() => void)[]>();
    readonly on = vi.fn<(event: string, handler: () => void) => void>(
      (event, handler) => {
        const handlers = this.handlers.get(event) ?? [];
        handlers.push(handler);
        this.handlers.set(event, handlers);
      }
    );
    readonly once = vi.fn<(...arguments_: unknown[]) => void>();
    readonly show = vi.fn<() => void>();

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      this.options = options;
      state.createdWindows.push(this);
    }

    emit(event: string): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler();
      }
    }
  } as unknown as typeof Electron.BrowserWindow,
  dialog: { showSaveDialog: state.saveDialog },
}));

vi.mock("../src/main/database", () => ({
  withDatabaseClient: <A>(
    run: (database: {
      readonly query: {
        readonly gmailMessages: {
          readonly findFirst: () => Promise<unknown>;
        };
      };
    }) => Promise<A>
  ) =>
    Effect.promise(() => {
      state.databaseReads += 1;
      return run({
        query: {
          gmailMessages: {
            findFirst: () =>
              Promise.resolve({
                attachments: [
                  {
                    attachmentId: "attachment-1",
                    filename: "report.pdf",
                    mediaType: "application/pdf",
                    messageId: "message-1",
                    size: 1024,
                  },
                ],
              }),
          },
        },
      });
    }),
}));

vi.mock("../src/main/window/window-state", () => ({
  readWindowState: vi.fn<(type?: string) => { height: number; width: number }>(
    () => ({ height: 760, width: 920 })
  ),
  writeWindowState:
    vi.fn<(window: Electron.BrowserWindow, type?: string) => void>(),
}));

const request = {
  accountId: "person@example.com",
  attachmentId: "attachment-1",
  messageId: "message-1",
};

describe("attachment actions", () => {
  beforeEach(() => {
    state.createdWindows.length = 0;
    state.databaseReads = 0;
    state.saveDialog.mockReset();
    vi.mocked(readWindowState).mockClear();
    vi.mocked(writeWindowState).mockClear();
  });

  it("opens every preview in a new isolated window without fetching bytes", async () => {
    await Effect.runPromise(openAttachmentPreview(request));
    await Effect.runPromise(openAttachmentPreview(request));

    expect(state.createdWindows).toHaveLength(2);
    expect(state.createdWindows[0]?.options).toMatchObject({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    expect(state.createdWindows[0]?.loadFile).toHaveBeenCalledWith(
      expect.stringContaining("attachment-preview.html")
    );
    expect(state.databaseReads).toBe(2);
  });

  it("restores and saves attachment preview window state", async () => {
    await Effect.runPromise(openAttachmentPreview(request));

    state.createdWindows[0]?.emit("close");
    expect(readWindowState).toHaveBeenCalledWith("attachment-preview");
    expect(writeWindowState).toHaveBeenCalledWith(
      state.createdWindows[0],
      "attachment-preview"
    );
  });

  it("opens Save As before any attachment fetch and stops on cancellation", async () => {
    state.saveDialog.mockResolvedValue({ canceled: true, filePath: "" });

    await expect(
      Effect.runPromise(saveAttachment(request, {} as Electron.BrowserWindow))
    ).resolves.toBe("cancelled");
    expect(state.saveDialog).toHaveBeenCalledOnce();
  });
});

describe(sanitizeAttachmentFilename, () => {
  it("removes path traversal and reserved filename forms", () => {
    expect(sanitizeAttachmentFilename("../../private/report.pdf")).toBe(
      "report.pdf"
    );
    expect(sanitizeAttachmentFilename("..／private／report?.pdf")).toBe(
      "report.pdf"
    );
    expect(sanitizeAttachmentFilename("CON.txt")).toBe("_CON.txt");
    expect(sanitizeAttachmentFilename("bad\u0000name. ")).toBe("badname");
  });
});
