import type { Ref } from "react";

import TitlebarIndexButton from "@/components/mail/titlebar-index-button";

import {
  HistoryButtons,
  NewMessageButton,
  SidebarToggleButton,
} from "./shell-buttons";
import type { ShellHistoryNavigation } from "./use-shell-history";
import { WindowTitlebar } from "./window-titlebar";

interface TitlebarProps {
  readonly canCompose: boolean;
  readonly history: ShellHistoryNavigation;
  /** Whether the new-email page is on screen, which New email shows. */
  readonly isComposing: boolean;
  readonly isSidebarOpen: boolean;
  /** Opens the composer, or leaves it when it is already open. */
  readonly onToggleComposer: () => void;
  readonly onToggleSidebar: () => void;
  readonly sidebarToggleRef: Ref<HTMLButtonElement>;
  /** Receives the element a view fills through `TitlebarSlot`. */
  readonly slotRef: Ref<HTMLDivElement>;
}

/**
 * The content column's titlebar. The current view may put its own toolbar
 * in the middle through `TitlebarSlot`. Indexing progress lives here rather
 * than in the sidebar so collapsing the sidebar never hides it. With the
 * sidebar hidden, its toggle, Go back and Go forward, and New email move here.
 */
const Titlebar = ({
  canCompose,
  history,
  isComposing,
  isSidebarOpen,
  onToggleComposer,
  onToggleSidebar,
  sidebarToggleRef,
  slotRef,
}: TitlebarProps) => (
  <WindowTitlebar
    className="bg-background relative z-30 flex shrink-0 items-center gap-2"
    controls={isSidebarOpen ? "trailing" : "both"}
  >
    {isSidebarOpen ? null : (
      <div className="app-titlebar-interactive flex shrink-0 items-center gap-1">
        <SidebarToggleButton
          buttonRef={sidebarToggleRef}
          isSidebarOpen={false}
          onToggle={onToggleSidebar}
        />
        <HistoryButtons history={history} />
        <NewMessageButton
          canOpen={canCompose}
          isOpen={isComposing}
          onToggle={onToggleComposer}
          placement="titlebar"
        />
      </div>
    )}
    {/* The slot stays draggable; controls in it opt out themselves. */}
    <div className="flex min-w-0 flex-1 items-center" ref={slotRef} />
    <div className="app-titlebar-interactive flex shrink-0 items-center gap-1">
      <TitlebarIndexButton />
    </div>
  </WindowTitlebar>
);

export default Titlebar;
