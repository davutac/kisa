import { renderElement } from "@ui-sdk/react/primitive";
import type { RenderProp } from "@ui-sdk/react/primitive";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { aiSurfaceClassName } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type LayoutProps<Tag extends keyof React.JSX.IntrinsicElements> =
  React.ComponentProps<Tag> & {
    render?: RenderProp;
  };

const buttonGroupVariants = cva(
  "flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10 has-[>[data-slot=button-group]]:gap-2 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal:
          "*:data-slot:rounded-r-none [&>[data-slot]:not(:has(~[data-slot]))]:rounded-r-md! [&>[data-slot]~[data-slot]]:rounded-l-none [&>[data-slot]~[data-slot]]:border-l-0",
        vertical:
          "flex-col *:data-slot:rounded-b-none [&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-md! [&>[data-slot]~[data-slot]]:rounded-t-none [&>[data-slot]~[data-slot]]:border-t-0",
      },
      variant: {
        default: "",
        ai: cn(
          aiSurfaceClassName,
          "rounded-md [&_[data-slot=button]]:relative [&_[data-slot=button]]:z-10"
        ),
      },
    },
    defaultVariants: {
      orientation: "horizontal",
      variant: "default",
    },
  }
);

const ButtonGroup = ({
  className,
  orientation,
  variant,
  render,
  ...props
}: LayoutProps<"div"> & VariantProps<typeof buttonGroupVariants>) =>
  renderElement(
    "div",
    {
      role: "group",
      "data-slot": "button-group",
      "data-orientation": orientation,
      className: cn(buttonGroupVariants({ orientation, variant }), className),
      ...props,
    },
    render
  );

const ButtonGroupText = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "button-group-text",
      className: cn(
        "bg-muted flex items-center gap-2 rounded-md border border-transparent px-2.5 text-xs/relaxed font-medium [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      ...props,
    },
    render
  );

const ButtonGroupSeparator = ({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof Separator>) => (
  <Separator
    orientation={orientation}
    className={cn(
      "bg-input relative self-stretch data-horizontal:mx-px data-horizontal:w-auto data-vertical:my-px data-vertical:h-auto",
      className
    )}
    {...props}
  />
);

export {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  buttonGroupVariants,
};
