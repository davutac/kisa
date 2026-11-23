import {
  Avatar as AvatarPrimitive,
  AvatarFallback as AvatarFallbackPrimitive,
  AvatarImage as AvatarImagePrimitive,
} from "@ui-sdk/react/avatar";
import { renderElement } from "@ui-sdk/react/primitive";
import type { RenderProp } from "@ui-sdk/react/primitive";

import { cn } from "@/lib/utils";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };
type LayoutProps<Tag extends keyof React.JSX.IntrinsicElements> =
  React.ComponentProps<Tag> & {
    render?: RenderProp;
  };

const Avatar = ({
  className,
  size = "default",
  ...props
}: ClassNameProps<React.ComponentProps<typeof AvatarPrimitive>> & {
  size?: "default" | "sm" | "lg";
}) => (
  <AvatarPrimitive
    data-size={size}
    className={cn(
      "group/avatar relative flex size-8 shrink-0 rounded-lg select-none after:absolute after:inset-0 after:rounded-lg after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten",
      className
    )}
    {...props}
  />
);

const AvatarImage = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof AvatarImagePrimitive>>) => (
  <AvatarImagePrimitive
    className={cn("aspect-square size-full rounded-lg object-cover", className)}
    {...props}
  />
);

const AvatarFallback = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof AvatarFallbackPrimitive>>) => (
  <AvatarFallbackPrimitive
    className={cn(
      "bg-muted text-muted-foreground flex size-full items-center justify-center rounded-lg text-sm group-data-[size=sm]/avatar:text-xs",
      className
    )}
    {...props}
  />
);

const AvatarBadge = ({ className, render, ...props }: LayoutProps<"span">) =>
  renderElement(
    "span",
    {
      "data-slot": "avatar-badge",
      className: cn(
        "bg-primary text-primary-foreground ring-background absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-blend-color ring-2 select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      ),
      ...props,
    },
    render
  );

const AvatarGroup = ({ className, render, ...props }: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "avatar-group",
      className: cn(
        "group/avatar-group *:data-[slot=avatar]:ring-background flex -space-x-2 *:data-[slot=avatar]:ring-2",
        className
      ),
      ...props,
    },
    render
  );

const AvatarGroupCount = ({
  className,
  render,
  ...props
}: LayoutProps<"div">) =>
  renderElement(
    "div",
    {
      "data-slot": "avatar-group-count",
      className: cn(
        "bg-muted text-muted-foreground ring-background relative flex size-8 shrink-0 items-center justify-center rounded-full text-xs/relaxed ring-2 group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      ),
      ...props,
    },
    render
  );

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
};
