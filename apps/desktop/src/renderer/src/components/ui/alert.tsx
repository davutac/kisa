import { renderElement } from "@ui-sdk/react/primitive";
import type { RenderProp } from "@ui-sdk/react/primitive";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type LayoutProps<Tag extends keyof React.JSX.IntrinsicElements> =
  React.ComponentProps<Tag> & {
    render?: RenderProp;
  };

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2 py-1.5 text-left text-xs/relaxed has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-1.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Alert = ({
  className,
  variant,
  render,
  ...props
}: LayoutProps<"div"> & VariantProps<typeof alertVariants>) =>
  renderElement(
    "div",
    {
      "data-slot": "alert",
      role: "alert",
      className: cn(alertVariants({ variant }), className),
      ...props,
    },
    render
  );

const AlertTitle = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "alert-title",
      className: cn(
        "[&_a]:hover:text-foreground font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className
      ),
      ...props,
    },
    render
  );

const AlertDescription = ({
  className,
  render,
  ...props
}: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "alert-description",
      className: cn(
        "text-muted-foreground [&_a]:hover:text-foreground text-xs/relaxed text-balance md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className
      ),
      ...props,
    },
    render
  );

const AlertAction = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "alert-action",
      className: cn("absolute top-1.5 right-2", className),
      ...props,
    },
    render
  );

export { Alert, AlertTitle, AlertDescription, AlertAction };
