import AccountProviderIcon from "@/components/accounts/account-provider-icon";
import { cn } from "@/lib/utils";
import { useAccount } from "@/state/accounts";

/**
 * Names the account a conversation belongs to, where a list mixes accounts:
 * its provider's logo, as the sidebar shows it, beside its address. An
 * account no longer connected keeps a person icon.
 */
const AccountChip = ({
  accountId,
  className,
}: {
  readonly accountId: string;
  readonly className?: string;
}) => {
  const account = useAccount(accountId);

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <AccountProviderIcon
        className="size-3"
        provider={account?.provider ?? "imap"}
      />
      <span className="min-w-0 truncate">{accountId}</span>
    </span>
  );
};

export default AccountChip;
