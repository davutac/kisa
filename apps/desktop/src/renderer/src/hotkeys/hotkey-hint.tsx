import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { getHotkeyDisplay } from "@/hotkeys/commands";
import type { HotkeyCommandId } from "@/hotkeys/commands";

interface HotkeyHintProps {
  readonly className?: string;
  readonly command: HotkeyCommandId;
}

export const HotkeyHint = ({ className, command }: HotkeyHintProps) => {
  const display = getHotkeyDisplay(command);

  return (
    <KbdGroup aria-hidden="true" className={className}>
      {display.bindings.map((binding) => (
        <Kbd key={`${command}:${binding}`}>{binding}</Kbd>
      ))}
    </KbdGroup>
  );
};
