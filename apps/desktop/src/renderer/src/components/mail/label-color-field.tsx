import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";

import MailLabelBadge from "@/components/mail/mail-label-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { gmailLabelTextColor } from "@/mail/label";
import { GMAIL_LABEL_COLOR_VALUES } from "@/shared/ipc/mail";
import type { GmailLabelInputColor } from "@/shared/ipc/mail";

type GmailLabelColorValue = GmailLabelInputColor["background"];

interface LabelColorFieldProps {
  readonly disabled: boolean;
  readonly label: string;
  readonly onClear?: () => void;
  readonly onSelectBackground: (color: GmailLabelColorValue) => void;
  readonly onSelectText: (color: GmailLabelColorValue) => void;
  readonly selectedBackground?: string;
  readonly selectedText?: string;
}

interface GmailLabelColorPickerProps {
  readonly disabled: boolean;
  readonly label: string;
  readonly onSelect: (color: GmailLabelColorValue) => void;
  readonly selected?: string;
}

const GMAIL_LABEL_COLOR_VALUE_SET: ReadonlySet<string> = new Set(
  GMAIL_LABEL_COLOR_VALUES
);

export const isGmailLabelColorValue = (
  value: string
): value is GmailLabelColorValue => GMAIL_LABEL_COLOR_VALUE_SET.has(value);

const GmailLabelColorPicker = ({
  disabled,
  label,
  onSelect,
  selected,
}: GmailLabelColorPickerProps) => {
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
              {GMAIL_LABEL_COLOR_VALUES.map((color) => {
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
                        color: gmailLabelTextColor(color),
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
}: LabelColorFieldProps) => (
  <div className="grid gap-1.5">
    <div className="flex items-center justify-between gap-3">
      <Label>Color</Label>
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
      <GmailLabelColorPicker
        disabled={disabled}
        label="Background"
        onSelect={onSelectBackground}
        selected={selectedBackground}
      />
      <GmailLabelColorPicker
        disabled={disabled}
        label="Text"
        onSelect={onSelectText}
        selected={selectedText}
      />
    </div>
  </div>
);

export default LabelColorField;
