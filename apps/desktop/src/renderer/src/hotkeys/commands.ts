import {
  ariaKeyshortcuts,
  formatShortcut,
  matchesShortcut,
} from "@ui-sdk/core/shortcuts";

import { HOTKEY_LAYERS, isHotkeyScopeActive } from "@/hotkeys/layer-model";
import type { HotkeyScope } from "@/hotkeys/layer-model";

export type HotkeyPlatform = "linux" | "mac" | "windows";
export type HotkeyRepeat = "allow" | "ignore-key-repeat" | "once";

interface HotkeyCommandDefinition {
  readonly bindings: readonly string[];
  readonly input: "allow" | "ignore";
  readonly label: string;
  readonly repeat: HotkeyRepeat;
  readonly scope: HotkeyScope;
}

export const HOTKEY_COMMANDS = {
  "app.composeMessage": {
    bindings: ["Mod+N"],
    input: "allow",
    label: "New email",
    repeat: "once",
    scope: "app",
  },
  "app.navigateBack": {
    bindings: ["Mod+["],
    input: "ignore",
    label: "Go back",
    repeat: "ignore-key-repeat",
    scope: "app",
  },
  "app.navigateForward": {
    bindings: ["Mod+]"],
    input: "ignore",
    label: "Go forward",
    repeat: "ignore-key-repeat",
    scope: "app",
  },
  "app.openAccount1": {
    bindings: ["Mod+2"],
    input: "allow",
    label: "Open account 1",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount2": {
    bindings: ["Mod+3"],
    input: "allow",
    label: "Open account 2",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount3": {
    bindings: ["Mod+4"],
    input: "allow",
    label: "Open account 3",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount4": {
    bindings: ["Mod+5"],
    input: "allow",
    label: "Open account 4",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount5": {
    bindings: ["Mod+6"],
    input: "allow",
    label: "Open account 5",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount6": {
    bindings: ["Mod+7"],
    input: "allow",
    label: "Open account 6",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount7": {
    bindings: ["Mod+8"],
    input: "allow",
    label: "Open account 7",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount8": {
    bindings: ["Mod+9"],
    input: "allow",
    label: "Open account 8",
    repeat: "once",
    scope: "app",
  },
  "app.openAllAccounts": {
    bindings: ["Mod+1"],
    input: "allow",
    label: "All accounts",
    repeat: "once",
    scope: "app",
  },
  "app.openScheduled": {
    bindings: ["Mod+Shift+S"],
    input: "allow",
    label: "Scheduled",
    repeat: "ignore-key-repeat",
    scope: "app",
  },
  "app.openSettings": {
    bindings: ["Mod+,"],
    input: "allow",
    label: "Settings",
    repeat: "ignore-key-repeat",
    scope: "app",
  },
  "app.openTemplates": {
    bindings: ["Mod+Shift+T"],
    input: "allow",
    label: "Templates",
    repeat: "ignore-key-repeat",
    scope: "app",
  },
  "app.searchMail": {
    bindings: ["Mod+K"],
    input: "allow",
    label: "Search mail",
    repeat: "once",
    scope: "app",
  },
  "app.toggleSent": {
    bindings: ["Shift+S"],
    input: "ignore",
    label: "Sent",
    repeat: "ignore-key-repeat",
    scope: "app",
  },
  "app.toggleSidebar": {
    bindings: ["Mod+\\"],
    input: "allow",
    label: "Toggle sidebar",
    repeat: "ignore-key-repeat",
    scope: "app",
  },
  "app.toggleSpam": {
    bindings: ["S"],
    input: "ignore",
    label: "Spam",
    repeat: "ignore-key-repeat",
    scope: "app",
  },
  "app.toggleTrash": {
    bindings: ["T"],
    input: "ignore",
    label: "Trash",
    repeat: "ignore-key-repeat",
    scope: "app",
  },
  "app.toggleUnread": {
    bindings: ["U"],
    input: "ignore",
    label: "Toggle unread filter",
    repeat: "ignore-key-repeat",
    scope: "app",
  },
  "app.undo": {
    bindings: ["Mod+Z"],
    input: "ignore",
    label: "Undo last action",
    repeat: "once",
    scope: "app",
  },
  "composer.attach": {
    bindings: ["Mod+Shift+A"],
    input: "allow",
    label: "Attach files",
    repeat: "once",
    scope: "composer",
  },
  "composer.clean": {
    bindings: ["Mod+Shift+C"],
    input: "allow",
    label: "Clean up draft",
    repeat: "once",
    scope: "composer",
  },
  "composer.close": {
    bindings: ["Escape"],
    input: "allow",
    label: "Close",
    repeat: "once",
    scope: "composer",
  },
  "composer.discard": {
    bindings: ["Mod+D"],
    input: "allow",
    label: "Discard",
    repeat: "once",
    scope: "composer",
  },
  "composer.schedule": {
    bindings: ["Mod+Shift+Enter"],
    input: "allow",
    label: "Schedule send",
    repeat: "once",
    scope: "composer",
  },
  "composer.send": {
    bindings: ["Mod+Enter"],
    input: "allow",
    label: "Send message",
    repeat: "once",
    scope: "composer",
  },
  "composer.stash": {
    bindings: ["Mod+S"],
    input: "allow",
    label: "Stash draft",
    repeat: "ignore-key-repeat",
    scope: "composer",
  },
  "composer.useAccount1": {
    bindings: ["Mod+2"],
    input: "allow",
    label: "Send from account 1",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount2": {
    bindings: ["Mod+3"],
    input: "allow",
    label: "Send from account 2",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount3": {
    bindings: ["Mod+4"],
    input: "allow",
    label: "Send from account 3",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount4": {
    bindings: ["Mod+5"],
    input: "allow",
    label: "Send from account 4",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount5": {
    bindings: ["Mod+6"],
    input: "allow",
    label: "Send from account 5",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount6": {
    bindings: ["Mod+7"],
    input: "allow",
    label: "Send from account 6",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount7": {
    bindings: ["Mod+8"],
    input: "allow",
    label: "Send from account 7",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount8": {
    bindings: ["Mod+9"],
    input: "allow",
    label: "Send from account 8",
    repeat: "once",
    scope: "composer",
  },
  "mailbox.clearSelection": {
    bindings: ["Escape"],
    input: "ignore",
    label: "Clear selection",
    repeat: "once",
    scope: "mailbox",
  },
  "mailbox.manageLabels": {
    bindings: ["Mod+L"],
    input: "ignore",
    label: "Manage selected labels",
    repeat: "once",
    scope: "mailbox",
  },
  "mailbox.nextThread": {
    bindings: ["Tab", "ArrowDown", "J"],
    input: "ignore",
    label: "Next conversation",
    repeat: "allow",
    scope: "mailbox",
  },
  "mailbox.openThread": {
    bindings: ["Enter"],
    input: "ignore",
    label: "Open conversation",
    repeat: "once",
    scope: "mailbox",
  },
  "mailbox.previousThread": {
    bindings: ["Shift+Tab", "ArrowUp", "K"],
    input: "ignore",
    label: "Previous conversation",
    repeat: "allow",
    scope: "mailbox",
  },
  "mailbox.toggleThreadRead": {
    bindings: ["Mod+Shift+U"],
    input: "ignore",
    label: "Toggle read status",
    repeat: "ignore-key-repeat",
    scope: "mailbox",
  },
  "mailbox.toggleThreadSelection": {
    bindings: ["X"],
    input: "ignore",
    label: "Select conversation",
    repeat: "ignore-key-repeat",
    scope: "mailbox",
  },
  "mailbox.trashThread": {
    bindings: ["Mod+D"],
    input: "ignore",
    label: "Move to trash",
    repeat: "once",
    scope: "mailbox",
  },
  "scheduled.cancel": {
    bindings: ["Mod+S"],
    input: "ignore",
    label: "Cancel schedule and move to Stash",
    repeat: "once",
    scope: "scheduled",
  },
  "scheduled.clearActiveRow": {
    bindings: ["Escape"],
    input: "ignore",
    label: "Clear active scheduled email",
    repeat: "once",
    scope: "scheduled",
  },
  "scheduled.discard": {
    bindings: ["Mod+D"],
    input: "ignore",
    label: "Discard scheduled email",
    repeat: "once",
    scope: "scheduled",
  },
  "scheduled.next": {
    bindings: ["Tab", "ArrowDown", "J"],
    input: "ignore",
    label: "Next scheduled email",
    repeat: "allow",
    scope: "scheduled",
  },
  "scheduled.open": {
    bindings: ["Enter"],
    input: "ignore",
    label: "Edit scheduled email",
    repeat: "once",
    scope: "scheduled",
  },
  "scheduled.previous": {
    bindings: ["Shift+Tab", "ArrowUp", "K"],
    input: "ignore",
    label: "Previous scheduled email",
    repeat: "allow",
    scope: "scheduled",
  },
  "templates.focusSearch": {
    bindings: ["Mod+F"],
    input: "allow",
    label: "Search templates",
    repeat: "once",
    scope: "templates",
  },
  "templates.new": {
    bindings: ["Mod+Shift+N"],
    input: "allow",
    label: "New template",
    repeat: "once",
    scope: "templates",
  },
  "templates.next": {
    bindings: ["Mod+Shift+]"],
    input: "allow",
    label: "Next template",
    repeat: "allow",
    scope: "templates",
  },
  "templates.previous": {
    bindings: ["Mod+Shift+["],
    input: "allow",
    label: "Previous template",
    repeat: "allow",
    scope: "templates",
  },
  "templates.save": {
    bindings: ["Mod+S"],
    input: "allow",
    label: "Save template",
    repeat: "ignore-key-repeat",
    scope: "templates",
  },
  "thread.close": {
    bindings: ["Escape"],
    input: "ignore",
    label: "Back to inbox",
    repeat: "once",
    scope: "thread",
  },
  "thread.forwardMessage": {
    bindings: ["F"],
    input: "ignore",
    label: "Forward",
    repeat: "once",
    scope: "thread",
  },
  "thread.manageLabels": {
    bindings: ["Mod+L"],
    input: "ignore",
    label: "Manage labels",
    repeat: "once",
    scope: "thread",
  },
  "thread.nextMessage": {
    bindings: ["ArrowDown", "J"],
    input: "ignore",
    label: "Next message",
    repeat: "allow",
    scope: "thread",
  },
  "thread.popout": {
    bindings: ["Mod+Enter"],
    input: "ignore",
    label: "Open in new window",
    repeat: "once",
    scope: "thread",
  },
  "thread.previousMessage": {
    bindings: ["ArrowUp", "K"],
    input: "ignore",
    label: "Previous message",
    repeat: "allow",
    scope: "thread",
  },
  "thread.replyAllToMessage": {
    bindings: ["Shift+R"],
    input: "ignore",
    label: "Reply all",
    repeat: "once",
    scope: "thread",
  },
  "thread.replyToMessage": {
    bindings: ["R"],
    input: "ignore",
    label: "Reply",
    repeat: "once",
    scope: "thread",
  },
  "thread.toggleThreadRead": {
    bindings: ["Mod+Shift+U"],
    input: "ignore",
    label: "Toggle read status",
    repeat: "ignore-key-repeat",
    scope: "thread",
  },
  "thread.trashThread": {
    bindings: ["Mod+D"],
    input: "ignore",
    label: "Move to trash",
    repeat: "once",
    scope: "thread",
  },
  "threadComposer.attach": {
    bindings: ["Mod+Shift+A"],
    input: "allow",
    label: "Add attachments",
    repeat: "once",
    scope: "thread-composer",
  },
  "threadComposer.clean": {
    bindings: ["Mod+Shift+C"],
    input: "allow",
    label: "Clean up reply",
    repeat: "once",
    scope: "thread-composer",
  },
  "threadComposer.close": {
    bindings: ["Escape"],
    input: "allow",
    label: "Close draft",
    repeat: "once",
    scope: "thread-composer",
  },
  "threadComposer.createReply": {
    bindings: ["Mod+Shift+R"],
    input: "allow",
    label: "Create reply",
    repeat: "once",
    scope: "thread-composer",
  },
  "threadComposer.send": {
    bindings: ["Mod+Enter"],
    input: "allow",
    label: "Send message",
    repeat: "once",
    scope: "thread-composer",
  },
} as const satisfies Record<string, HotkeyCommandDefinition>;

export type HotkeyCommandId = keyof typeof HOTKEY_COMMANDS;

/**
 * Sidebar order: All accounts takes `Mod+1`, so the first eight accounts
 * take `Mod+2` through `Mod+9`.
 */
export const OPEN_ACCOUNT_COMMAND_IDS = [
  "app.openAccount1",
  "app.openAccount2",
  "app.openAccount3",
  "app.openAccount4",
  "app.openAccount5",
  "app.openAccount6",
  "app.openAccount7",
  "app.openAccount8",
] as const satisfies readonly HotkeyCommandId[];

/**
 * The same numbers as the sidebar, so an account keeps one shortcut
 * everywhere; `Mod+1` stays unbound here because mail is never sent from All
 * accounts.
 */
export const COMPOSER_ACCOUNT_COMMAND_IDS = [
  "composer.useAccount1",
  "composer.useAccount2",
  "composer.useAccount3",
  "composer.useAccount4",
  "composer.useAccount5",
  "composer.useAccount6",
  "composer.useAccount7",
  "composer.useAccount8",
] as const satisfies readonly HotkeyCommandId[];

export interface HotkeyBinding {
  readonly key: string;
  readonly modifiers: readonly string[];
}

export const parseHotkeyBinding = (binding: string): HotkeyBinding => {
  const parts = binding.split("+");

  return { key: parts.at(-1) ?? "", modifiers: parts.slice(0, -1) };
};

/**
 * Whether every binding starts from `Mod`, so a hint revealed by holding
 * `Mod` stays true when followed. A plain `S` shown under a held `Mod` would
 * be pressed as `Mod+S`, a different command.
 */
export const isModHotkeyCommand = (commandId: HotkeyCommandId): boolean =>
  HOTKEY_COMMANDS[commandId].bindings.every((binding) =>
    parseHotkeyBinding(binding).modifiers.includes("Mod")
  );

// A US layout reports Shift+] as "}", and ui-sdk matches punctuation by the
// character typed, so a shifted bracket also registers what Shift produces.
const SHIFTED_KEYS = new Map([
  ["[", "{"],
  ["]", "}"],
]);

const joinKeys = (modifiers: readonly string[], key: string): string =>
  [...modifiers, key].join("+").toLowerCase();

export const toShortcutKeys = (binding: string): readonly string[] => {
  const { key, modifiers } = parseHotkeyBinding(binding);
  const shifted = SHIFTED_KEYS.get(key);

  return shifted !== undefined && modifiers.includes("Shift")
    ? [joinKeys(modifiers, key), joinKeys(modifiers, shifted)]
    : [joinKeys(modifiers, key)];
};

export const matchesHotkeyCommand = (
  event: KeyboardEvent,
  commandId: HotkeyCommandId
): boolean =>
  HOTKEY_COMMANDS[commandId].bindings.some((binding) =>
    toShortcutKeys(binding).some((keys) => matchesShortcut(event, keys))
  );

const isApple = (platform?: HotkeyPlatform): boolean =>
  platform === undefined
    ? ariaKeyshortcuts("mod") === "Meta"
    : platform === "mac";

export const getHotkeyModifierKey = (platform?: HotkeyPlatform): string =>
  ariaKeyshortcuts("mod", isApple(platform));

export interface HotkeyCommandDisplay {
  readonly bindings: readonly string[];
  readonly label: string;
}

// macOS menus list ⇧ before ⌘; Windows and Linux lead with Ctrl.
const toDisplayKeys = (binding: string, apple: boolean): string => {
  const { key, modifiers } = parseHotkeyBinding(binding);
  const ordered = apple
    ? [
        ...modifiers.filter((modifier) => modifier !== "Mod"),
        ...modifiers.filter((modifier) => modifier === "Mod"),
      ]
    : modifiers;

  return joinKeys(ordered, key);
};

export const getHotkeyDisplay = (
  commandId: HotkeyCommandId,
  platform?: HotkeyPlatform
): HotkeyCommandDisplay => {
  const command = HOTKEY_COMMANDS[commandId];
  const apple = isApple(platform);

  return {
    bindings: command.bindings.map((binding) =>
      formatShortcut(toDisplayKeys(binding, apple), apple)
    ),
    label: command.label,
  };
};

export const getHotkeyAriaLabel = (
  commandId: HotkeyCommandId,
  platform?: HotkeyPlatform
): string => {
  const apple = isApple(platform);

  return HOTKEY_COMMANDS[commandId].bindings
    .map((binding) => {
      const { key, modifiers } = parseHotkeyBinding(binding);
      return ariaKeyshortcuts(joinKeys(modifiers, key), apple);
    })
    .join(" ");
};

const HOTKEY_LAYER_STATES = [null, ...HOTKEY_LAYERS] as const;

const canScopesCoexist = (left: HotkeyScope, right: HotkeyScope): boolean =>
  HOTKEY_LAYER_STATES.some(
    (topLayer) =>
      isHotkeyScopeActive(left, topLayer) &&
      isHotkeyScopeActive(right, topLayer)
  );

// One spelling per key press on a platform: `mod` resolved, modifiers sorted.
const canonicalKeys = (keys: string, platform: HotkeyPlatform): string => {
  const parts = keys.split("+");
  const modifiers = parts
    .slice(0, -1)
    .map((modifier) => {
      if (modifier !== "mod") {
        return modifier;
      }
      return platform === "mac" ? "meta" : "control";
    })
    .toSorted();

  return [...modifiers, parts.at(-1) ?? ""].join("+");
};

const sharesKeys = (
  left: string,
  right: string,
  platform: HotkeyPlatform
): boolean => {
  const leftKeys = new Set(
    toShortcutKeys(left).map((keys) => canonicalKeys(keys, platform))
  );

  return toShortcutKeys(right).some((keys) =>
    leftKeys.has(canonicalKeys(keys, platform))
  );
};

export const validateHotkeyCommands = (
  commands: Readonly<Record<string, HotkeyCommandDefinition>> = HOTKEY_COMMANDS,
  platforms: readonly HotkeyPlatform[] = ["mac", "windows", "linux"]
): readonly string[] => {
  const errors: string[] = [];
  const entries = Object.entries(commands);

  for (const [commandId, command] of entries) {
    if (command.label.trim().length === 0) {
      errors.push(`${commandId} has no label`);
    }

    if (command.bindings.length === 0) {
      errors.push(`${commandId} has no bindings`);
    }

    for (const binding of command.bindings) {
      if (/\s/u.test(binding.trim())) {
        errors.push(
          `${commandId} (${binding}) is a key sequence, which ui-sdk shortcuts don't support`
        );
      }
    }
  }

  for (const platform of platforms) {
    for (const [leftIndex, [leftId, leftCommand]] of entries.entries()) {
      for (const [rightIndex, [rightId, rightCommand]] of entries.entries()) {
        if (rightIndex < leftIndex) {
          continue;
        }

        if (!canScopesCoexist(leftCommand.scope, rightCommand.scope)) {
          continue;
        }

        for (const [
          leftBindingIndex,
          leftBinding,
        ] of leftCommand.bindings.entries()) {
          for (const [
            rightBindingIndex,
            rightBinding,
          ] of rightCommand.bindings.entries()) {
            if (
              leftIndex === rightIndex &&
              leftBindingIndex >= rightBindingIndex
            ) {
              continue;
            }

            if (sharesKeys(leftBinding, rightBinding, platform)) {
              errors.push(
                `${platform}: ${leftId} (${leftBinding}) conflicts with ${rightId} (${rightBinding})`
              );
            }
          }
        }
      }
    }
  }

  return errors;
};
