import { UserRoundIcon } from "lucide-react";

import appleIcon from "@/assets/providers/apple.svg";
import gmailIcon from "@/assets/providers/gmail.svg";
import outlookIcon from "@/assets/providers/outlook.svg";
import { cn } from "@/lib/utils";
import type { AccountProvider } from "@/shared/ipc/accounts";

// Logos from svgl.app. They render as images rather than inline SVG so the
// Outlook logo's gradient ids stay private to each copy: inline, the rows
// would share one set of ids and lose their gradients whenever the first
// copy is hidden.
const PROVIDER_ICONS = {
  gmail: gmailIcon,
  icloud: appleIcon,
  outlook: outlookIcon,
} as const satisfies Record<Exclude<AccountProvider, "imap">, string>;

/**
 * The logo of the service an account is on, or a person for any other
 * server. Decorative: the account's address always names it beside the icon.
 */
const AccountProviderIcon = ({
  className,
  provider,
}: {
  readonly className?: string;
  readonly provider: AccountProvider;
}) => {
  if (provider === "imap") {
    return <UserRoundIcon aria-hidden="true" className={className} />;
  }
  return (
    <img
      alt=""
      className={cn(
        "shrink-0 object-contain",
        // Apple's logo is solid black, so it turns white on dark surfaces.
        provider === "icloud" && "dark:invert",
        className
      )}
      draggable={false}
      src={PROVIDER_ICONS[provider]}
    />
  );
};

export default AccountProviderIcon;
