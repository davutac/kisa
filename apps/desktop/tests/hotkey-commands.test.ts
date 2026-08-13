import { describe, expect, it } from "@effect/vitest";

import {
  COMPOSER_ACCOUNT_COMMAND_IDS,
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HOTKEY_COMMANDS,
  OPEN_ACCOUNT_COMMAND_IDS,
  shouldRunHotkeyCommand,
  validateHotkeyCommands,
} from "../src/renderer/src/hotkeys/commands";
import { MAX_GOOGLE_ACCOUNTS } from "../src/shared/ipc/auth";

describe("hotkey command registry", () => {
  it("has no conflicts on any supported platform", () => {
    expect(validateHotkeyCommands()).toStrictEqual([]);
  });

  it("keeps every titlebar command in the app scope", () => {
    const titlebarCommands = Object.entries(HOTKEY_COMMANDS).filter(
      ([commandId]) => commandId.startsWith("app.")
    );

    expect(titlebarCommands.length).toBeGreaterThan(0);
    expect(
      titlebarCommands.every(([, command]) => command.scope === "app")
    ).toBeTruthy();
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

  it("assigns the composer stash shortcut", () => {
    expect(HOTKEY_COMMANDS["composer.stash"].bindings).toStrictEqual(["Mod+S"]);
    expect(HOTKEY_COMMANDS["composer.stash"].repeat).toBe("ignore-key-repeat");
    expect(getHotkeyAriaLabel("composer.stash", "mac")).toBe("Meta+S");
    expect(getHotkeyAriaLabel("composer.stash", "windows")).toBe("Control+S");
  });

  it("assigns template workspace shortcuts", () => {
    expect(HOTKEY_COMMANDS["app.openTemplates"].bindings).toStrictEqual([
      "Mod+Shift+T",
    ]);
    expect(HOTKEY_COMMANDS["templates.new"].bindings).toStrictEqual([
      "Mod+Shift+N",
    ]);
    expect(HOTKEY_COMMANDS["templates.save"].bindings).toStrictEqual(["Mod+S"]);
    expect(HOTKEY_COMMANDS["templates.focusSearch"].bindings).toStrictEqual([
      "Mod+F",
    ]);
    expect(HOTKEY_COMMANDS["templates.save"].repeat).toBe("ignore-key-repeat");
  });

  it("keeps workspace toggles usable when navigation consumes keyup", () => {
    for (const commandId of [
      "app.openSettings",
      "app.openTemplates",
    ] as const) {
      expect(HOTKEY_COMMANDS[commandId].repeat).toBe("ignore-key-repeat");
    }
  });

  it("does not make reversible state toggles depend on keyup", () => {
    for (const commandId of [
      "app.openSettings",
      "app.openTemplates",
      "app.toggleSpam",
      "app.toggleUnread",
      "mailbox.toggleThreadRead",
      "mailbox.toggleThreadSelection",
      "thread.toggleThreadRead",
    ] as const) {
      expect(HOTKEY_COMMANDS[commandId].repeat).toBe("ignore-key-repeat");
    }
  });

  it("assigns template navigation that works while editing", () => {
    expect(HOTKEY_COMMANDS["templates.next"].bindings).toStrictEqual([
      "Mod+Shift+]",
    ]);
    expect(HOTKEY_COMMANDS["templates.previous"].bindings).toStrictEqual([
      "Mod+Shift+[",
    ]);
    expect(HOTKEY_COMMANDS["templates.next"].input).toBe("allow");
    expect(HOTKEY_COMMANDS["templates.previous"].input).toBe("allow");
    expect(getHotkeyAriaLabel("templates.next", "mac")).toBe("Meta+Shift+]");
  });

  it("assigns the composer attachment shortcut", () => {
    expect(HOTKEY_COMMANDS["composer.attach"].bindings).toStrictEqual([
      "Mod+Shift+A",
    ]);
    expect(getHotkeyAriaLabel("composer.attach", "mac")).toBe("Meta+Shift+A");
  });

  it("assigns the composer cleanup shortcut", () => {
    expect(HOTKEY_COMMANDS["composer.clean"]).toMatchObject({
      bindings: ["Mod+Shift+C"],
      input: "allow",
      repeat: "once",
      scope: "composer",
    });
    expect(getHotkeyAriaLabel("composer.clean", "mac")).toBe("Meta+Shift+C");
  });

  it("allows repeated stash key presses while ignoring keydown auto-repeat", () => {
    expect(shouldRunHotkeyCommand("ignore-key-repeat", false)).toBeTruthy();
    expect(shouldRunHotkeyCommand("ignore-key-repeat", true)).toBeFalsy();
  });

  it("assigns selected-thread quick actions", () => {
    expect(
      HOTKEY_COMMANDS["mailbox.toggleThreadSelection"].bindings
    ).toStrictEqual(["X"]);
    expect(HOTKEY_COMMANDS["mailbox.toggleThreadRead"].bindings).toStrictEqual([
      "Mod+Shift+U",
    ]);
    expect(HOTKEY_COMMANDS["mailbox.toggleThreadRead"].repeat).toBe(
      "ignore-key-repeat"
    );
    expect(HOTKEY_COMMANDS["mailbox.trashThread"].bindings).toStrictEqual([
      "Mod+D",
    ]);
  });

  it("formats selected-thread quick actions", () => {
    expect(
      getHotkeyDisplay("mailbox.toggleThreadRead", "mac").bindings
    ).toStrictEqual(["⌘ ⇧ U"]);
    expect(
      getHotkeyDisplay("mailbox.trashThread", "mac").bindings
    ).toStrictEqual(["⌘ D"]);
    expect(
      getHotkeyDisplay("mailbox.trashThread", "windows").bindings
    ).toStrictEqual(["Ctrl+D"]);
    expect(
      getHotkeyDisplay("mailbox.trashThread", "linux").bindings
    ).toStrictEqual(["Ctrl+D"]);
  });

  it("assigns the thread popout shortcut", () => {
    expect(HOTKEY_COMMANDS["thread.popout"].bindings).toStrictEqual([
      "Mod+Enter",
    ]);
    expect(getHotkeyAriaLabel("thread.popout", "mac")).toBe("Meta+Enter");
    expect(getHotkeyAriaLabel("thread.popout", "windows")).toBe(
      "Control+Enter"
    );
  });

  it("opens the thread label picker with Mod+L", () => {
    expect(HOTKEY_COMMANDS["mailbox.manageLabels"].bindings).toStrictEqual([
      "Mod+L",
    ]);
    expect(HOTKEY_COMMANDS["thread.manageLabels"].bindings).toStrictEqual([
      "Mod+L",
    ]);
    expect(getHotkeyAriaLabel("mailbox.manageLabels", "mac")).toBe("Meta+L");
    expect(getHotkeyAriaLabel("thread.manageLabels", "mac")).toBe("Meta+L");
    expect(getHotkeyAriaLabel("thread.manageLabels", "windows")).toBe(
      "Control+L"
    );
  });

  it("keeps thread quick actions consistent with the mailbox", () => {
    expect(HOTKEY_COMMANDS["thread.toggleThreadRead"].bindings).toStrictEqual(
      HOTKEY_COMMANDS["mailbox.toggleThreadRead"].bindings
    );
    expect(HOTKEY_COMMANDS["thread.toggleThreadRead"].repeat).toBe(
      HOTKEY_COMMANDS["mailbox.toggleThreadRead"].repeat
    );
    expect(HOTKEY_COMMANDS["thread.trashThread"].bindings).toStrictEqual(
      HOTKEY_COMMANDS["mailbox.trashThread"].bindings
    );
  });

  it("assigns thread message navigation and actions", () => {
    expect(HOTKEY_COMMANDS["thread.nextMessage"].bindings).toStrictEqual([
      "ArrowDown",
      "J",
    ]);
    expect(HOTKEY_COMMANDS["thread.previousMessage"].bindings).toStrictEqual([
      "ArrowUp",
      "K",
    ]);
    expect(HOTKEY_COMMANDS["thread.replyToMessage"].bindings).toStrictEqual([
      "R",
    ]);
    expect(HOTKEY_COMMANDS["thread.replyAllToMessage"].bindings).toStrictEqual([
      "Shift+R",
    ]);
    expect(HOTKEY_COMMANDS["thread.forwardMessage"].bindings).toStrictEqual([
      "F",
    ]);
  });

  it("gives the inline thread composer its own commands", () => {
    expect(HOTKEY_COMMANDS["threadComposer.close"]).toMatchObject({
      bindings: ["Escape"],
      input: "allow",
      scope: "thread-composer",
    });
    expect(HOTKEY_COMMANDS["threadComposer.clean"]).toMatchObject({
      bindings: ["Mod+Shift+C"],
      input: "allow",
      scope: "thread-composer",
    });
    expect(HOTKEY_COMMANDS["threadComposer.createReply"]).toMatchObject({
      bindings: ["Mod+Shift+R"],
      input: "allow",
      scope: "thread-composer",
    });
    expect(HOTKEY_COMMANDS["threadComposer.send"]).toMatchObject({
      bindings: ["Mod+Enter"],
      input: "allow",
      scope: "thread-composer",
    });
  });

  it("assigns the mailbox filters", () => {
    expect(HOTKEY_COMMANDS["app.toggleUnread"].bindings).toStrictEqual(["U"]);
    expect(HOTKEY_COMMANDS["app.toggleSpam"].bindings).toStrictEqual(["S"]);
    expect(HOTKEY_COMMANDS["app.toggleUnread"].repeat).toBe(
      "ignore-key-repeat"
    );
    expect(HOTKEY_COMMANDS["app.toggleSpam"].repeat).toBe("ignore-key-repeat");
  });

  it("formats display keys for each platform", () => {
    expect(getHotkeyDisplay("app.searchMail", "mac").bindings).toStrictEqual([
      "⌘ K",
    ]);
    expect(
      getHotkeyDisplay("app.searchMail", "windows").bindings
    ).toStrictEqual(["Ctrl+K"]);
    expect(getHotkeyDisplay("app.searchMail", "linux").bindings).toStrictEqual([
      "Ctrl+K",
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
