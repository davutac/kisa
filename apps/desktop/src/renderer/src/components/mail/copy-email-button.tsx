import { CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
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
  <Button
    aria-label={`Copy ${email}`}
    className={cn(
      "group/email focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-ring/30 dark:hover:bg-muted pointer-events-auto relative -mx-1 h-auto min-w-0 shrink cursor-copy justify-start gap-0 overflow-hidden rounded-sm border-0 px-1 text-left text-[length:inherit] leading-[inherit] font-normal transition-colors focus-visible:ring-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid active:not-aria-[haspopup]:translate-y-0",
      className
    )}
    onClick={() => copyEmail(email)}
    title={`Copy ${email}`}
    type="button"
    variant="ghost"
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
  </Button>
);

export default MailCopyEmailButton;
