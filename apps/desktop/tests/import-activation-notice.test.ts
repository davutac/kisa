import { describe, expect, it, vi } from "vitest";

import { announceImportActivation } from "../src/main/app/import-activation-notice";

const createWindow = (isVisible: boolean) => {
  const shown: (() => void)[] = [];
  return {
    isVisible: () => isVisible,
    once: (_event: "show", listener: () => void) => {
      shown.push(listener);
    },
    /** The window is shown for the first time. */
    show: () => {
      for (const listener of shown) {
        listener();
      }
    },
  };
};

type Window = ReturnType<typeof createWindow>;

const announce = (
  activation: Parameters<typeof announceImportActivation>[0],
  window: Window | undefined
) => {
  const show = vi.fn<(target: Window, notice: { message: string }) => void>();
  announceImportActivation(activation, { getWindow: () => window, show });
  return show;
};

describe(announceImportActivation, () => {
  it.each(["dropped", "restored"] as const)(
    "tells the user about a %s import, attached to the main window",
    (activation) => {
      const window = createWindow(true);

      const show = announce(activation, window);

      expect(show).toHaveBeenCalledExactlyOnceWith(
        window,
        expect.objectContaining({
          message: "The imported database was not activated",
        })
      );
    }
  );

  it.each(["activated", "none"] as const)(
    "says nothing when the import was %s",
    (activation) => {
      expect(announce(activation, createWindow(true))).not.toHaveBeenCalled();
    }
  );

  it("waits for a window that starts hidden to be shown", () => {
    const window = createWindow(false);

    const show = announce("restored", window);
    expect(show).not.toHaveBeenCalled();

    window.show();
    expect(show).toHaveBeenCalledOnce();
  });

  it("says nothing without a window, as when activation runs during quit", () => {
    expect(announce("dropped", undefined)).not.toHaveBeenCalled();
  });

  it("names no file or folder", () => {
    const [[, dropped] = []] = announce("dropped", createWindow(true)).mock
      .calls;
    const [[, restored] = []] = announce("restored", createWindow(true)).mock
      .calls;

    expect(JSON.stringify([dropped, restored])).not.toMatch(/[/\\]|sqlite/u);
  });
});
