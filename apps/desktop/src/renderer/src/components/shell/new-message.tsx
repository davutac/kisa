import { SquarePenIcon } from "lucide-react";
import { useState } from "react";

import NewMessageDialog from "@/components/mail/new-message-dialog";
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
import { getMailApi } from "@/platform/desktop";
import { useGoogleAccounts } from "@/state/google-accounts";
import { useSelectedAccountId } from "@/state/mailbox";

const TitlebarNewMessage = () => {
  const accounts = useGoogleAccounts();
  const selectedAccountId = useSelectedAccountId();
  const [composerKey, setComposerKey] = useState(0);
  const [initialAccountId, setInitialAccountId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const canOpen = getMailApi() !== undefined && accounts.length > 0;
  const display = getHotkeyDisplay("app.composeMessage");

  const openComposer = (): void => {
    if (!canOpen || isOpen) {
      return;
    }

    setInitialAccountId(selectedAccountId);
    setComposerKey((current) => current + 1);
    setIsOpen(true);
  };

  useHotkeyLayer("composer", isOpen);
  useAppCommand("app.composeMessage", openComposer, { enabled: canOpen });

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-keyshortcuts={getHotkeyAriaLabel("app.composeMessage")}
              aria-label={display.label}
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
          {display.label}
          <HotkeyHint command="app.composeMessage" />
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
