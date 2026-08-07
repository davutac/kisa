import { useHotkeys } from "@tanstack/react-hotkeys";
import { SearchIcon } from "lucide-react";
import { useState } from "react";

import MailSearchDialog from "@/components/mail/mail-search-dialog";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  getSearchShortcutKeys,
  SEARCH_SHORTCUT,
} from "@/shell/titlebar-shortcuts";

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
  const shortcutKeys = getSearchShortcutKeys();

  useHotkeys([
    {
      callback: () => {
        setIsOpen(true);
      },
      hotkey: SEARCH_SHORTCUT,
      options: { preventDefault: true },
    },
  ]);

  return (
    <>
      <Button
        aria-keyshortcuts={SEARCH_SHORTCUT}
        aria-label="Search mail"
        className="app-titlebar-interactive"
        onClick={() => {
          setIsOpen(true);
        }}
        type="button"
        variant="secondary"
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span>Search</span>
        <KbdGroup>
          {shortcutKeys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
      </Button>
      <MailSearchDialog isOpen={isOpen} onOpenChange={setIsOpen} />
    </>
  );
};

export default TitlebarMailSearch;
