import {
  ColorPicker as ColorPickerPrimitive,
  ColorPickerArea as ColorPickerAreaPrimitive,
  ColorPickerAreaThumb as ColorPickerAreaThumbPrimitive,
  ColorPickerEyeDropper as ColorPickerEyeDropperPrimitive,
  ColorPickerInput as ColorPickerInputPrimitive,
  ColorPickerSlider as ColorPickerSliderPrimitive,
  ColorPickerSliderThumb as ColorPickerSliderThumbPrimitive,
  ColorPickerSwatch as ColorPickerSwatchPrimitive,
} from "@ui-sdk/react/color-picker";

import { buttonVariants } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export { createColorPickerController } from "@ui-sdk/react/color-picker";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

const thumbClassName =
  "size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-(--color-picker-color) shadow-[0_0_0_1px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.3)] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-disabled:opacity-50";

const ColorPicker = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ColorPickerPrimitive>>) => (
  <ColorPickerPrimitive
    className={cn("flex flex-col gap-2", className)}
    {...props}
  />
);

const ColorPickerArea = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ColorPickerAreaPrimitive>>) => (
  <ColorPickerAreaPrimitive
    className={cn(
      "relative h-36 w-full touch-none rounded-md [background:var(--color-area-background)] data-disabled:opacity-50",
      className
    )}
    {...props}
  />
);

const ColorPickerAreaThumb = ({
  className,
  ...props
}: ClassNameProps<
  React.ComponentProps<typeof ColorPickerAreaThumbPrimitive>
>) => (
  <ColorPickerAreaThumbPrimitive
    className={cn(thumbClassName, className)}
    {...props}
  />
);

const ColorPickerSlider = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ColorPickerSliderPrimitive>>) => (
  <ColorPickerSliderPrimitive
    className={cn(
      "relative h-3 w-full touch-none rounded-full [background:var(--color-slider-background)] data-disabled:opacity-50",
      className
    )}
    {...props}
  />
);

const ColorPickerSliderThumb = ({
  className,
  ...props
}: ClassNameProps<
  React.ComponentProps<typeof ColorPickerSliderThumbPrimitive>
>) => (
  <ColorPickerSliderThumbPrimitive
    className={cn("top-1/2", thumbClassName, className)}
    {...props}
  />
);

const ColorPickerSwatch = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ColorPickerSwatchPrimitive>>) => (
  <ColorPickerSwatchPrimitive
    className={cn(
      "border-foreground/15 size-3.5 shrink-0 rounded-full border bg-(--color-picker-color)",
      className
    )}
    {...props}
  />
);

const ColorPickerInput = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ColorPickerInputPrimitive>>) => (
  <ColorPickerInputPrimitive
    className={cn(inputClassName, "font-mono", className)}
    {...props}
  />
);

// Hidden where the browser can't pick from the screen, as in jsdom.
const ColorPickerEyeDropper = ({
  className,
  ...props
}: ClassNameProps<
  React.ComponentProps<typeof ColorPickerEyeDropperPrimitive>
>) => (
  <ColorPickerEyeDropperPrimitive
    className={cn(
      buttonVariants({ size: "icon", variant: "outline" }),
      "data-unsupported:hidden",
      className
    )}
    {...props}
  />
);

export {
  ColorPicker,
  ColorPickerArea,
  ColorPickerAreaThumb,
  ColorPickerEyeDropper,
  ColorPickerInput,
  ColorPickerSlider,
  ColorPickerSliderThumb,
  ColorPickerSwatch,
};
