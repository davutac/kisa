import MailCopyEmailButton from "@/components/mail/copy-email-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { extractEmailAddresses, parseMailboxAddress } from "@/mail/address";
import type { GmailThreadMessage } from "@/shared/ipc/mail";
import { useGoogleAccounts } from "@/state/google-accounts";

interface MailMessageParticipantsProps {
  className?: string;
  fallbackRecipient: string;
  message: GmailThreadMessage;
}

interface ParticipantRowProps {
  emails: readonly string[];
  label: string;
}

const ParticipantRow = ({ emails, label }: ParticipantRowProps) => (
  <div className="flex min-w-0 items-baseline gap-2">
    <dt className="text-muted-foreground shrink-0">{label}</dt>
    <dd
      className="text-muted-foreground flex min-w-0 truncate"
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
  const accounts = useGoogleAccounts();
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
  const senderImageUrl =
    senderAccount?.avatarUrl ?? message.senderBrand?.imageDataUrl;
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
            className="flex min-w-0 items-baseline gap-1.5 truncate"
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
