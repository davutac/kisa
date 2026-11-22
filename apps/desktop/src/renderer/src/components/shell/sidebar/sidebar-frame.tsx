import { m, useReducedMotionConfig } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type {
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";

import { easeInOut, NO_MOTION } from "@/lib/motion";

import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  readSidebarWidth,
  writeSidebarWidth,
} from "./sidebar-preferences";

const KEYBOARD_STEP = 16;

/**
 * The width a key on the resize handle asks for, or `undefined` for a key
 * the handle leaves alone.
 */
export const sidebarWidthForKey = (
  key: string,
  width: number,
  minWidth: number
): number | undefined => {
  switch (key) {
    case "ArrowLeft": {
      return clampSidebarWidth(width - KEYBOARD_STEP, minWidth);
    }
    case "ArrowRight": {
      return clampSidebarWidth(width + KEYBOARD_STEP, minWidth);
    }
    case "Home": {
      return clampSidebarWidth(minWidth, minWidth);
    }
    case "End": {
      return MAX_SIDEBAR_WIDTH;
    }
    default: {
      return undefined;
    }
  }
};

/** A computed length in pixels, or 0 when it is not one. */
const pixels = (element: Element, property: string): number => {
  const value = element.computedStyleMap().get(property);
  return value instanceof CSSUnitValue && value.unit === "px" ? value.value : 0;
};

/**
 * The narrowest the panel can be with `anchor`, the last control of its
 * titlebar strip, still inside it: the anchor's trailing edge from the
 * panel's leading edge, plus the strip's trailing padding and the panel's
 * border. The strip's items do not shrink, so this holds at any current
 * width, and it follows the window-controls inset, which differs by
 * platform.
 */
const measureMinWidth = (
  panel: HTMLElement | null,
  anchor: HTMLElement | null
): number => {
  if (panel === null || anchor === null) {
    return MIN_SIDEBAR_WIDTH;
  }
  const strip = anchor.parentElement;
  const trailingPadding = strip === null ? 0 : pixels(strip, "padding-right");
  const border = pixels(panel, "border-right-width");
  const edge =
    anchor.getBoundingClientRect().right - panel.getBoundingClientRect().left;
  return clampSidebarWidth(Math.ceil(edge + trailingPadding + border));
};

interface Drag {
  readonly minWidth: number;
  readonly pointerId: number;
  readonly startWidth: number;
  readonly startX: number;
  /** Kept here, not read from state, so the release stores the last move. */
  width: number;
}

interface SidebarFrameProps {
  readonly children: ReactNode;
  readonly isHotkeyHintsRevealed: boolean;
  readonly isOpen: boolean;
  /** The last control of the titlebar strip, which sets the minimum width. */
  readonly minWidthAnchorRef: RefObject<HTMLElement | null>;
  readonly sidebarRef: Ref<HTMLElement>;
}

/**
 * The sidebar's box and its resize handle. It owns the width so a drag
 * re-renders only this frame: the rows arrive as `children` created by the
 * parent, which a drag does not re-render, so React skips them. Opening and
 * closing animate; resizing follows the pointer without easing. The width is
 * remembered on release, and never goes below what the titlebar strip needs
 * to show the app name in full. The handle is a zero-width sibling after the
 * aside, so its hit strip straddles the border without the aside's clipping,
 * and it is not rendered while the sidebar is hidden.
 */
const SidebarFrame = ({
  children,
  isHotkeyHintsRevealed,
  isOpen,
  minWidthAnchorRef,
  sidebarRef,
}: SidebarFrameProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const [width, setWidth] = useState(readSidebarWidth);
  const [minWidth, setMinWidth] = useState(MIN_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  // Only showing and hiding ease; every other width change snaps, because
  // the panel inside takes its new width at once. A toggle marks the aside
  // as easing until that animation completes, so a re-render partway
  // through, or a quick second toggle, still eases.
  const [openMotion, setOpenMotion] = useState({ isEasing: false, isOpen });
  if (openMotion.isOpen !== isOpen) {
    setOpenMotion({ isEasing: true, isOpen });
  }
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  // Measured before paint, so a remembered width narrower than this
  // platform's strip never shows a truncated name.
  useLayoutEffect(() => {
    const measured = measureMinWidth(
      panelRef.current,
      minWidthAnchorRef.current
    );
    setMinWidth(measured);
    setWidth((current) => clampSidebarWidth(current, measured));
  }, [minWidthAnchorRef]);

  // Every resize starts from a fresh measurement, in case the window-controls
  // inset changed since the last one.
  const remeasure = (): number => {
    const measured = measureMinWidth(
      panelRef.current,
      minWidthAnchorRef.current
    );
    setMinWidth(measured);
    return measured;
  };

  const commitWidth = (nextWidth: number): void => {
    setWidth(nextWidth);
    writeSidebarWidth(nextWidth);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    // Capture keeps the drag alive over a message's iframe, which would
    // otherwise swallow the moves.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      minWidth: remeasure(),
      pointerId: event.pointerId,
      startWidth: width,
      startX: event.clientX,
      width,
    };
    setIsResizing(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    drag.width = clampSidebarWidth(
      drag.startWidth + event.clientX - drag.startX,
      drag.minWidth
    );
    setWidth(drag.width);
  };

  // `pointerup`, `pointercancel`, and a lost capture all end the drag; only
  // the first of them for a drag stores the width.
  const endDrag = (): void => {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }
    dragRef.current = null;
    setIsResizing(false);
    writeSidebarWidth(drag.width);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const nextWidth = sidebarWidthForKey(event.key, width, remeasure());
    if (nextWidth === undefined) {
      return;
    }
    // Home and End would otherwise scroll; no application command uses
    // these keys.
    event.preventDefault();
    commitWidth(nextWidth);
  };

  return (
    <>
      <m.aside
        animate={{ width: isOpen ? width : 0 }}
        aria-label="Sidebar"
        className="flex h-full shrink-0 justify-end overflow-hidden"
        data-hotkey-hints={isHotkeyHintsRevealed ? "" : undefined}
        inert={!isOpen}
        initial={false}
        onAnimationComplete={() =>
          setOpenMotion((current) => ({ ...current, isEasing: false }))
        }
        ref={sidebarRef}
        transition={
          openMotion.isEasing && !shouldReduceMotion
            ? easeInOut(0.2)
            : NO_MOTION
        }
      >
        <div
          className="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full shrink-0 flex-col border-r"
          ref={panelRef}
          style={{ width }}
        >
          {children}
        </div>
      </m.aside>
      {isOpen ? (
        <div className="relative z-10 w-0 shrink-0">
          {/* The ring it lights up lies over the sidebar's border, so the
              line that shows is the edge being dragged. */}
          <div
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            aria-valuemin={minWidth}
            aria-valuenow={width}
            className="app-titlebar-interactive after:bg-sidebar-ring absolute inset-y-0 -left-1 w-[7px] cursor-col-resize outline-none after:pointer-events-none after:absolute after:inset-y-0 after:left-0.5 after:w-0.5 after:opacity-0 after:transition-opacity hover:after:opacity-100 hover:after:delay-150 focus-visible:after:opacity-100 data-resizing:after:opacity-100 data-resizing:after:delay-0"
            data-resizing={isResizing ? "" : undefined}
            onDoubleClick={() =>
              commitWidth(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, remeasure()))
            }
            onKeyDown={handleKeyDown}
            onLostPointerCapture={endDrag}
            onPointerCancel={endDrag}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A focusable separator is a widget that takes its value from the keyboard, which an `hr` cannot be.
            role="separator"
            tabIndex={0}
          />
        </div>
      ) : null}
    </>
  );
};

export default SidebarFrame;
