import { renderElement } from "@ui-sdk/react/primitive";
import type { RenderProp } from "@ui-sdk/react/primitive";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type LayoutProps<Tag extends keyof React.JSX.IntrinsicElements> =
  React.ComponentProps<Tag> & {
    render?: RenderProp;
  };

const Empty = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "empty",
      className: cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-dashed p-6 text-center text-balance",
        className
      ),
      ...props,
    },
    render
  );

const EmptyHeader = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "empty-header",
      className: cn("flex max-w-sm flex-col items-center gap-1", className),
      ...props,
    },
    render
  );

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const EmptyMedia = ({
  className,
  variant = "default",
  render,
  ...props
}: LayoutProps<"div"> & VariantProps<typeof emptyMediaVariants>) =>
  renderElement(
    "div",
    {
      "data-slot": "empty-icon",
      "data-variant": variant,
      className: cn(emptyMediaVariants({ variant, className })),
      ...props,
    },
    render
  );

const EmptyTitle = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "empty-title",
      className: cn(
        "font-heading text-sm font-medium tracking-tight",
        className
      ),
      ...props,
    },
    render
  );

const EmptyDescription = ({
  className,
  render,
  ...props
}: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "empty-description",
      className: cn(
        "text-muted-foreground [&>a:hover]:text-primary text-xs/relaxed [&>a]:underline [&>a]:underline-offset-4",
        className
      ),
      ...props,
    },
    render
  );

const EmptyContent = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "empty-content",
      className: cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2 text-xs/relaxed text-balance",
        className
      ),
      ...props,
    },
    render
  );

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
};
