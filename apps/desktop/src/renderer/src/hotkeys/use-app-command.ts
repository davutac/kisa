import { registerShortcut } from "@ui-sdk/core/shortcuts";
import { useEffect, useEffectEvent } from "react";

import { useIsHotkeyScopeActive } from "@/hotkeys/app-hotkeys-provider";
import { HOTKEY_COMMANDS, toShortcutKeys } from "@/hotkeys/commands";
import type { HotkeyCommandId } from "@/hotkeys/commands";
import { isBindingKeptByFocus } from "@/hotkeys/focused-control";

export interface UseAppCommandOptions {
  readonly enabled?: boolean;
  /**
   * An element inside a popup that the command belongs to, so it runs while
   * that popup is open, though a modal pauses the page's commands.
   */
  readonly layer?: React.RefObject<HTMLElement | null>;
  readonly target?: React.RefObject<HTMLElement | null>;
}

interface AppCommandProps {
  readonly callback: () => void;
  readonly command: HotkeyCommandId;
  readonly options?: UseAppCommandOptions;
}

const hasFocusIn = (element: HTMLElement | null): boolean =>
  element?.contains(document.activeElement) ?? false;

const registerAppCommand = (
  commandId: HotkeyCommandId,
  onCommand: () => void,
  { layer, target }: Pick<UseAppCommandOptions, "layer" | "target">
): (() => void) => {
  const command = HOTKEY_COMMANDS[commandId];
  const unregister = command.bindings.flatMap((binding) => {
    const guards: (() => boolean)[] = [];
    // ui-sdk runs Mod chords in text fields whatever `allowInInput` says, so
    // an `ignore` command checks focus itself.
    if (command.input === "ignore") {
      guards.push(() => !isBindingKeptByFocus(binding));
    }
    if (target !== undefined) {
      guards.push(() => hasFocusIn(target.current));
    }
    // Only an unguarded shortcut gets ui-sdk's duplicate-key warning.
    const when =
      guards.length === 0
        ? {}
        : { when: () => guards.every((guard) => guard()) };

    return toShortcutKeys(binding).map((keys) =>
      registerShortcut(keys, () => onCommand(), {
        allowInInput: command.input === "allow",
        description: command.label,
        repeat: command.repeat === "allow",
        layer: layer === undefined ? undefined : () => layer.current,
        ...when,
      })
    );
  });

  return () => {
    for (const off of unregister) {
      off();
    }
  };
};

export const useAppCommand = (
  commandId: HotkeyCommandId,
  onCommand: () => void,
  options: UseAppCommandOptions = {}
): void => {
  const scopeActive = useIsHotkeyScopeActive(HOTKEY_COMMANDS[commandId].scope);
  const active = scopeActive && (options.enabled ?? true);
  const { layer, target } = options;
  const runCommand = useEffectEvent(onCommand);

  useEffect(() => {
    if (!active) {
      return;
    }

    return registerAppCommand(commandId, () => runCommand(), {
      layer,
      target,
    });
  }, [active, commandId, layer, target]);
};

export const AppCommand = ({ callback, command, options }: AppCommandProps) => {
  useAppCommand(command, callback, options);

  return null;
};
