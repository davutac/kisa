import { XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatGmailLabel } from "@/mail/label";
import { getSearchFilterLabel } from "@/mail/search-query";
import type { SearchFilter } from "@/mail/search-query";

const MailSearchFilterPill = ({
  filter,
  onRemove,
}: {
  filter: SearchFilter;
  onRemove: () => void;
}) => (
  <Badge className="bg-muted h-5 gap-1 pr-1 pl-2" variant="secondary">
    <span className="opacity-60">{getSearchFilterLabel(filter.field)}</span>
    <span className="max-w-48 truncate">
      {filter.field === "label" ? formatGmailLabel(filter.value) : filter.value}
    </span>
    <button
      aria-label={`Remove ${filter.field} filter`}
      className="hover:text-foreground rounded-full opacity-60"
      onClick={onRemove}
      type="button"
    >
      <XIcon className="size-2.5" />
    </button>
  </Badge>
);

export default MailSearchFilterPill;
