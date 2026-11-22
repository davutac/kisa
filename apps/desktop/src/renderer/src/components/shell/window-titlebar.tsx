import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * The window controls a titlebar sits beside. One spanning the window clears
 * both: the macOS traffic lights on the leading side and the Windows and
 * Linux overlay controls on the trailing side. In the main window the
 * sidebar strip clears only the leading side, and the content titlebar
 * beside it only the trailing side.
 */
export type WindowControlsSide = "both" | "leading" | "trailing";

// No ref: the element can be a `div` or a `header`, and no caller needs one.
type WindowTitlebarProps = Omit<ComponentProps<"header">, "ref"> & {
  /** A plain strip rather than the window's banner landmark. */
  readonly as?: "div" | "header";
  readonly controls?: WindowControlsSide;
};

/**
 * A window's titlebar: a draggable strip of the window's titlebar height
 * that keeps whatever it holds between the window controls. Controls inside
 * opt out of dragging with `app-titlebar-interactive`. The insets come from
 * the window-controls overlay through `.app-titlebar` in `main.css`, so
 * they are right on every platform without measuring anything here.
 */
export const WindowTitlebar = ({
  as: Element = "header",
  className,
  controls = "both",
  ...props
}: WindowTitlebarProps) => (
  <Element
    className={cn("app-titlebar", className)}
    data-titlebar-inset={controls === "both" ? undefined : controls}
    {...props}
  />
);
