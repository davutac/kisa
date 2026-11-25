import path from "node:path";

// An attachment's name is written by its sender, so it can carry path parts,
// control characters, or bidirectional overrides that make `invoice‮fdp.exe`
// read as `invoiceexe.pdf`. The renderer shows the same cleaned name that Save
// As offers, so what the reader sees is what lands on disk.

const WINDOWS_RESERVED_FILENAME =
  /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\.|$)/iu;

const UNSAFE_FILENAME_CHARACTERS = /[\p{Cc}‪-‮⁦-⁩]/gu;
const WINDOWS_INVALID_FILENAME_CHARACTERS = /[<>:"|?*]/gu;

export const sanitizeAttachmentFilename = (filename: string): string => {
  const leaf = path.posix.basename(
    filename.normalize("NFKC").replaceAll("\\", "/")
  );

  const cleaned = leaf
    .replaceAll(UNSAFE_FILENAME_CHARACTERS, "")
    .replaceAll(WINDOWS_INVALID_FILENAME_CHARACTERS, "")
    .trim()
    .replaceAll(/[. ]+$/gu, "")
    .slice(0, 180);

  const usable = cleaned.length === 0 ? "attachment" : cleaned;

  return WINDOWS_RESERVED_FILENAME.test(usable) ? `_${usable}` : usable;
};

/** An attachment as the renderer may display it. */
export const toDisplayedAttachment = <
  Attachment extends { readonly filename: string },
>(
  attachment: Attachment
): Attachment => ({
  ...attachment,
  filename: sanitizeAttachmentFilename(attachment.filename),
});
