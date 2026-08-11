import { useEffect, useMemo, useState } from "react";

import type { GmailAttachmentPreview } from "@/shared/ipc/mail";

import { PreviewError } from "./preview-status";

const ImagePreview = ({
  attachment,
}: {
  attachment: GmailAttachmentPreview;
}) => {
  const [failed, setFailed] = useState(false);
  const url = useMemo(
    () =>
      URL.createObjectURL(
        new Blob([new Uint8Array(attachment.bytes).buffer], {
          type: attachment.mediaType,
        })
      ),
    [attachment.bytes, attachment.mediaType]
  );

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  if (failed) {
    return <PreviewError message="This image format could not be displayed." />;
  }

  return (
    <div className="min-h-full w-full">
      <img
        alt={attachment.filename}
        className="block h-auto w-full"
        onError={() => setFailed(true)}
        src={url}
      />
    </div>
  );
};

export default ImagePreview;
