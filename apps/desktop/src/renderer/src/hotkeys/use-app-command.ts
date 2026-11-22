import { useHotkeys } from "@tanstack/react-hotkeys";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";

import { useIsHotkeyScopeActive } from "@/hotkeys/app-hotkeys-provider";
import { HOTKEY_COMMANDS, shouldRunHotkeyCommand } from "@/hotkeys/commands";
import type { HotkeyCommandId } from "@/hotkeys/commands";

export interface UseAppCommandOptions {
  readonly enabled?: boolean;
  readonly target?: React.RefObject<HTMLElement | null>;
}

interface AppCommandProps {
  readonly callback: () => void;
  readonly command: HotkeyCommandId;
  readonly options?: UseAppCommandOptions;
}

export const getAppCommandHotkeys = (
  commandId: HotkeyCommandId,
  onCommand: () => void,
  target?: React.RefObject<HTMLElement | null>
): UseHotkeyDefinition[] => {
  const command = HOTKEY_COMMANDS[commandId];

  const baseOptions = {
    ignoreDefaultPrevented: "ignoreDefaultPrevented" in command,
    ignoreInputs: command.input === "ignore",
    requireReset: command.repeat === "once",
  };
  // TanStack Hotkeys treats a present `target` key as element-scoped even when
  // its value is undefined and registers nothing until it resolves. Only an
  // omitted key listens on the document.
  const options =
    target === undefined ? baseOptions : { ...baseOptions, target };

  return command.bindings.map((hotkey) => ({
    callback: (event: KeyboardEvent) => {
      if (!shouldRunHotkeyCommand(command.repeat, event.repeat)) {
        return;
      }

      onCommand();
    },
    hotkey,
    options,
  }));
};

export const useAppCommand = (
  commandId: HotkeyCommandId,
  onCommand: () => void,
  options: UseAppCommandOptions = {}
): void => {
  const scopeActive = useIsHotkeyScopeActive(HOTKEY_COMMANDS[commandId].scope);
  const enabled = options.enabled ?? true;

  useHotkeys(
    scopeActive && enabled
      ? getAppCommandHotkeys(commandId, onCommand, options.target)
      : []
  );
};

export const AppCommand = ({ callback, command, options }: AppCommandProps) => {
  useAppCommand(command, callback, options);

  return null;
};
