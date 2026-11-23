import { renderElement } from "@ui-sdk/react/primitive";
import type { RenderProp } from "@ui-sdk/react/primitive";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type LayoutProps<Tag extends keyof React.JSX.IntrinsicElements> =
  React.ComponentProps<Tag> & {
    render?: RenderProp;
  };

const ItemGroup = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      role: "list",
      "data-slot": "item-group",
      className: cn(
        "group/item-group flex w-full flex-col gap-4 has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2",
        className
      ),
      ...props,
    },
    render
  );

const ItemSeparator = ({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) => (
  <Separator
    orientation="horizontal"
    className={cn("my-2", className)}
    {...props}
  />
);

const itemVariants = cva(
  "group/item flex w-full flex-wrap items-center rounded-md border text-xs/relaxed transition-colors duration-100 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [a]:transition-colors [a]:hover:bg-muted",
  {
    variants: {
      variant: {
        default: "border-transparent",
        outline: "border-transparent bg-input/20 dark:bg-input/30",
        muted: "border-transparent bg-muted/50",
      },
      size: {
        default: "gap-2.5 px-3 py-2.5",
        sm: "gap-2.5 px-3 py-2.5",
        xs: "gap-2.5 px-2.5 py-2 in-data-[slot=menu-content]:p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const Item = ({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: LayoutProps<"div"> & VariantProps<typeof itemVariants>) =>
  renderElement(
    "div",
    {
      "data-slot": "item",
      "data-variant": variant,
      "data-size": size,
      className: cn(itemVariants({ variant, size, className })),
      ...props,
    },
    render
  );

const itemMediaVariants = cva(
  "flex shrink-0 items-center justify-center gap-2 group-has-data-[slot=item-description]/item:translate-y-0.5 group-has-data-[slot=item-description]/item:self-start [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "[&_svg:not([class*='size-'])]:size-4",
        image:
          "size-8 overflow-hidden rounded-sm group-data-[size=sm]/item:size-8 group-data-[size=xs]/item:size-6 [&_img]:size-full [&_img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const ItemMedia = ({
  className,
  variant = "default",
  render,
  ...props
}: LayoutProps<"div"> & VariantProps<typeof itemMediaVariants>) =>
  renderElement(
    "div",
    {
      "data-slot": "item-media",
      "data-variant": variant,
      className: cn(itemMediaVariants({ variant, className })),
      ...props,
    },
    render
  );

const ItemContent = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "item-content",
      className: cn(
        "flex flex-1 flex-col gap-1 group-data-[size=xs]/item:gap-0.5 [&+[data-slot=item-content]]:flex-none",
        className
      ),
      ...props,
    },
    render
  );

const ItemTitle = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "item-title",
      className: cn(
        "line-clamp-1 flex w-fit items-center gap-2 text-xs/relaxed leading-snug font-medium underline-offset-4",
        className
      ),
      ...props,
    },
    render
  );

const ItemDescription = ({ className, render, ...props }: LayoutProps<"p">) =>
  renderElement(
    "p",
    {
      "data-slot": "item-description",
      className: cn(
        "text-muted-foreground [&>a:hover]:text-primary line-clamp-2 text-left text-xs/relaxed font-normal [&>a]:underline [&>a]:underline-offset-4",
        className
      ),
      ...props,
    },
    render
  );

const ItemActions = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "item-actions",
      className: cn("flex items-center gap-2", className),
      ...props,
    },
    render
  );

const ItemHeader = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "item-header",
      className: cn(
        "flex basis-full items-center justify-between gap-2",
        className
      ),
      ...props,
    },
    render
  );

const ItemFooter = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "item-footer",
      className: cn(
        "flex basis-full items-center justify-between gap-2",
        className
      ),
      ...props,
    },
    render
  );

export {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
};
