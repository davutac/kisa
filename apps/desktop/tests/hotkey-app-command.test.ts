import { describe, expect, it, vi } from "@effect/vitest";

import { getAppCommandHotkeys } from "../src/renderer/src/hotkeys/use-app-command";

describe("app command hotkeys", () => {
  it("omits the target so untargeted commands listen on the document", () => {
    const [definition] = getAppCommandHotkeys("thread.close", vi.fn());

    expect(definition?.options).toStrictEqual({
      ignoreInputs: true,
      requireReset: true,
    });
    expect(Object.hasOwn(definition?.options ?? {}, "target")).toBeFalsy();
  });

  it("forwards a supplied element target", () => {
    const target = { current: null };
    const [definition] = getAppCommandHotkeys(
      "threadComposer.close",
      vi.fn(),
      target
    );

    expect(definition?.options).toStrictEqual({
      ignoreInputs: false,
      requireReset: true,
      target,
    });
  });
});
