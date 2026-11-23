import {
  Toolbar as ToolbarPrimitive,
  ToolbarButton as ToolbarButtonPrimitive,
  ToolbarSeparator as ToolbarSeparatorPrimitive,
} from "@ui-sdk/react/toolbar";

import { Button } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export { createToolbarController, ToolbarGroup } from "@ui-sdk/react/toolbar";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

const Toolbar = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ToolbarPrimitive>>) => (
  <ToolbarPrimitive
    className={cn("flex min-w-0 items-center gap-0.5", className)}
    {...props}
  />
);

// Rendering through Kisa's Button keeps its look and lists each button by its
// own name for agents, beside the toolbar's roving focus.
const ToolbarButton = ({
  className,
  size = "icon",
  variant = "ghost",
  ...props
}: ClassNameProps<React.ComponentProps<typeof ToolbarButtonPrimitive>> &
  Pick<ButtonProps, "size" | "variant">) => (
  <ToolbarButtonPrimitive
    render={<Button className={className} size={size} variant={variant} />}
    {...props}
  />
);

const ToolbarSeparator = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof ToolbarSeparatorPrimitive>>) => (
  <ToolbarSeparatorPrimitive
    className={cn("bg-border mx-1 h-4 w-px shrink-0", className)}
    {...props}
  />
);

export { Toolbar, ToolbarButton, ToolbarSeparator };
