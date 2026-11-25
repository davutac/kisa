import {
  Command as CommandPrimitive,
  CommandEmpty as CommandEmptyPrimitive,
  CommandGroup as CommandGroupPrimitive,
  CommandGroupLabel as CommandGroupLabelPrimitive,
  CommandInput as CommandInputPrimitive,
  CommandItem as CommandItemPrimitive,
  CommandList as CommandListPrimitive,
} from "@ui-sdk/react/command";
import { renderElement } from "@ui-sdk/react/primitive";
import type { RenderProp } from "@ui-sdk/react/primitive";
import { SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

// Arrow keys stop at the ends of Kisa's lists, as they do in the mailbox.
const Command = ({
  className,
  loop = false,
  ...props
}: ClassNameProps<React.ComponentProps<typeof CommandPrimitive>>) => (
  <CommandPrimitive
    className={cn(
      "bg-popover text-popover-foreground flex size-full flex-col overflow-hidden rounded-xl p-1",
      className
    )}
    loop={loop}
    {...props}
  />
);

// ui-sdk's Command clears the search on a first Escape. With `onEscape`, the
// first Escape runs it instead, so a picker or bar closes at once.
const CommandInput = ({
  className,
  onEscape,
  onKeyDown,
  ...props
}: ClassNameProps<React.ComponentProps<typeof CommandInputPrimitive>> & {
  onEscape?: () => void;
}) => (
  <CommandInputPrimitive
    className={cn(
      "w-full min-w-0 flex-1 bg-transparent text-xs/relaxed outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    onKeyDown={(event) => {
      onKeyDown?.(event);

      if (
        onEscape !== undefined &&
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        onEscape();
      }
    }}
    {...props}
  />
);

const CommandSearch = ({
  className,
  children,
  render,
  ...props
}: React.ComponentProps<"div"> & { render?: RenderProp }) =>
  renderElement(
    "div",
    {
      "data-slot": "command-search",
      className: cn(
        "bg-input/20 dark:bg-input/30 mx-1 mt-1 flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2",
        className
      ),
      children: (
        <>
          <SearchIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 opacity-50"
          />
          {children}
        </>
      ),
      ...props,
    },
    render
  );

const CommandList = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof CommandListPrimitive>>) => (
  <CommandListPrimitive
    className={cn(
      "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
      className
    )}
    {...props}
  />
);

const CommandEmpty = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof CommandEmptyPrimitive>>) => (
  <CommandEmptyPrimitive
    className={cn("text-center text-xs/relaxed data-empty:py-6", className)}
    {...props}
  />
);

const CommandGroup = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof CommandGroupPrimitive>>) => (
  <CommandGroupPrimitive
    className={cn("text-foreground overflow-hidden p-1", className)}
    {...props}
  />
);

const CommandGroupLabel = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof CommandGroupLabelPrimitive>>) => (
  <CommandGroupLabelPrimitive
    className={cn(
      "text-muted-foreground px-2.5 py-1.5 text-xs font-medium",
      className
    )}
    {...props}
  />
);

const CommandItem = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof CommandItemPrimitive>>) => (
  <CommandItemPrimitive
    className={cn(
      "group/command-item data-highlighted:bg-muted data-highlighted:text-foreground data-highlighted:*:[svg]:text-foreground relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-xs/relaxed outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
      className
    )}
    {...props}
  />
);

export { createCommandController } from "@ui-sdk/react/command";

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSearch,
};
