import {
  DialogBackdrop,
  DialogClose,
  DialogContent as DialogContentPrimitive,
  DialogDescription as DialogDescriptionPrimitive,
  DialogTitle as DialogTitlePrimitive,
} from "@ui-sdk/react/dialog";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export {
  createDialogController,
  Dialog,
  DialogClose,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
export type { DialogController } from "@ui-sdk/react/dialog";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

const DialogOverlay = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof DialogBackdrop>>) => (
  <DialogBackdrop
    className={cn(
      "fixed inset-0 isolate bg-black/80 transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
      className
    )}
    {...props}
  />
);

const DialogContent = ({
  className,
  children,
  showCloseButton = true,
  ...props
}: Omit<
  ClassNameProps<React.ComponentProps<typeof DialogContentPrimitive>>,
  "children"
> & {
  children?: React.ReactNode;
  showCloseButton?: boolean;
}) => (
  <>
    <DialogOverlay />
    <DialogContentPrimitive
      className={cn(
        "bg-popover text-popover-foreground ring-foreground/10 fixed top-1/2 left-1/2 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl p-4 text-xs/relaxed ring-1 transition-[opacity,scale] duration-100 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 sm:max-w-sm",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClose
          aria-label="Close"
          render={
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            />
          }
        >
          <XIcon aria-hidden="true" />
        </DialogClose>
      )}
    </DialogContentPrimitive>
  </>
);

const DialogHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div className={cn("flex flex-col gap-1", className)} {...props} />
);

const DialogFooter = ({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className
    )}
    {...props}
  >
    {children}
    {showCloseButton && (
      <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
    )}
  </div>
);

const DialogTitle = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof DialogTitlePrimitive>>) => (
  <DialogTitlePrimitive
    className={cn("font-heading text-sm font-medium", className)}
    {...props}
  />
);

const DialogDescription = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof DialogDescriptionPrimitive>>) => (
  <DialogDescriptionPrimitive
    className={cn(
      "text-muted-foreground *:[a]:hover:text-foreground text-xs/relaxed *:[a]:underline *:[a]:underline-offset-3",
      className
    )}
    {...props}
  />
);

export {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
};
