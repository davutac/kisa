import { describe, expect, it, vi } from "@effect/vitest";

import { getAppCommandHotkeys } from "../src/renderer/src/hotkeys/use-app-command";

describe("app command hotkeys", () => {
  it("omits the target so untargeted commands listen on the document", () => {
    const [definition] = getAppCommandHotkeys("thread.close", vi.fn());

    expect(definition?.options).toStrictEqual({
      ignoreDefaultPrevented: false,
      ignoreInputs: true,
      requireReset: true,
    });
    expect(Object.hasOwn(definition?.options ?? {}, "target")).toBeFalsy();
  });

  it("lets a widget that handled the key keep it from closing the composer", () => {
    const [definition] = getAppCommandHotkeys("composer.close", vi.fn());

    expect(definition?.options).toStrictEqual({
      ignoreDefaultPrevented: true,
      ignoreInputs: false,
      requireReset: true,
    });
  });

  it("forwards a supplied element target", () => {
    const target = { current: null };
    const [definition] = getAppCommandHotkeys(
      "threadComposer.close",
      vi.fn(),
      target
    );

    expect(definition?.options).toStrictEqual({
      ignoreDefaultPrevented: false,
      ignoreInputs: false,
      requireReset: true,
      target,
    });
  });
});
