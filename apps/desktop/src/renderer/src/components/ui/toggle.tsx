import {
  Toggle as TogglePrimitive,
  ToggleGroup as ToggleGroupPrimitive,
} from "@ui-sdk/react/toggle";

import { buttonVariants } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export { ToggleIcon } from "@ui-sdk/react/toggle";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

// The pressed look holds on hover: the unpressed variant's `hover:text-*` and
// ghost's later-emitted `dark:hover:bg-muted/50` tie with it otherwise.
const pressedClassName = {
  default:
    "data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:hover:bg-primary/80 dark:data-pressed:hover:bg-primary/80 data-pressed:hover:text-primary-foreground",
  ghost: "",
  secondary:
    "data-pressed:bg-secondary data-pressed:text-secondary-foreground data-pressed:hover:bg-secondary/80 dark:data-pressed:hover:bg-secondary/80 data-pressed:hover:text-secondary-foreground",
} as const;

type ToggleVariant = "default" | "ghost" | "outline" | "secondary";

const defaultPressedVariant = {
  default: "default",
  ghost: "secondary",
  outline: "default",
  secondary: "secondary",
} as const satisfies Record<ToggleVariant, keyof typeof pressedClassName>;

// ui-sdk's Toggle has no `focusableWhenDisabled`, so this mirrors Button's:
// it stays in the Tab order with `aria-disabled`, which a Tooltip around it
// needs, and refuses every change, an agent's included.
const Toggle = ({
  className,
  focusableWhenDisabled = false,
  pressedVariant,
  size = "icon",
  variant = "ghost",
  ...props
}: ClassNameProps<React.ComponentProps<typeof TogglePrimitive>> & {
  focusableWhenDisabled?: boolean;
  pressedVariant?: keyof typeof pressedClassName;
  size?: ButtonProps["size"];
  variant?: ToggleVariant;
}) => {
  const {
    disabled: _disabled,
    onPressedChange: _onPressedChange,
    ...enabledProps
  } = props;

  return (
    <TogglePrimitive
      className={cn(
        buttonVariants({ size, variant }),
        pressedClassName[pressedVariant ?? defaultPressedVariant[variant]],
        className
      )}
      {...(props.disabled === true && focusableWhenDisabled
        ? {
            ...enabledProps,
            "aria-disabled": true,
            "data-disabled": "",
            onPressedChange: (
              _pressed: boolean,
              details: { cancel: () => void }
            ) => {
              details.cancel();
            },
          }
        : props)}
    />
  );
};

const ToggleGroup = <T extends string = string>({
  className,
  ...props
}: Omit<React.ComponentProps<typeof ToggleGroupPrimitive<T>>, "className"> & {
  className?: string;
}) => (
  <ToggleGroupPrimitive
    className={cn("flex items-center gap-1", className)}
    {...props}
  />
);

export { Toggle, ToggleGroup };
