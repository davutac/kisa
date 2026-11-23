import { describe, expect, it } from "@effect/vitest";

import {
  COMPOSER_ACCOUNT_COMMAND_IDS,
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HOTKEY_COMMANDS,
  isModHotkeyCommand,
  OPEN_ACCOUNT_COMMAND_IDS,
  validateHotkeyCommands,
} from "../src/renderer/src/hotkeys/commands";

// ui-sdk wraps formatted keys in a left-to-right isolate.
const isolated = (keys: string): string => `\u2066${keys}\u2069`;

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

  it("numbers the sidebar's scopes from All accounts down the Mod number row", () => {
    const scopeCommands = [
      "app.openAllAccounts",
      ...OPEN_ACCOUNT_COMMAND_IDS,
    ] as const;

    expect(
      scopeCommands.map((commandId) => HOTKEY_COMMANDS[commandId].bindings)
    ).toStrictEqual([
      ["Mod+1"],
      ["Mod+2"],
      ["Mod+3"],
      ["Mod+4"],
      ["Mod+5"],
      ["Mod+6"],
      ["Mod+7"],
      ["Mod+8"],
      ["Mod+9"],
    ]);
    expect(
      scopeCommands.every(
        (commandId) =>
          HOTKEY_COMMANDS[commandId].input === "allow" &&
          HOTKEY_COMMANDS[commandId].scope === "app"
      )
    ).toBeTruthy();
    expect(getHotkeyAriaLabel("app.openAllAccounts", "mac")).toBe("Meta+1");
    expect(getHotkeyAriaLabel("app.openAccount1", "windows")).toBe("Control+2");
  });

  it("reveals only Mod shortcuts under a held Mod", () => {
    expect(isModHotkeyCommand("app.openAllAccounts")).toBeTruthy();
    expect(isModHotkeyCommand("app.openScheduled")).toBeTruthy();
    expect(isModHotkeyCommand("app.toggleSpam")).toBeFalsy();
    expect(isModHotkeyCommand("app.toggleSent")).toBeFalsy();
  });

  it("assigns Mod chords to the workspaces", () => {
    expect(HOTKEY_COMMANDS["app.openSettings"].bindings).toStrictEqual([
      "Mod+,",
    ]);
    expect(HOTKEY_COMMANDS["app.openScheduled"].bindings).toStrictEqual([
      "Mod+Shift+S",
    ]);
  });

  it("gives each composer From account its sidebar number", () => {
    expect(
      COMPOSER_ACCOUNT_COMMAND_IDS.map(
        (commandId) => HOTKEY_COMMANDS[commandId].bindings
      )
    ).toStrictEqual(
      OPEN_ACCOUNT_COMMAND_IDS.map(
        (commandId) => HOTKEY_COMMANDS[commandId].bindings
      )
    );
    expect(
      Object.values(HOTKEY_COMMANDS).filter(
        (command) =>
          command.scope === "composer" &&
          command.bindings.some((binding) => binding === "Mod+1")
      )
    ).toStrictEqual([]);
  });

  it("assigns the composer stash shortcut", () => {
    expect(HOTKEY_COMMANDS["composer.stash"].bindings).toStrictEqual(["Mod+S"]);
    expect(HOTKEY_COMMANDS["composer.stash"].repeat).toBe("ignore-key-repeat");
    expect(getHotkeyAriaLabel("composer.stash", "mac")).toBe("Meta+S");
    expect(getHotkeyAriaLabel("composer.stash", "windows")).toBe("Control+S");
  });

  it("keeps app Undo out of native editor history", () => {
    expect(HOTKEY_COMMANDS["app.undo"]).toMatchObject({
      bindings: ["Mod+Z"],
      input: "ignore",
      repeat: "once",
      scope: "app",
    });
    expect(getHotkeyAriaLabel("app.undo", "mac")).toBe("Meta+Z");
    expect(getHotkeyAriaLabel("app.undo", "windows")).toBe("Control+Z");
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
      "app.openScheduled",
      "app.openSettings",
      "app.openTemplates",
    ] as const) {
      expect(HOTKEY_COMMANDS[commandId].repeat).toBe("ignore-key-repeat");
    }
  });

  it("does not make reversible state toggles depend on keyup", () => {
    for (const commandId of [
      "app.openScheduled",
      "app.openSettings",
      "app.openTemplates",
      "app.toggleSpam",
      "app.toggleTrash",
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

  it("assigns scheduled composer actions", () => {
    expect(HOTKEY_COMMANDS["composer.schedule"]).toMatchObject({
      bindings: ["Mod+Shift+Enter"],
      input: "allow",
      repeat: "once",
      scope: "composer",
    });
    expect(HOTKEY_COMMANDS["composer.discard"]).toMatchObject({
      bindings: ["Mod+D"],
      input: "allow",
      repeat: "once",
      scope: "composer",
    });
    expect(getHotkeyAriaLabel("composer.schedule", "mac")).toBe(
      "Meta+Shift+Enter"
    );
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

  it("assigns scheduled row navigation and actions without selection", () => {
    const scheduledCommandIds = Object.entries(HOTKEY_COMMANDS)
      .filter(([, command]) => command.scope === "scheduled")
      .map(([commandId]) => commandId)
      .toSorted();

    expect({
      cancel: HOTKEY_COMMANDS["scheduled.cancel"].bindings,
      clear: HOTKEY_COMMANDS["scheduled.clearActiveRow"],
      commandIds: scheduledCommandIds,
      discard: HOTKEY_COMMANDS["scheduled.discard"].bindings,
      next: HOTKEY_COMMANDS["scheduled.next"].bindings,
      open: HOTKEY_COMMANDS["scheduled.open"].bindings,
      previous: HOTKEY_COMMANDS["scheduled.previous"].bindings,
    }).toStrictEqual({
      cancel: ["Mod+S"],
      clear: {
        bindings: ["Escape"],
        input: "ignore",
        label: "Clear active scheduled email",
        repeat: "once",
        scope: "scheduled",
      },
      commandIds: [
        "scheduled.cancel",
        "scheduled.clearActiveRow",
        "scheduled.discard",
        "scheduled.next",
        "scheduled.open",
        "scheduled.previous",
      ],
      discard: HOTKEY_COMMANDS["mailbox.trashThread"].bindings,
      next: HOTKEY_COMMANDS["mailbox.nextThread"].bindings,
      open: HOTKEY_COMMANDS["mailbox.openThread"].bindings,
      previous: HOTKEY_COMMANDS["mailbox.previousThread"].bindings,
    });
  });

  it("formats selected-thread quick actions", () => {
    expect(
      getHotkeyDisplay("mailbox.toggleThreadRead", "mac").bindings
    ).toStrictEqual([isolated("⇧⌘U")]);
    expect(
      getHotkeyDisplay("mailbox.trashThread", "mac").bindings
    ).toStrictEqual([isolated("⌘D")]);
    expect(
      getHotkeyDisplay("mailbox.trashThread", "windows").bindings
    ).toStrictEqual([isolated("Ctrl+D")]);
    expect(
      getHotkeyDisplay("mailbox.trashThread", "linux").bindings
    ).toStrictEqual([isolated("Ctrl+D")]);
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
    expect(HOTKEY_COMMANDS["threadComposer.attach"]).toMatchObject({
      bindings: ["Mod+Shift+A"],
      input: "allow",
      scope: "thread-composer",
    });
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
    expect({
      sent: HOTKEY_COMMANDS["app.toggleSent"],
      spam: HOTKEY_COMMANDS["app.toggleSpam"],
      trash: HOTKEY_COMMANDS["app.toggleTrash"],
      unread: HOTKEY_COMMANDS["app.toggleUnread"],
    }).toMatchObject({
      sent: { bindings: ["Shift+S"], repeat: "ignore-key-repeat" },
      spam: { bindings: ["S"], repeat: "ignore-key-repeat" },
      trash: { bindings: ["T"], repeat: "ignore-key-repeat" },
      unread: { bindings: ["U"], repeat: "ignore-key-repeat" },
    });
  });

  it("formats display keys for each platform", () => {
    expect(getHotkeyDisplay("app.searchMail", "mac").bindings).toStrictEqual([
      isolated("⌘K"),
    ]);
    expect(
      getHotkeyDisplay("app.searchMail", "windows").bindings
    ).toStrictEqual([isolated("Ctrl+K")]);
    expect(getHotkeyDisplay("app.searchMail", "linux").bindings).toStrictEqual([
      isolated("Ctrl+K"),
    ]);
    expect(getHotkeyDisplay("mailbox.nextThread", "mac").bindings).toHaveLength(
      3
    );
  });

  it("shows the backslash of the sidebar shortcut on each platform", () => {
    expect(getHotkeyDisplay("app.toggleSidebar", "mac").bindings).toStrictEqual(
      [isolated("⌘\\")]
    );
    expect(
      getHotkeyDisplay("app.toggleSidebar", "windows").bindings
    ).toStrictEqual([isolated("Ctrl+\\")]);
    expect(getHotkeyAriaLabel("app.toggleSidebar", "linux")).toBe("Control+\\");
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

  it("rejects a key sequence, which ui-sdk's shortcuts can't register", () => {
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
    ).toStrictEqual([
      "sequence (G G) is a key sequence, which ui-sdk shortcuts don't support",
    ]);
  });

  it("rejects a shifted bracket that collides with what Shift types", () => {
    const common = {
      input: "allow",
      label: "Command",
      repeat: "once",
      scope: "app",
    } as const;

    expect(
      validateHotkeyCommands(
        {
          brace: { ...common, bindings: ["Mod+Shift+}"] },
          bracket: { ...common, bindings: ["Mod+Shift+]"] },
        },
        ["mac"]
      )
    ).toHaveLength(1);
  });
});
