import { PlusIcon } from "lucide-react";

import { openAccountSetup } from "@/components/accounts/open-account-setup";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getRuntimeCapabilities } from "@/platform/desktop";

/**
 * Opens the Add account window from the trailing end of the sidebar footer,
 * after any update button, styled like the workspace buttons beside it.
 * Absent where the runtime has no account capability, such as the web
 * fallback.
 */
const SidebarAddAccountButton = () => {
  const { accounts } = getRuntimeCapabilities();

  if (accounts === undefined) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Add account"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              void openAccountSetup();
            }}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <PlusIcon className="stroke-[1.8]" />
          </Button>
        }
      />
      <TooltipContent side="top">Add account</TooltipContent>
    </Tooltip>
  );
};

export default SidebarAddAccountButton;
