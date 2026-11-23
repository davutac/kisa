import { m, useReducedMotionConfig } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, Ref, RefObject } from "react";
import { flushSync } from "react-dom";

import { easeInOut, NO_MOTION } from "@/lib/motion";
import { Splitter } from "@/primitives/splitter";

import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  readSidebarWidth,
  writeSidebarWidth,
} from "./sidebar-preferences";

const KEYBOARD_STEP = 16;

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
  // Only showing and hiding ease; every other width change snaps, because
  // the panel inside takes its new width at once. A toggle marks the aside
  // as easing until that animation completes, so a re-render partway
  // through, or a quick second toggle, still eases.
  const [openMotion, setOpenMotion] = useState({ isEasing: false, isOpen });
  if (openMotion.isOpen !== isOpen) {
    setOpenMotion({ isEasing: true, isOpen });
  }
  const panelRef = useRef<HTMLDivElement>(null);

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
  // inset changed; flushed so the splitter's handler, which runs next, sees it.
  const remeasure = (): number => {
    const measured = measureMinWidth(
      panelRef.current,
      minWidthAnchorRef.current
    );
    if (measured !== minWidth) {
      flushSync(() => setMinWidth(measured));
    }
    return measured;
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
          <Splitter
            aria-label="Resize sidebar"
            className="app-titlebar-interactive after:bg-sidebar-ring absolute inset-y-0 -left-1 w-[7px] cursor-col-resize touch-none outline-none after:pointer-events-none after:absolute after:inset-y-0 after:left-0.5 after:w-0.5 after:opacity-0 after:transition-opacity hover:after:opacity-100 hover:after:delay-150 focus-visible:after:opacity-100 data-dragging:after:opacity-100 data-dragging:after:delay-0"
            max={MAX_SIDEBAR_WIDTH}
            min={minWidth}
            onDoubleClick={() => {
              const next = clampSidebarWidth(
                DEFAULT_SIDEBAR_WIDTH,
                remeasure()
              );
              setWidth(next);
              writeSidebarWidth(next);
            }}
            onKeyDown={remeasure}
            onPointerDown={remeasure}
            onValueChange={setWidth}
            onValueCommit={writeSidebarWidth}
            step={KEYBOARD_STEP}
            value={width}
          />
        </div>
      ) : null}
    </>
  );
};

export default SidebarFrame;
