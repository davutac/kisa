import { renderElement } from "@ui-sdk/react/primitive";
import type { RenderProp } from "@ui-sdk/react/primitive";
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type LayoutProps<Tag extends keyof React.JSX.IntrinsicElements> =
  React.ComponentProps<Tag> & {
    render?: RenderProp;
  };

const Breadcrumb = ({ className, render, ...props }: LayoutProps<"nav">) =>
  renderElement(
    "nav",
    {
      "aria-label": "breadcrumb",
      "data-slot": "breadcrumb",
      className: cn(className),
      ...props,
    },
    render
  );

const BreadcrumbList = ({ className, render, ...props }: LayoutProps<"ol">) =>
  renderElement(
    "ol",
    {
      "data-slot": "breadcrumb-list",
      className: cn(
        "text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs/relaxed wrap-break-word",
        className
      ),
      ...props,
    },
    render
  );

const BreadcrumbItem = ({ className, render, ...props }: LayoutProps<"li">) =>
  renderElement(
    "li",
    {
      "data-slot": "breadcrumb-item",
      className: cn("inline-flex items-center gap-1", className),
      ...props,
    },
    render
  );

const BreadcrumbLink = ({ className, render, ...props }: LayoutProps<"a">) =>
  renderElement(
    "a",
    {
      "data-slot": "breadcrumb-link",
      className: cn("hover:text-foreground transition-colors", className),
      ...props,
    },
    render
  );

const BreadcrumbPage = ({ className, render, ...props }: LayoutProps<"span">) =>
  renderElement(
    "span",
    {
      "data-slot": "breadcrumb-page",
      "aria-current": "page",
      className: cn("text-foreground font-normal", className),
      ...props,
    },
    render
  );

const BreadcrumbSeparator = ({
  children,
  className,
  render,
  ...props
}: LayoutProps<"li">) =>
  renderElement(
    "li",
    {
      "data-slot": "breadcrumb-separator",
      role: "presentation",
      "aria-hidden": "true",
      className: cn("[&>svg]:size-3.5", className),
      ...props,
      children: children ?? <ChevronRightIcon />,
    },
    render
  );

const BreadcrumbEllipsis = ({
  className,
  render,
  ...props
}: LayoutProps<"span">) =>
  renderElement(
    "span",
    {
      "data-slot": "breadcrumb-ellipsis",
      role: "presentation",
      "aria-hidden": "true",
      className: cn(
        "flex size-4 items-center justify-center [&>svg]:size-3.5",
        className
      ),
      ...props,
      children: (
        <>
          <MoreHorizontalIcon />
          <span className="sr-only">More</span>
        </>
      ),
    },
    render
  );

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};
