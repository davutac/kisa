import {
  AlertDialogBackdrop as AlertDialogBackdropPrimitive,
  AlertDialogClose as AlertDialogClosePrimitive,
  AlertDialogContent as AlertDialogContentPrimitive,
  AlertDialogDescription as AlertDialogDescriptionPrimitive,
  AlertDialogTitle as AlertDialogTitlePrimitive,
} from "@ui-sdk/react/alert-dialog";

import { Button } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";
import { dialogFooterClassName } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export {
  AlertDialog,
  AlertDialogTrigger,
  createConfirm,
} from "@ui-sdk/react/alert-dialog";

export type { AlertDialogController } from "@ui-sdk/react/alert-dialog";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

const AlertDialogBackdrop = ({
  className,
  ...props
}: ClassNameProps<
  React.ComponentProps<typeof AlertDialogBackdropPrimitive>
>) => (
  <AlertDialogBackdropPrimitive
    className={cn(
      "fixed inset-0 isolate bg-black/80 transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
      className
    )}
    {...props}
  />
);

const AlertDialogContent = <Payload = unknown,>({
  className,
  ...props
}: ClassNameProps<
  React.ComponentProps<typeof AlertDialogContentPrimitive<Payload>>
>) => (
  <>
    <AlertDialogBackdrop />
    <AlertDialogContentPrimitive<Payload>
      className={cn(
        "bg-popover text-popover-foreground ring-foreground/10 fixed top-1/2 left-1/2 grid w-full max-w-xs -translate-x-1/2 -translate-y-1/2 gap-3 rounded-xl p-4 ring-1 transition-[opacity,scale] duration-100 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 sm:max-w-sm",
        className
      )}
      {...props}
    />
  </>
);

const AlertDialogHeader = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("grid gap-1", className)} {...props} />
);

const AlertDialogFooter = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn(dialogFooterClassName, className)} {...props} />
);

const AlertDialogTitle = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof AlertDialogTitlePrimitive>>) => (
  <AlertDialogTitlePrimitive
    className={cn("font-heading text-sm font-medium", className)}
    {...props}
  />
);

const AlertDialogDescription = ({
  className,
  ...props
}: ClassNameProps<
  React.ComponentProps<typeof AlertDialogDescriptionPrimitive>
>) => (
  <AlertDialogDescriptionPrimitive
    className={cn(
      "text-muted-foreground *:[a]:hover:text-foreground text-xs/relaxed text-balance md:text-pretty *:[a]:underline *:[a]:underline-offset-3",
      className
    )}
    {...props}
  />
);

const AlertDialogClose = ({
  className,
  size = "default",
  variant = "secondary",
  ...props
}: ClassNameProps<React.ComponentProps<typeof AlertDialogClosePrimitive>> &
  Pick<ButtonProps, "size" | "variant">) => (
  <AlertDialogClosePrimitive
    render={<Button className={className} size={size} variant={variant} />}
    {...props}
  />
);

export {
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
};
