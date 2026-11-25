import { ChevronDownIcon, PipetteIcon, ShuffleIcon } from "lucide-react";
import { useId } from "react";

import MailLabelBadge from "@/components/mail/mail-label-badge";
import { Button } from "@/components/ui/button";
import {
  ColorPicker,
  ColorPickerArea,
  ColorPickerAreaThumb,
  ColorPickerEyeDropper,
  ColorPickerInput,
  ColorPickerSlider,
  ColorPickerSliderThumb,
  ColorPickerSwatch,
} from "@/components/ui/color-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  isLabelColor,
  labelTextColor,
  randomLabelColor,
} from "@/shared/label-color";

interface LabelColorFieldProps {
  readonly disabled: boolean;
  readonly label: string;
  readonly onValueChange: (color: string) => void;
  readonly value: string;
}

const LabelColorField = ({
  disabled,
  label,
  onValueChange,
  value,
}: LabelColorFieldProps) => {
  const captionId = useId();

  return (
    <ColorPicker
      aria-labelledby={captionId}
      className="grid min-w-0 gap-1.5"
      disabled={disabled}
      format="hex"
      onValueChange={(next, details) => {
        // Labels are opaque `#rrggbb`; a typed colour with alpha is refused.
        const color = next.toLowerCase();
        if (!isLabelColor(color)) {
          details.cancel();
          return;
        }
        onValueChange(color);
      }}
      space="hsv"
      value={value}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="text-xs/relaxed leading-none font-medium select-none"
          id={captionId}
        >
          Label color
        </span>
        <span className="sr-only">Label preview:</span>
        <MailLabelBadge
          className="max-w-48"
          color={{ background: value, text: labelTextColor(value) }}
          label={label}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Popover>
          <PopoverTrigger
            aria-label="Pick color"
            disabled={disabled}
            render={
              <Button
                className="min-w-0 flex-1 justify-start"
                type="button"
                variant="outline"
              />
            }
          >
            <ColorPickerSwatch aria-hidden="true" />
            <span className="truncate font-mono">{value}</span>
            <ChevronDownIcon className="text-muted-foreground ml-auto" />
          </PopoverTrigger>
          <PopoverContent
            aria-label="Pick color"
            align="start"
            className="w-64 gap-2"
          >
            <ColorPickerArea>
              <ColorPickerAreaThumb />
            </ColorPickerArea>
            <ColorPickerSlider channel="hue">
              <ColorPickerSliderThumb />
            </ColorPickerSlider>
            <div className="flex items-center gap-1.5">
              <ColorPickerInput aria-label="Hex color" />
              <ColorPickerEyeDropper
                aria-label="Pick from screen"
                title="Pick from screen"
              >
                <PipetteIcon aria-hidden="true" />
              </ColorPickerEyeDropper>
            </div>
          </PopoverContent>
        </Popover>
        <Button
          aria-label="Random color"
          disabled={disabled}
          onClick={() => {
            onValueChange(randomLabelColor());
          }}
          size="icon"
          title="Random color"
          type="button"
          variant="outline"
        >
          <ShuffleIcon />
        </Button>
      </div>
    </ColorPicker>
  );
};

export default LabelColorField;
