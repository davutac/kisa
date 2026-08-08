import { describe, expect, it } from "@effect/vitest";

import {
  ComposerSendHotkeyGuard,
  getComposerSendKeyboardShortcuts,
} from "../src/renderer/src/components/mail/email-composer";
import { HOTKEY_COMMANDS } from "../src/renderer/src/hotkeys/commands";

describe("composer hotkey integration", () => {
  it("reserves Mod+Enter before Tiptap's hard-break extension", () => {
    const shortcuts = getComposerSendKeyboardShortcuts();

    expect(ComposerSendHotkeyGuard.config.priority).toBe(1000);
    expect(shortcuts["Mod-Enter"]()).toBeTruthy();
    expect(HOTKEY_COMMANDS["composer.send"]).toMatchObject({
      bindings: ["Mod+Enter"],
      input: "allow",
      repeat: "once",
      scope: "composer",
    });
  });

  it("leaves Shift+Enter to Tiptap's hard-break extension", () => {
    expect(Object.keys(getComposerSendKeyboardShortcuts())).toStrictEqual([
      "Mod-Enter",
    ]);
  });
});
