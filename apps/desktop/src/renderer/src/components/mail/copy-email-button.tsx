import { CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

interface MailCopyEmailButtonProps {
  className?: string;
  email: string;
}

const copyEmail = async (email: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(email);
    toast.success("Email copied", { description: email });
  } catch {
    toast.error("Could not copy email");
  }
};

const MailCopyEmailButton = ({
  className,
  email,
}: MailCopyEmailButtonProps) => (
  <button
    className={cn(
      "group/email hover:bg-muted hover:text-foreground focus-visible:ring-ring/30 pointer-events-auto -ml-1 inline-flex min-w-0 cursor-copy items-center gap-1 rounded-sm pr-1.5 pl-1 text-left transition-colors outline-none focus-visible:ring-2",
      className
    )}
    onClick={async () => {
      await copyEmail(email);
    }}
    title={`Copy ${email}`}
    type="button"
  >
    <span className="truncate">{email}</span>
    <CopyIcon
      aria-hidden="true"
      className="h-3 w-0 shrink-0 opacity-0 transition-all group-hover/email:w-3 group-hover/email:opacity-100 group-focus-visible/email:w-3 group-focus-visible/email:opacity-100"
    />
  </button>
);

export default MailCopyEmailButton;
