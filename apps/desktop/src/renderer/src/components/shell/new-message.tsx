import { useHotkeys } from "@tanstack/react-hotkeys";
import { SquarePenIcon } from "lucide-react";
import { useState } from "react";

import NewMessageDialog from "@/components/mail/new-message-dialog";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getMailApi } from "@/platform/desktop";
import {
  getNewMessageShortcutKeys,
  NEW_MESSAGE_SHORTCUT,
} from "@/shell/titlebar-shortcuts";
import { useGoogleAccounts } from "@/state/google-accounts";
import { useSelectedAccountId } from "@/state/mailbox";

const TitlebarNewMessage = () => {
  const accounts = useGoogleAccounts();
  const selectedAccountId = useSelectedAccountId();
  const [composerKey, setComposerKey] = useState(0);
  const [initialAccountId, setInitialAccountId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const canOpen = getMailApi() !== undefined && accounts.length > 0;
  const shortcutKeys = getNewMessageShortcutKeys();

  const openComposer = (): void => {
    if (!canOpen || isOpen) {
      return;
    }

    setInitialAccountId(selectedAccountId);
    setComposerKey((current) => current + 1);
    setIsOpen(true);
  };

  useHotkeys(
    canOpen
      ? [
          {
            callback: openComposer,
            hotkey: NEW_MESSAGE_SHORTCUT,
            options: { preventDefault: true },
          },
        ]
      : []
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-keyshortcuts={NEW_MESSAGE_SHORTCUT}
              aria-label="New email"
              className="app-titlebar-interactive"
              disabled={!canOpen}
              onClick={openComposer}
              size="icon"
              type="button"
            >
              <SquarePenIcon className="size-4 stroke-[1.8]" />
            </Button>
          }
        />
        <TooltipContent className="flex items-center gap-2" side="bottom">
          New email
          <KbdGroup>
            {shortcutKeys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        </TooltipContent>
      </Tooltip>
      <NewMessageDialog
        accounts={accounts}
        initialAccountId={initialAccountId}
        isOpen={isOpen}
        key={composerKey}
        onOpenChange={setIsOpen}
      />
    </>
  );
};

export default TitlebarNewMessage;
