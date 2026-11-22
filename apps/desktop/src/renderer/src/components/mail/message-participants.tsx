import MailCopyEmailButton from "@/components/mail/copy-email-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { extractEmailAddresses, parseMailboxAddress } from "@/mail/address";
import type { ThreadMessage } from "@/shared/ipc/mail";
import { useAccounts } from "@/state/accounts";

interface MailMessageParticipantsProps {
  className?: string;
  fallbackRecipient: string;
  message: ThreadMessage;
}

interface ParticipantRowProps {
  emails: readonly string[];
  label: string;
}

const ParticipantRow = ({ emails, label }: ParticipantRowProps) => (
  <div className="flex min-w-0 items-baseline gap-2">
    <dt className="text-muted-foreground shrink-0">{label}</dt>
    <dd
      className="text-muted-foreground -ml-1 flex min-w-0 truncate px-1"
      title={emails.join(", ")}
    >
      {emails.map((email, index) => (
        <span className="flex min-w-0" key={`${email}:${index}`}>
          {index === 0 ? null : <span aria-hidden="true">,&nbsp;</span>}
          <MailCopyEmailButton email={email} />
        </span>
      ))}
    </dd>
  </div>
);

const MailMessageParticipants = ({
  className,
  fallbackRecipient,
  message,
}: MailMessageParticipantsProps) => {
  const accounts = useAccounts();
  const senderMailbox = parseMailboxAddress(message.from);
  const senderEmail = senderMailbox.email;
  const recipientEmails = extractEmailAddresses(message.to);
  const recipients =
    recipientEmails.length === 0 ? [fallbackRecipient] : recipientEmails;
  const ccEmails = extractEmailAddresses(message.cc);
  const bccEmails = extractEmailAddresses(message.bcc);
  const senderAccount = accounts.find(
    ({ email }) => email.toLowerCase() === senderEmail.toLowerCase()
  );
  const senderImageUrl = message.senderBrand?.imageDataUrl;
  const senderName = senderMailbox.name ?? senderAccount?.displayName;
  const fallbackText =
    (senderName ?? senderEmail).trim().charAt(0).toUpperCase() || "?";
  const senderTitle =
    senderName === undefined ? senderEmail : `${senderName} <${senderEmail}>`;

  return (
    <div className={cn("items-top flex min-w-0 gap-3", className)}>
      <Avatar>
        {senderImageUrl === undefined ? null : (
          <AvatarImage alt="" src={senderImageUrl} />
        )}
        <AvatarFallback>{fallbackText}</AvatarFallback>
      </Avatar>
      <dl className="min-w-0 text-sm">
        <div className="flex min-w-0 items-baseline gap-2">
          <dt className="text-muted-foreground shrink-0">From</dt>
          <dd
            className="-ml-1 flex min-w-0 items-baseline gap-2 truncate px-1"
            title={senderTitle}
          >
            {senderName === undefined ? null : (
              <span className="truncate font-medium">{senderName}</span>
            )}
            <MailCopyEmailButton
              className={cn(
                senderName === undefined
                  ? "font-medium"
                  : "text-muted-foreground"
              )}
              email={senderEmail}
            />
          </dd>
        </div>
        <ParticipantRow emails={recipients} label="To" />
        {message.cc === undefined ? null : (
          <ParticipantRow
            emails={ccEmails.length === 0 ? [message.cc] : ccEmails}
            label="Cc"
          />
        )}
        {message.bcc === undefined ? null : (
          <ParticipantRow
            emails={bccEmails.length === 0 ? [message.bcc] : bccEmails}
            label="Bcc"
          />
        )}
      </dl>
    </div>
  );
};

export default MailMessageParticipants;
