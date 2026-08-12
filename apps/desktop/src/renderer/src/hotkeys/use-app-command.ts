import { useHotkeys } from "@tanstack/react-hotkeys";

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

export const useAppCommand = (
  commandId: HotkeyCommandId,
  onCommand: () => void,
  options: UseAppCommandOptions = {}
): void => {
  const command = HOTKEY_COMMANDS[commandId];
  const scopeActive = useIsHotkeyScopeActive(command.scope);
  const enabled = options.enabled ?? true;
  const definitions =
    scopeActive && enabled
      ? command.bindings.map((hotkey) => ({
          callback: (event: KeyboardEvent) => {
            if (!shouldRunHotkeyCommand(command.repeat, event.repeat)) {
              return;
            }

            onCommand();
          },
          hotkey,
          options: {
            ignoreInputs: command.input === "ignore",
            requireReset: command.repeat === "once",
            target: options.target,
          },
        }))
      : [];

  useHotkeys(definitions);
};

export const AppCommand = ({ callback, command, options }: AppCommandProps) => {
  useAppCommand(command, callback, options);

  return null;
};
