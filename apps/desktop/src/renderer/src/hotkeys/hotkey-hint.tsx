import { Fragment } from "react";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { getHotkeyDisplay } from "@/hotkeys/commands";
import type { HotkeyCommandId } from "@/hotkeys/commands";
import { cn } from "@/lib/utils";

interface HotkeyHintProps {
  readonly className?: string;
  readonly command: HotkeyCommandId;
}

export const HotkeyHint = ({ className, command }: HotkeyHintProps) => {
  const display = getHotkeyDisplay(command);

  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex items-center gap-1", className)}
    >
      {display.bindings.map((keys, bindingIndex) => (
        <Fragment key={`${command}:${bindingIndex}`}>
          {bindingIndex === 0 ? null : (
            <span className="text-muted-foreground text-[0.625rem]">/</span>
          )}
          <KbdGroup>
            {keys.map((key, keyIndex) => (
              <Kbd key={`${keyIndex}:${key}`}>{key}</Kbd>
            ))}
          </KbdGroup>
        </Fragment>
      ))}
    </span>
  );
};
