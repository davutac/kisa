import { describe, expect, it, vi } from "vitest";

import { openThreadWithPreference } from "../src/renderer/src/mail/use-open-thread";

const thread = {
  accountId: "person@example.com",
  threadId: "thread-7",
};

const createDependencies = () => ({
  alwaysOpenInNewWindow: false,
  closeInline: vi.fn<() => void>(),
  openInline: vi.fn<(threadKey: string) => void>(),
  reportError: vi.fn<(message: string) => void>(),
  selectThread: vi.fn<(threadKey: string) => void>(),
  windowApi: {
    openThread: vi.fn<() => Promise<{ data: undefined; ok: true }>>(() =>
      Promise.resolve({ data: undefined, ok: true })
    ),
  },
});

describe(openThreadWithPreference, () => {
  it("opens inline when the preference is off", () => {
    const dependencies = createDependencies();

    expect(openThreadWithPreference(thread, dependencies)).toBe("inline");
    expect(dependencies.openInline).toHaveBeenCalledWith(
      "person@example.com:thread-7"
    );
    expect(dependencies.windowApi.openThread).not.toHaveBeenCalled();
  });

  it("opens and selects the thread in a window when the preference is on", () => {
    const dependencies = {
      ...createDependencies(),
      alwaysOpenInNewWindow: true,
    };

    expect(openThreadWithPreference(thread, dependencies)).toBe("window");
    expect(dependencies.selectThread).toHaveBeenCalledWith(
      "person@example.com:thread-7"
    );
    expect(dependencies.closeInline).toHaveBeenCalledOnce();
    expect(dependencies.windowApi.openThread).toHaveBeenCalledWith(thread);
    expect(dependencies.openInline).not.toHaveBeenCalled();
  });

  it("falls back to the inline reader when windows are unavailable", () => {
    const dependencies = {
      ...createDependencies(),
      alwaysOpenInNewWindow: true,
      windowApi: undefined,
    };

    expect(openThreadWithPreference(thread, dependencies)).toBe("inline");
    expect(dependencies.openInline).toHaveBeenCalledWith(
      "person@example.com:thread-7"
    );
  });

  it("reports a redacted window-opening failure", async () => {
    const dependencies = {
      ...createDependencies(),
      alwaysOpenInNewWindow: true,
      windowApi: {
        openThread: vi.fn<() => Promise<never>>(() =>
          Promise.reject(new Error("private path"))
        ),
      },
    };

    openThreadWithPreference(thread, dependencies);
    await vi.waitFor(() => {
      expect(dependencies.reportError).toHaveBeenCalledWith(
        "Could not open the conversation in a new window"
      );
    });
  });
});
