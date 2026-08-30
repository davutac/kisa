import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  assignComposerInlineContentIds,
  collectComposerInlineContentIds,
  getActiveComposerAttachments,
  getComposerAttachmentBytes,
  getRetainedComposerInlineBytes,
} from "@/components/mail/composer-inline-images";
import type { ComposerInlineImage } from "@/components/mail/composer-inline-images";
import type { MailApi } from "@/platform/desktop";
import { MAX_GMAIL_ATTACHMENT_BYTES } from "@/shared/ipc/mail";
import type { MailDraftAttachment } from "@/shared/ipc/mail";

const makeInlineContentId = (): string =>
  `${crypto.randomUUID()}@inline.kisa.email`;

export const useOutgoingAttachments = (
  mailApi: MailApi | undefined,
  initialAttachments: readonly MailDraftAttachment[] = [],
  initialBodyHtml = ""
) => {
  const [attachmentState, setAttachmentState] =
    useState<readonly MailDraftAttachment[]>(initialAttachments);
  const [pendingAuthorizations, setPendingAuthorizations] = useState(0);
  const activeRef = useRef(true);
  const attachmentsRef = useRef(attachmentState);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Map<string, string>());
  const [referencedContentIds, setReferencedContentIds] = useState(() =>
    collectComposerInlineContentIds(initialBodyHtml)
  );
  const revisionRef = useRef(0);
  const activeAttachments = useMemo(
    () => getActiveComposerAttachments(attachmentState, referencedContentIds),
    [attachmentState, referencedContentIds]
  );

  const updateAttachments = useCallback(
    (
      update: (
        current: readonly MailDraftAttachment[]
      ) => readonly MailDraftAttachment[]
    ): void => {
      const { current } = attachmentsRef;
      const value = update(current);
      attachmentsRef.current = value;
      setAttachmentState(value);
    },
    []
  );

  useEffect(() => {
    const active = activeRef;
    const previewUrls = previewUrlsRef.current;
    const revision = revisionRef;
    active.current = true;
    return () => {
      active.current = false;
      revision.current += 1;
      for (const url of previewUrls.values()) {
        URL.revokeObjectURL(url);
      }
      previewUrls.clear();
    };
  }, []);

  const revokeInlinePreviews = useCallback(
    (contentIds: ReadonlySet<string>): void => {
      for (const contentId of contentIds) {
        const previewUrl = previewUrlsRef.current.get(contentId);
        if (previewUrl !== undefined) {
          URL.revokeObjectURL(previewUrl);
          previewUrlsRef.current.delete(contentId);
        }
      }
    },
    []
  );

  const authorizeAttachments = useCallback(
    async (
      files: readonly File[],
      inline: boolean
    ): Promise<readonly MailDraftAttachment[]> => {
      if (files.length === 0 || mailApi === undefined) {
        return [];
      }

      const revision = revisionRef.current;
      setPendingAuthorizations((current) => current + 1);
      try {
        const reply = await mailApi.authorizeOutgoingAttachments(files);
        if (!activeRef.current || revisionRef.current !== revision) {
          return [];
        }
        if (!reply.ok) {
          toast.error(reply.error);
          return [];
        }
        const additions = inline
          ? assignComposerInlineContentIds(
              reply.data,
              getRetainedComposerInlineBytes(attachmentsRef.current),
              makeInlineContentId
            )
          : reply.data;
        const currentBytes = getComposerAttachmentBytes(attachmentsRef.current);
        const selectedBytes = getComposerAttachmentBytes(additions);
        if (currentBytes + selectedBytes > MAX_GMAIL_ATTACHMENT_BYTES) {
          toast.error("Attachments can total up to 25 MB");
          return [];
        }
        updateAttachments((current) => [...current, ...additions]);
        return additions;
      } catch (error) {
        if (activeRef.current && revisionRef.current === revision) {
          toast.error(
            error instanceof Error ? error.message : "Could not attach files"
          );
        }
        return [];
      } finally {
        if (activeRef.current) {
          setPendingAuthorizations((current) => Math.max(current - 1, 0));
        }
      }
    },
    [mailApi, updateAttachments]
  );

  const addAttachments = useCallback(
    async (fileList: FileList | readonly File[] | null): Promise<void> => {
      await authorizeAttachments([...(fileList ?? [])], false);
      if (inputRef.current !== null) {
        inputRef.current.value = "";
      }
    },
    [authorizeAttachments]
  );

  const addInlineImages = useCallback(
    async (files: readonly File[]): Promise<readonly ComposerInlineImage[]> => {
      const additions = await authorizeAttachments(files, true);
      return additions.flatMap((attachment, index) => {
        const { contentId, filename } = attachment;
        const file = files.at(index);
        if (contentId === undefined || file === undefined) {
          return [];
        }
        previewUrlsRef.current.set(contentId, URL.createObjectURL(file));
        return [{ contentId, filename }];
      });
    },
    [authorizeAttachments]
  );

  const fallbackInlineImagesToAttachments = useCallback(
    (contentIds: readonly string[]): void => {
      const rejected = new Set(contentIds);
      revokeInlinePreviews(rejected);
      updateAttachments((current) =>
        current.map((attachment) =>
          attachment.contentId !== undefined &&
          rejected.has(attachment.contentId)
            ? { ...attachment, contentId: undefined }
            : attachment
        )
      );
    },
    [revokeInlinePreviews, updateAttachments]
  );

  const discardInlineImages = useCallback(
    (contentIds: readonly string[]): void => {
      const discarded = new Set(contentIds);
      revokeInlinePreviews(discarded);
      updateAttachments((current) =>
        current.filter(
          ({ contentId }) =>
            contentId === undefined || !discarded.has(contentId)
        )
      );
    },
    [revokeInlinePreviews, updateAttachments]
  );

  const setReferencedInlineContentIds = useCallback(
    (nextContentIds: ReadonlySet<string>): void => {
      setReferencedContentIds(nextContentIds);
    },
    []
  );

  const removeAttachment = useCallback(
    (attachmentId: string): void => {
      updateAttachments((current) => {
        const removed = current.find(({ id }) => id === attachmentId);
        if (removed?.contentId !== undefined) {
          revokeInlinePreviews(new Set([removed.contentId]));
        }
        return current.filter(({ id }) => id !== attachmentId);
      });
    },
    [revokeInlinePreviews, updateAttachments]
  );

  const replaceAttachments = useCallback(
    (attachments: readonly MailDraftAttachment[], bodyHtml: string): void => {
      revisionRef.current += 1;
      revokeInlinePreviews(new Set(previewUrlsRef.current.keys()));
      setReferencedContentIds(collectComposerInlineContentIds(bodyHtml));
      updateAttachments(() => attachments);
    },
    [revokeInlinePreviews, updateAttachments]
  );

  const getInlineImagePreview = useCallback(
    (contentId: string): string | null =>
      previewUrlsRef.current.get(contentId) ?? null,
    []
  );

  const prepareAttachments = useCallback(
    async (attachments: readonly MailDraftAttachment[]) => {
      if (mailApi === undefined) {
        return;
      }

      const reply = await mailApi.prepareOutgoingAttachments({
        attachments: attachments.map(({ contentId, referenceId }) => ({
          contentId,
          referenceId,
        })),
      });
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      return reply.data;
    },
    [mailApi]
  );

  return {
    activeAttachments,
    addAttachments,
    addInlineImages,
    attachments: attachmentState,
    discardInlineImages,
    fallbackInlineImagesToAttachments,
    getInlineImagePreview,
    inputRef,
    isAuthorizing: pendingAuthorizations > 0,
    prepareAttachments,
    removeAttachment,
    replaceAttachments,
    setReferencedInlineContentIds,
  };
};

export type OutgoingAttachmentController = ReturnType<
  typeof useOutgoingAttachments
>;
