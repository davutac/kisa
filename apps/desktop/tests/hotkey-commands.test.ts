import { describe, expect, it } from "@effect/vitest";

import {
  COMPOSER_ACCOUNT_COMMAND_IDS,
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HOTKEY_COMMANDS,
  OPEN_ACCOUNT_COMMAND_IDS,
  validateHotkeyCommands,
} from "../src/renderer/src/hotkeys/commands";
import { MAX_GOOGLE_ACCOUNTS } from "../src/shared/ipc/auth";

describe("hotkey command registry", () => {
  it("has no conflicts on any supported platform", () => {
    expect(validateHotkeyCommands()).toStrictEqual([]);
  });

  it("assigns the number row to navigation commands", () => {
    expect(HOTKEY_COMMANDS["app.openAllAccounts"].bindings).toStrictEqual([
      "A",
    ]);
    expect(
      OPEN_ACCOUNT_COMMAND_IDS.map(
        (commandId) => HOTKEY_COMMANDS[commandId].bindings[0]
      )
    ).toStrictEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(OPEN_ACCOUNT_COMMAND_IDS).toHaveLength(MAX_GOOGLE_ACCOUNTS);
    expect(HOTKEY_COMMANDS["app.openSettings"].bindings).toStrictEqual([
      "Mod+,",
    ]);
  });

  it("assigns the same number row to composer From accounts", () => {
    expect(
      COMPOSER_ACCOUNT_COMMAND_IDS.map(
        (commandId) => HOTKEY_COMMANDS[commandId].bindings[0]
      )
    ).toStrictEqual([
      "Mod+1",
      "Mod+2",
      "Mod+3",
      "Mod+4",
      "Mod+5",
      "Mod+6",
      "Mod+7",
      "Mod+8",
      "Mod+9",
    ]);
    expect(COMPOSER_ACCOUNT_COMMAND_IDS).toHaveLength(MAX_GOOGLE_ACCOUNTS);
  });

  it("assigns selected-thread quick actions", () => {
    expect(HOTKEY_COMMANDS["mailbox.toggleThreadRead"].bindings).toStrictEqual([
      "M",
    ]);
    expect(HOTKEY_COMMANDS["mailbox.trashThread"].bindings).toStrictEqual([
      "Backspace",
      "Delete",
    ]);
    expect(
      getHotkeyDisplay("mailbox.trashThread", "mac").bindings
    ).toStrictEqual([["⌫"], ["⌦"]]);
    expect(
      getHotkeyDisplay("mailbox.trashThread", "windows").bindings
    ).toStrictEqual([["⌫"], ["⌦"]]);
    expect(
      getHotkeyDisplay("mailbox.trashThread", "linux").bindings
    ).toStrictEqual([["⌫"], ["⌦"]]);
  });

  it("formats display keys for each platform", () => {
    expect(getHotkeyDisplay("app.searchMail", "mac").bindings).toStrictEqual([
      ["⌘", "K"],
    ]);
    expect(
      getHotkeyDisplay("app.searchMail", "windows").bindings
    ).toStrictEqual([["Ctrl", "K"]]);
    expect(getHotkeyDisplay("app.searchMail", "linux").bindings).toStrictEqual([
      ["Ctrl", "K"],
    ]);
    expect(getHotkeyDisplay("mailbox.nextThread", "mac").bindings).toHaveLength(
      3
    );
  });

  it("resolves Mod to valid ARIA modifier names", () => {
    expect(getHotkeyAriaLabel("app.searchMail", "mac")).toBe("Meta+K");
    expect(getHotkeyAriaLabel("app.searchMail", "windows")).toBe("Control+K");
    expect(getHotkeyAriaLabel("app.searchMail", "linux")).toBe("Control+K");
  });

  it("allows mutually exclusive bindings and rejects coexisting ones", () => {
    const common = {
      bindings: ["Escape"],
      input: "ignore",
      label: "Command",
      repeat: "once",
    } as const;

    expect(
      validateHotkeyCommands({
        mailbox: { ...common, scope: "mailbox" },
        thread: { ...common, scope: "thread" },
      })
    ).toStrictEqual([]);
    expect(
      validateHotkeyCommands(
        {
          app: { ...common, scope: "app" },
          thread: { ...common, scope: "thread" },
        },
        ["mac"]
      )
    ).toHaveLength(1);
  });

  it("rejects a sequence that extends an active command", () => {
    const common = {
      input: "ignore",
      label: "Command",
      repeat: "once",
      scope: "app",
    } as const;

    expect(
      validateHotkeyCommands(
        {
          prefix: { ...common, bindings: ["G"] },
          sequence: { ...common, bindings: ["G G"] },
        },
        ["linux"]
      )
    ).toHaveLength(1);
  });
});
