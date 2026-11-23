import { InputGroup as InputGroupPrimitive } from "@ui-sdk/react/input";
import { mergeProps, renderElement } from "@ui-sdk/react/primitive";
import type { PartProps } from "@ui-sdk/react/primitive";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { Button } from "@/components/ui/button";
import { InputGroupContext } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const InputGroup = ({
  className,
  ...props
}: Omit<React.ComponentProps<typeof InputGroupPrimitive>, "className"> & {
  className?: string;
}) => (
  <InputGroupContext value>
    <InputGroupPrimitive
      className={cn(
        "group/input-group bg-input/20 has-[[data-slot=input]:focus-visible]:ring-ring/30 has-[[data-slot][aria-invalid=true]]:ring-destructive/20 dark:bg-input/30 dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 relative flex h-7 w-full min-w-0 items-center rounded-md border border-transparent transition-colors outline-none in-data-[slot=combobox-content]:focus-within:ring-0 has-data-[align=block-end]:rounded-md has-data-[align=block-start]:rounded-md has-[[data-slot=input]:focus-visible]:ring-2 has-[[data-slot][aria-invalid=true]]:ring-2 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
        className
      )}
      {...props}
    />
  </InputGroupContext>
);

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-1 py-2 text-xs/relaxed font-medium text-muted-foreground select-none group-data-disabled/input-group:opacity-50 **:data-[slot=kbd]:rounded-[calc(var(--radius-sm)-2px)] **:data-[slot=kbd]:bg-muted-foreground/10 **:data-[slot=kbd]:px-1 **:data-[slot=kbd]:text-[0.625rem] [&>svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      align: {
        "inline-start":
          "order-first pl-2 has-[>button]:ml-[-0.275rem] has-[>kbd]:ml-[-0.275rem]",
        "inline-end":
          "order-last pr-2 has-[>button]:mr-[-0.275rem] has-[>kbd]:mr-[-0.275rem]",
        "block-start":
          "order-first w-full justify-start px-2 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
        "block-end":
          "order-last w-full justify-start px-2 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
);

// Presses on an addon's text and icons reach the field through ui-sdk's group.
const InputGroupAddon = ({
  className,
  align = "inline-start",
  render,
  ...props
}: Omit<PartProps<"div">, "className"> & { className?: string } & VariantProps<
    typeof inputGroupAddonVariants
  >) =>
  renderElement(
    "div",
    mergeProps(
      {
        className: cn(inputGroupAddonVariants({ align }), className),
        "data-align": align,
        "data-slot": "input-group-addon",
      },
      props
    ),
    render
  );

const inputGroupButtonVariants = cva(
  "flex items-center gap-2 rounded-md text-xs/relaxed shadow-none",
  {
    variants: {
      size: {
        xs: "h-5 gap-1 rounded-[calc(var(--radius-sm)-2px)] px-1 [&>svg:not([class*='size-'])]:size-3",
        sm: "gap-1",
        "icon-xs": "size-6 p-0 has-[>svg]:p-0",
        "icon-sm": "size-7 p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
);

const InputGroupButton = ({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset";
  }) => (
  <Button
    type={type}
    data-size={size}
    variant={variant}
    className={cn(inputGroupButtonVariants({ size }), className)}
    {...props}
  />
);

export { InputGroup, InputGroupAddon, InputGroupButton };
