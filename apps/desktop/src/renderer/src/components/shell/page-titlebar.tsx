import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { TitlebarSlot } from "./titlebar-slot";

interface PageTitlebarProps {
  /** The page's own actions, on the trailing side of the titlebar. */
  readonly children?: ReactNode;
  /** Overrides the title's leading inset to line it up with the page. */
  readonly className?: string;
  readonly title: ReactNode;
  /** Lets the page's landmark name itself after the title. */
  readonly titleId?: string;
}

/** The layout `PageTitlebar` places in the titlebar. */
export const PageTitlebarContent = ({
  children,
  className,
  title,
  titleId,
}: PageTitlebarProps) => (
  <div
    className={cn(
      "flex min-w-0 flex-1 items-center justify-between gap-3 pl-4",
      className
    )}
  >
    {/* The title stays outside the interactive group, so it drags the window
        like the rest of the strip. */}
    <h1
      className="font-heading min-w-0 truncate text-[13px] font-medium select-none"
      id={titleId}
    >
      {title}
    </h1>
    {children === undefined ? null : (
      <div className="app-titlebar-interactive flex shrink-0 items-center gap-1">
        {children}
      </div>
    )}
  </div>
);

/**
 * A page's title and actions in the main window's content titlebar, between
 * the shell's own buttons and status, so the page itself starts with its
 * content. Outside the main window there is no titlebar to fill and nothing
 * renders.
 */
export const PageTitlebar = (props: PageTitlebarProps) => (
  <TitlebarSlot>
    <PageTitlebarContent {...props} />
  </TitlebarSlot>
);
