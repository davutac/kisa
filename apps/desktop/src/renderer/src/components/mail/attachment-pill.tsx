import { DownloadIcon, EyeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getAttachmentTypeLabel } from "@/shared/attachments";
import type { GmailAttachmentSummary } from "@/shared/ipc/mail";

interface MailAttachmentPillProps {
  action: "download" | "preview";
  attachment: GmailAttachmentSummary;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

const PILL_CLASS =
  "bg-muted text-muted-foreground max-w-56 [&>svg]:size-2.5! [&>svg]:shrink-0";

const MailAttachmentPill = ({
  action,
  attachment,
  disabled,
  loading,
  onClick,
}: MailAttachmentPillProps) => {
  const typeLabel = getAttachmentTypeLabel(
    attachment.filename,
    attachment.mediaType
  );
  const label = `${action === "preview" ? "Preview" : "Download"} ${attachment.filename} (${typeLabel})`;
  const Icon = action === "preview" ? EyeIcon : DownloadIcon;

  return (
    <Button
      aria-label={label}
      className={`${PILL_CLASS} pointer-events-auto`}
      disabled={disabled || loading}
      onClick={onClick}
      size="sm"
      title={label}
      type="button"
      variant="secondary"
    >
      {loading === true ? (
        <Spinner aria-hidden="true" data-icon="inline-start" />
      ) : (
        <Icon aria-hidden="true" data-icon="inline-start" />
      )}
      <span className="min-w-0 truncate">{attachment.filename}</span>
      <span
        aria-hidden="true"
        className="border-border/80 text-foreground/50 shrink-0 border-l pl-2 text-[0.625rem] font-semibold tracking-wide"
      >
        {typeLabel}
      </span>
    </Button>
  );
};

export default MailAttachmentPill;
