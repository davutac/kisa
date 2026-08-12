import { SearchIcon } from "lucide-react";
import { useState } from "react";

import MailSearchDialog from "@/components/mail/mail-search-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  useAppCommand,
  useHotkeyLayer,
} from "@/hotkeys";

/**
 * The titlebar's search affordance. It is a button rather than a field: search
 * runs against the local mail index in a palette over the window, where the
 * results and the `from:` completions have room to be shown.
 *
 * The mailbox list underneath is always the cached inbox — there is no filter
 * to mirror here, so the button says one thing and does one thing.
 */
const TitlebarMailSearch = () => {
  const [isOpen, setIsOpen] = useState(false);
  const display = getHotkeyDisplay("app.searchMail");

  useHotkeyLayer("search", isOpen);
  useAppCommand("app.searchMail", () => {
    setIsOpen(true);
  });

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-keyshortcuts={getHotkeyAriaLabel("app.searchMail")}
              aria-label={display.label}
              className="app-titlebar-interactive"
              onClick={() => {
                setIsOpen(true);
              }}
              size="icon"
              type="button"
              variant="secondary"
            >
              <SearchIcon />
            </Button>
          }
        />
        <TooltipContent className="flex items-center gap-2" side="bottom">
          {display.label}
          <HotkeyHint command="app.searchMail" />
        </TooltipContent>
      </Tooltip>
      <MailSearchDialog isOpen={isOpen} onOpenChange={setIsOpen} />
    </>
  );
};

export default TitlebarMailSearch;
