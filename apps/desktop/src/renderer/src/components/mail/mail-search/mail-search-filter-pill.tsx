import { XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSearchFilterLabel } from "@/mail/search-query";
import type { SearchFilter } from "@/mail/search-query";

const MailSearchFilterPill = ({
  filter,
  onRemove,
}: {
  filter: SearchFilter;
  onRemove: () => void;
}) => (
  <Badge
    className="bg-muted text-foreground h-6 shrink-0 gap-1 rounded-md pr-0.5 pl-2 text-xs font-normal"
    variant="secondary"
  >
    <span className="text-muted-foreground">
      {getSearchFilterLabel(filter.field)}
    </span>
    <span className="max-w-48 truncate font-medium">{filter.value}</span>
    <Button
      aria-label={`Remove ${filter.field}:${filter.value} filter`}
      className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 dark:hover:bg-foreground/10 size-5 rounded-sm border-0 p-0 focus-visible:ring-1 active:not-aria-[haspopup]:scale-100"
      onClick={onRemove}
      size="xs"
      type="button"
      variant="ghost"
    >
      <XIcon className="size-3" />
    </Button>
  </Badge>
);

export default MailSearchFilterPill;
