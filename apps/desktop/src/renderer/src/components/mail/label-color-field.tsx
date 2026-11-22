import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";

import MailLabelBadge from "@/components/mail/mail-label-badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { labelTextColor } from "@/mail/label";
import { LABEL_COLOR_VALUES } from "@/shared/ipc/mail";
import type { MailLabelInputColor } from "@/shared/ipc/mail";

type LabelColorValue = MailLabelInputColor["background"];

interface LabelColorFieldProps {
  readonly disabled: boolean;
  readonly label: string;
  readonly onClear?: () => void;
  readonly onSelectBackground: (color: LabelColorValue) => void;
  readonly onSelectText: (color: LabelColorValue) => void;
  readonly selectedBackground?: string;
  readonly selectedText?: string;
}

interface LabelColorPickerProps {
  readonly disabled: boolean;
  readonly label: string;
  readonly onSelect: (color: LabelColorValue) => void;
  readonly selected?: string;
}

const LABEL_COLOR_VALUE_SET: ReadonlySet<string> = new Set(LABEL_COLOR_VALUES);

export const isLabelColorValue = (value: string): value is LabelColorValue =>
  LABEL_COLOR_VALUE_SET.has(value);

const LabelColorPicker = ({
  disabled,
  label,
  onSelect,
  selected,
}: LabelColorPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const groupName = useId();

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <PopoverTrigger
        render={
          <Button
            className="min-w-0 flex-1 justify-start"
            disabled={disabled}
            type="button"
            variant="outline"
          />
        }
      >
        <span
          aria-hidden="true"
          className="border-foreground/15 size-3.5 shrink-0 rounded-full border"
          style={
            selected === undefined ? undefined : { backgroundColor: selected }
          }
        />
        <span className="truncate">{label}</span>
        <ChevronDownIcon className="text-muted-foreground ml-auto" />
      </PopoverTrigger>
      {isOpen ? (
        <PopoverContent align="start" className="w-80 gap-2">
          <PopoverTitle>{label} color</PopoverTitle>
          <fieldset>
            <legend className="sr-only">
              Choose {label.toLowerCase()} color
            </legend>
            <div className="grid grid-cols-12 gap-1">
              {LABEL_COLOR_VALUES.map((color) => {
                const isSelected = selected === color;

                return (
                  <label
                    className="relative size-5 justify-self-center"
                    key={color}
                    title={color}
                  >
                    <input
                      aria-label={`${label} ${color}`}
                      checked={isSelected}
                      className="peer sr-only"
                      name={groupName}
                      onChange={() => {
                        onSelect(color);
                        setIsOpen(false);
                      }}
                      type="radio"
                    />
                    <span
                      className="border-foreground/15 peer-focus-visible:ring-ring/50 peer-checked:ring-ring peer-checked:ring-offset-popover flex size-5 items-center justify-center rounded-full border peer-checked:ring-2 peer-checked:ring-offset-1 peer-focus-visible:ring-2"
                      style={{
                        backgroundColor: color,
                        color: labelTextColor(color),
                      }}
                    >
                      {isSelected ? <CheckIcon className="size-2.5" /> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </PopoverContent>
      ) : null}
    </Popover>
  );
};

const LabelColorField = ({
  disabled,
  label,
  onClear,
  onSelectBackground,
  onSelectText,
  selectedBackground,
  selectedText,
}: LabelColorFieldProps) => {
  const captionId = useId();

  // The caption names the whole control group, so it is not a `<label>`.
  return (
    <fieldset aria-labelledby={captionId} className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span
          className="flex items-center gap-2 text-xs/relaxed leading-none font-medium select-none"
          id={captionId}
        >
          Color
        </span>
        <MailLabelBadge
          ariaLabel={`Label preview: ${label}`}
          className="max-w-48"
          color={
            selectedBackground === undefined || selectedText === undefined
              ? undefined
              : { background: selectedBackground, text: selectedText }
          }
          label={label}
        />
      </div>
      <div className="flex items-center gap-1.5">
        {onClear === undefined ? null : (
          <Button
            aria-pressed={selectedBackground === undefined}
            disabled={disabled}
            onClick={onClear}
            type="button"
            variant={selectedBackground === undefined ? "secondary" : "outline"}
          >
            None
          </Button>
        )}
        <LabelColorPicker
          disabled={disabled}
          label="Background"
          onSelect={onSelectBackground}
          selected={selectedBackground}
        />
        <LabelColorPicker
          disabled={disabled}
          label="Text"
          onSelect={onSelectText}
          selected={selectedText}
        />
      </div>
    </fieldset>
  );
};

export default LabelColorField;
