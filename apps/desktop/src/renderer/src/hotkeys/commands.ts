import {
  detectPlatform,
  formatForDisplay,
  normalizeRegisterableHotkey,
} from "@tanstack/react-hotkeys";
import type { RegisterableHotkey } from "@tanstack/react-hotkeys";

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
  "app.openAccount1": {
    bindings: ["1"],
    input: "ignore",
    label: "Open account 1",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount2": {
    bindings: ["2"],
    input: "ignore",
    label: "Open account 2",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount3": {
    bindings: ["3"],
    input: "ignore",
    label: "Open account 3",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount4": {
    bindings: ["4"],
    input: "ignore",
    label: "Open account 4",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount5": {
    bindings: ["5"],
    input: "ignore",
    label: "Open account 5",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount6": {
    bindings: ["6"],
    input: "ignore",
    label: "Open account 6",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount7": {
    bindings: ["7"],
    input: "ignore",
    label: "Open account 7",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount8": {
    bindings: ["8"],
    input: "ignore",
    label: "Open account 8",
    repeat: "once",
    scope: "app",
  },
  "app.openAccount9": {
    bindings: ["9"],
    input: "ignore",
    label: "Open account 9",
    repeat: "once",
    scope: "app",
  },
  "app.openAllAccounts": {
    bindings: ["A"],
    input: "ignore",
    label: "All accounts",
    repeat: "once",
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
  "app.toggleSpam": {
    bindings: ["S"],
    input: "ignore",
    label: "Spam",
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
    bindings: ["Mod+1"],
    input: "allow",
    label: "Send from account 1",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount2": {
    bindings: ["Mod+2"],
    input: "allow",
    label: "Send from account 2",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount3": {
    bindings: ["Mod+3"],
    input: "allow",
    label: "Send from account 3",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount4": {
    bindings: ["Mod+4"],
    input: "allow",
    label: "Send from account 4",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount5": {
    bindings: ["Mod+5"],
    input: "allow",
    label: "Send from account 5",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount6": {
    bindings: ["Mod+6"],
    input: "allow",
    label: "Send from account 6",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount7": {
    bindings: ["Mod+7"],
    input: "allow",
    label: "Send from account 7",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount8": {
    bindings: ["Mod+8"],
    input: "allow",
    label: "Send from account 8",
    repeat: "once",
    scope: "composer",
  },
  "composer.useAccount9": {
    bindings: ["Mod+9"],
    input: "allow",
    label: "Send from account 9",
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

export const shouldRunHotkeyCommand = (
  repeat: HotkeyRepeat,
  isKeyboardRepeat: boolean
): boolean => repeat !== "ignore-key-repeat" || !isKeyboardRepeat;

export type HotkeyCommandId = keyof typeof HOTKEY_COMMANDS;

export const OPEN_ACCOUNT_COMMAND_IDS = [
  "app.openAccount1",
  "app.openAccount2",
  "app.openAccount3",
  "app.openAccount4",
  "app.openAccount5",
  "app.openAccount6",
  "app.openAccount7",
  "app.openAccount8",
  "app.openAccount9",
] as const satisfies readonly HotkeyCommandId[];

export const COMPOSER_ACCOUNT_COMMAND_IDS = [
  "composer.useAccount1",
  "composer.useAccount2",
  "composer.useAccount3",
  "composer.useAccount4",
  "composer.useAccount5",
  "composer.useAccount6",
  "composer.useAccount7",
  "composer.useAccount8",
  "composer.useAccount9",
] as const satisfies readonly HotkeyCommandId[];

export interface HotkeyCommandDisplay {
  readonly bindings: readonly string[];
  readonly label: string;
}

const resolveAriaModifier = (
  part: string,
  platform: HotkeyPlatform
): string => {
  if (part !== "Mod") {
    return part;
  }

  return platform === "mac" ? "Meta" : "Control";
};

export const getHotkeyDisplay = (
  commandId: HotkeyCommandId,
  platform?: HotkeyPlatform
): HotkeyCommandDisplay => {
  const command = HOTKEY_COMMANDS[commandId];
  const resolvedPlatform = platform ?? detectPlatform();

  return {
    bindings: command.bindings.map((binding) =>
      formatForDisplay(binding, {
        platform: resolvedPlatform,
      })
    ),
    label: command.label,
  };
};

export const getHotkeyAriaLabel = (
  commandId: HotkeyCommandId,
  platform?: HotkeyPlatform
): string => {
  const resolvedPlatform = platform ?? detectPlatform();

  return HOTKEY_COMMANDS[commandId].bindings
    .map((binding) =>
      normalizeRegisterableHotkey(binding, resolvedPlatform)
        .split("+")
        .map((part) => resolveAriaModifier(part, resolvedPlatform))
        .join("+")
    )
    .join(" ");
};

const HOTKEY_LAYER_STATES = [null, ...HOTKEY_LAYERS] as const;

const canScopesCoexist = (left: HotkeyScope, right: HotkeyScope): boolean =>
  HOTKEY_LAYER_STATES.some(
    (topLayer) =>
      isHotkeyScopeActive(left, topLayer) &&
      isHotkeyScopeActive(right, topLayer)
  );

const normalizeBindingSequence = (
  binding: string,
  platform: HotkeyPlatform
): readonly string[] =>
  binding
    .trim()
    .split(/\s+/u)
    .map((part) =>
      normalizeRegisterableHotkey(part as RegisterableHotkey, platform)
    );

const isSequencePrefix = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length <= right.length &&
  left.every((binding, index) => binding === right[index]);

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

            const leftSequence = normalizeBindingSequence(
              leftBinding,
              platform
            );
            const rightSequence = normalizeBindingSequence(
              rightBinding,
              platform
            );

            if (
              isSequencePrefix(leftSequence, rightSequence) ||
              isSequencePrefix(rightSequence, leftSequence)
            ) {
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
