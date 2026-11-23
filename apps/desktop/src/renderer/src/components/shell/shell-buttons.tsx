import {
  ArrowLeftIcon,
  ArrowRightIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SquarePenIcon,
} from "lucide-react";
import type { ReactNode, Ref } from "react";

import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";

import type { ShellHistoryNavigation } from "./use-shell-history";

const HistoryButton = ({
  canGo,
  children,
  command,
  onGo,
}: {
  readonly canGo: boolean;
  readonly children: ReactNode;
  readonly command: "app.navigateBack" | "app.navigateForward";
  readonly onGo: () => void;
}) => {
  const display = getHotkeyDisplay(command);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel(command)}
            aria-label={display.label}
            className="text-muted-foreground hover:text-foreground"
            disabled={!canGo}
            focusableWhenDisabled
            onClick={onGo}
            size="icon"
            type="button"
            variant="ghost"
          >
            {children}
          </Button>
        }
      />
      <TooltipContent className="flex items-center gap-2" side="bottom">
        {display.label}
        <HotkeyHint command={command} />
      </TooltipContent>
    </Tooltip>
  );
};

/** Go back and Go forward between the sidebar places visited. */
export const HistoryButtons = ({
  history: { canGoBack, canGoForward, goBack, goForward },
}: {
  readonly history: ShellHistoryNavigation;
}) => (
  <>
    <HistoryButton canGo={canGoBack} command="app.navigateBack" onGo={goBack}>
      <ArrowLeftIcon className="size-4 stroke-[1.8]" />
    </HistoryButton>
    <HistoryButton
      canGo={canGoForward}
      command="app.navigateForward"
      onGo={goForward}
    >
      <ArrowRightIcon className="size-4 stroke-[1.8]" />
    </HistoryButton>
  </>
);

/**
 * Its label names what it will do, which already tells assistive technology
 * the sidebar's state; `aria-expanded` would also give the ghost button the
 * filled look of an open menu.
 */
export const SidebarToggleButton = ({
  buttonRef,
  isSidebarOpen,
  onToggle,
}: {
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly isSidebarOpen: boolean;
  readonly onToggle: () => void;
}) => {
  const label = isSidebarOpen ? "Hide sidebar" : "Show sidebar";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel("app.toggleSidebar")}
            aria-label={label}
            className="text-muted-foreground hover:text-foreground"
            onClick={onToggle}
            ref={buttonRef}
            size="icon"
            type="button"
            variant="ghost"
          >
            {isSidebarOpen ? (
              <PanelLeftCloseIcon className="size-4 stroke-[1.8]" />
            ) : (
              <PanelLeftOpenIcon className="size-4 stroke-[1.8]" />
            )}
          </Button>
        }
      />
      <TooltipContent className="flex items-center gap-2" side="bottom">
        {label}
        <HotkeyHint command="app.toggleSidebar" />
      </TooltipContent>
    </Tooltip>
  );
};

/**
 * Opens the new-email page, or leaves it, as Settings and Templates do for
 * theirs. In the sidebar it is a quiet icon beside search, like the row's
 * other actions, pressed while its page is open; with the sidebar hidden,
 * the titlebar shows it filled so composing stays the most visible action on
 * screen.
 */
export const NewMessageButton = ({
  canOpen,
  isOpen,
  onToggle,
  placement,
}: {
  readonly canOpen: boolean;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly placement: "sidebar" | "titlebar";
}) => {
  const display = getHotkeyDisplay("app.composeMessage");
  const isInSidebar = placement === "sidebar";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-keyshortcuts={getHotkeyAriaLabel("app.composeMessage")}
            aria-label={display.label}
            className={
              isInSidebar
                ? "not-data-pressed:text-muted-foreground not-data-pressed:hover:text-foreground"
                : undefined
            }
            disabled={!canOpen}
            focusableWhenDisabled
            onPressedChange={onToggle}
            pressed={isOpen}
            size={isInSidebar ? "icon-lg" : "icon"}
            variant={isInSidebar ? "ghost" : "default"}
          >
            <SquarePenIcon className="size-4 stroke-[1.8]" />
          </Toggle>
        }
      />
      <TooltipContent className="flex items-center gap-2" side="bottom">
        {display.label}
        <HotkeyHint command="app.composeMessage" />
      </TooltipContent>
    </Tooltip>
  );
};
