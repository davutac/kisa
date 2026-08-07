import { ImageOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

interface MailRemoteImageNoticeProps {
  onAlwaysShow: () => void;
  onShow: () => void;
  senderEmail: string;
}

const MailRemoteImageNotice = ({
  onAlwaysShow,
  onShow,
  senderEmail,
}: MailRemoteImageNoticeProps) => (
  <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-4 pt-1 pb-2 text-xs">
    <ImageOffIcon aria-hidden="true" className="size-3.5 shrink-0" />
    <span className="text-foreground font-medium">
      Images are not displayed.
    </span>
    <Button
      className="h-auto px-0 py-0 text-xs/relaxed"
      onClick={onShow}
      size="xs"
      type="button"
      variant="link"
    >
      Show images below
    </Button>
    <span aria-hidden="true">-</span>
    <Button
      className="h-auto min-w-0 px-0 py-0 text-xs/relaxed"
      onClick={onAlwaysShow}
      size="xs"
      type="button"
      variant="link"
    >
      <span className="truncate">Always display images from {senderEmail}</span>
    </Button>
  </div>
);

export default MailRemoteImageNotice;
