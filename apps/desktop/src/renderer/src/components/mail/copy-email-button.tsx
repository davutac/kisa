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
      "group/email hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-ring/30 pointer-events-auto relative -mx-1 inline-flex min-w-0 cursor-copy items-center overflow-hidden rounded-sm px-1 text-left transition-colors outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid",
      className
    )}
    onClick={async () => {
      await copyEmail(email);
    }}
    title={`Copy ${email}`}
    type="button"
  >
    <span className="truncate">{email}</span>
    {/* Fades in over the end of this address, inside the pill: a laid-out
        slot would push a following comma away, and anything outside the
        pill could cover the next address or be clipped by the truncated
        row. */}
    <span
      aria-hidden="true"
      className="bg-muted pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-sm [mask-image:linear-gradient(to_right,transparent,black_0.5rem)] pr-1 pl-3 opacity-0 transition-opacity group-hover/email:opacity-100 group-focus-visible/email:opacity-100"
    >
      <CopyIcon className="size-3" />
    </span>
  </button>
);

export default MailCopyEmailButton;
