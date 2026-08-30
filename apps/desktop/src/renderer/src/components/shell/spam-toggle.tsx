import { ShieldAlertIcon } from "lucide-react";

import TitlebarMailboxToggle from "@/components/shell/mailbox-toggle";
import { useMailboxAccountScope } from "@/mail/use-mailbox-account-scope";
import { useHasUnreadSpam } from "@/mail/use-spam-status";

const TitlebarSpamToggle = () => {
  const { accountIds } = useMailboxAccountScope();
  const hasUnreadSpam = useHasUnreadSpam(accountIds);

  return (
    <TitlebarMailboxToggle
      ariaLabel={hasUnreadSpam ? "Spam, unread messages" : "Spam"}
      className="relative"
      command="app.toggleSpam"
      mailbox="spam"
    >
      <ShieldAlertIcon />
      {hasUnreadSpam ? (
        <span
          aria-hidden="true"
          className="bg-destructive absolute top-1.5 right-1.5 size-1.5 rounded-full"
        />
      ) : null}
    </TitlebarMailboxToggle>
  );
};

export default TitlebarSpamToggle;
