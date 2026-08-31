import { randomUUID } from "node:crypto";

import type { StoredMailDraftAttachment } from "@repo/database/schemas";

import {
  isSupportedOutgoingInlineImageMediaType,
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_MESSAGE_BYTES,
} from "../../shared/attachments";
import {
  MAX_GMAIL_ATTACHMENT_BYTES,
  MAX_GMAIL_ATTACHMENT_COUNT,
} from "../../shared/ipc/mail";
import type {
  GmailOutgoingAttachmentCapability,
  GmailOutgoingAttachmentPrepareRequest,
  GmailOutgoingAttachmentSelectionRequest,
  MailDraftAttachment,
} from "../../shared/ipc/mail";
import { OutgoingAttachmentAuthorizationError } from "./outgoing-attachment-authorization-error";
import {
  authorizeOutgoingAttachmentFiles,
  closeOutgoingAttachment,
  decodeStoredOutgoingAttachmentEntries,
  openOutgoingAttachment,
  readOutgoingAttachment,
} from "./outgoing-attachment-files";
import type {
  LoadedOutgoingAttachment,
  OpenedOutgoingAttachment,
} from "./outgoing-attachment-files";

export { OutgoingAttachmentAuthorizationError } from "./outgoing-attachment-authorization-error";

const DEFAULT_CAPABILITY_TTL_MS = 60_000;

interface AttachmentReference {
  readonly ownerId: number;
  readonly record: StoredMailDraftAttachment;
}

interface PreparedAttachment extends OpenedOutgoingAttachment {
  readonly capability: string;
  readonly expiresAt: number;
  readonly ownerId: number;
  readonly timer: NodeJS.Timeout;
}

interface OutgoingAttachmentAuthorizationsOptions {
  readonly capabilityTtlMs?: number;
  readonly now?: () => number;
  readonly randomId?: () => string;
}

const authorizationError = (
  message: string
): OutgoingAttachmentAuthorizationError =>
  new OutgoingAttachmentAuthorizationError({ message });

const assertValidAttachmentReferenceIds = (
  referenceIds: readonly string[]
): void => {
  if (
    referenceIds.length > MAX_GMAIL_ATTACHMENT_COUNT ||
    new Set(referenceIds).size !== referenceIds.length
  ) {
    throw authorizationError("Attachment authorization is invalid");
  }
};

const withContentId = (
  record: StoredMailDraftAttachment,
  contentId: string | undefined
): StoredMailDraftAttachment => {
  if (
    contentId !== undefined &&
    (!isSupportedOutgoingInlineImageMediaType(record.mediaType) ||
      record.size > MAX_INLINE_IMAGE_BYTES)
  ) {
    throw authorizationError(
      "Only JPEG, PNG, GIF, and WebP images up to 2 MB can be inserted inline"
    );
  }
  const { contentId: _previousContentId, ...base } = record;

  return contentId === undefined ? base : { ...base, contentId };
};

const hasDuplicates = (values: readonly string[]): boolean =>
  new Set(values).size !== values.length;

const getAttachmentBytes = (entries: readonly { readonly size: number }[]) => {
  let total = 0;
  for (const entry of entries) {
    total += entry.size;
  }
  return total;
};

const validateInlineImageTotal = (
  records: readonly StoredMailDraftAttachment[]
): void => {
  let totalBytes = 0;
  for (const record of records) {
    if (record.contentId !== undefined) {
      totalBytes += record.size;
    }
  }
  if (totalBytes > MAX_INLINE_MESSAGE_BYTES) {
    throw authorizationError("Inline images can total up to 8 MB");
  }
};

export class OutgoingAttachmentAuthorizations {
  readonly #capabilities = new Map<string, PreparedAttachment>();
  readonly #capabilityTtlMs: number;
  readonly #now: () => number;
  readonly #randomId: () => string;
  readonly #referenceIdsByOwner = new Map<number, Map<string, string>>();
  readonly #references = new Map<string, AttachmentReference>();

  constructor(options: OutgoingAttachmentAuthorizationsOptions = {}) {
    this.#capabilityTtlMs =
      options.capabilityTtlMs ?? DEFAULT_CAPABILITY_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#randomId = options.randomId ?? randomUUID;
  }

  async authorizeSelections(
    ownerId: number,
    request: GmailOutgoingAttachmentSelectionRequest
  ): Promise<readonly MailDraftAttachment[]> {
    if (request.files.length > MAX_GMAIL_ATTACHMENT_COUNT) {
      throw authorizationError("Too many attachments were selected");
    }

    const records = await authorizeOutgoingAttachmentFiles(
      request.files,
      this.#randomId
    );

    return records.map((record) => this.#registerReference(ownerId, record));
  }

  restoreDraftAttachments<Input>(
    ownerId: number,
    input: Input
  ): readonly MailDraftAttachment[] {
    const entries = decodeStoredOutgoingAttachmentEntries(input);
    if (entries === undefined || entries.length > MAX_GMAIL_ATTACHMENT_COUNT) {
      return [this.#unavailableAttachment(0)];
    }
    return entries.map((record, index) =>
      record === undefined
        ? this.#unavailableAttachment(index)
        : this.#registerReference(ownerId, record)
    );
  }

  serializeDraftAttachments(
    ownerId: number,
    attachments: readonly MailDraftAttachment[]
  ): readonly StoredMailDraftAttachment[] {
    const referenceIds = attachments.map(({ referenceId }) => referenceId);
    assertValidAttachmentReferenceIds(referenceIds);
    const contentIds = attachments.flatMap(({ contentId }) =>
      contentId === undefined ? [] : [contentId]
    );
    if (hasDuplicates(contentIds)) {
      throw authorizationError("Inline image authorization is invalid");
    }
    const records = attachments.map(({ contentId, referenceId }) => {
      const reference = this.#references.get(referenceId);
      if (reference === undefined || reference.ownerId !== ownerId) {
        throw authorizationError(
          "An attachment is no longer authorized; attach it again"
        );
      }
      return withContentId(reference.record, contentId);
    });
    if (getAttachmentBytes(records) > MAX_GMAIL_ATTACHMENT_BYTES) {
      throw authorizationError("Attachments can total up to 25 MB");
    }
    validateInlineImageTotal(records);
    return records;
  }

  async prepare(
    ownerId: number,
    attachments: GmailOutgoingAttachmentPrepareRequest["attachments"]
  ): Promise<readonly GmailOutgoingAttachmentCapability[]> {
    this.#expireCapabilities();
    const referenceIds = attachments.map(({ referenceId }) => referenceId);
    assertValidAttachmentReferenceIds(referenceIds);
    const contentIds = attachments.flatMap(({ contentId }) =>
      contentId === undefined ? [] : [contentId]
    );
    if (hasDuplicates(contentIds)) {
      throw authorizationError("Attachment authorization is invalid");
    }

    const records = attachments.map(({ contentId, referenceId }) => {
      const reference = this.#references.get(referenceId);
      if (reference === undefined || reference.ownerId !== ownerId) {
        throw authorizationError(
          "An attachment is no longer authorized; attach it again"
        );
      }
      return withContentId(reference.record, contentId);
    });
    validateInlineImageTotal(records);
    if (getAttachmentBytes(records) > MAX_GMAIL_ATTACHMENT_BYTES) {
      throw authorizationError("Attachments can total up to 25 MB");
    }

    const settled = await Promise.allSettled(
      records.map(openOutgoingAttachment)
    );
    const pending: OpenedOutgoingAttachment[] = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const failed = settled.find((result) => result.status === "rejected");
    const totalBytes = getAttachmentBytes(pending);
    if (failed !== undefined || totalBytes > MAX_GMAIL_ATTACHMENT_BYTES) {
      await Promise.all(
        pending.map(({ file }) => closeOutgoingAttachment(file))
      );
      if (failed !== undefined) {
        const error = failed.reason;
        if (error instanceof OutgoingAttachmentAuthorizationError) {
          throw error;
        }
        throw authorizationError("Could not prepare attachments");
      }
      throw authorizationError("Attachments can total up to 25 MB");
    }

    const expiresAt = this.#now() + this.#capabilityTtlMs;
    return pending.map(({ file, record, size }) => {
      const capability = this.#randomId();
      const timer = setTimeout(() => {
        void this.#expireCapability(capability);
      }, this.#capabilityTtlMs);
      timer.unref();
      this.#capabilities.set(capability, {
        capability,
        expiresAt,
        file,
        ownerId,
        record,
        size,
        timer,
      });
      return { capability };
    });
  }

  async consume(
    ownerId: number,
    capabilityIds: readonly string[]
  ): Promise<readonly LoadedOutgoingAttachment[]> {
    this.#expireCapabilities();
    assertValidAttachmentReferenceIds(capabilityIds);

    const prepared = capabilityIds.map((capability) => {
      const entry = this.#capabilities.get(capability);
      if (
        entry === undefined ||
        entry.ownerId !== ownerId ||
        entry.expiresAt <= this.#now()
      ) {
        throw authorizationError(
          "Attachment authorization expired; attach the file again"
        );
      }
      return entry;
    });

    for (const entry of prepared) {
      this.#capabilities.delete(entry.capability);
      clearTimeout(entry.timer);
    }

    try {
      return await Promise.all(prepared.map(readOutgoingAttachment));
    } catch (error) {
      if (error instanceof OutgoingAttachmentAuthorizationError) {
        throw error;
      }
      throw authorizationError("Could not read an attachment");
    } finally {
      await Promise.all(
        prepared.map(({ file }) => closeOutgoingAttachment(file))
      );
    }
  }

  async releaseOwner(ownerId: number): Promise<void> {
    const referenceIds = this.#referenceIdsByOwner.get(ownerId);
    if (referenceIds !== undefined) {
      for (const referenceId of referenceIds.values()) {
        this.#references.delete(referenceId);
      }
      this.#referenceIdsByOwner.delete(ownerId);
    }
    const closing: Promise<void>[] = [];
    for (const [capability, entry] of this.#capabilities) {
      if (entry.ownerId === ownerId) {
        this.#capabilities.delete(capability);
        clearTimeout(entry.timer);
        closing.push(closeOutgoingAttachment(entry.file));
      }
    }
    await Promise.all(closing);
  }

  #registerReference(
    ownerId: number,
    record: StoredMailDraftAttachment
  ): MailDraftAttachment {
    const referenceIds =
      this.#referenceIdsByOwner.get(ownerId) ?? new Map<string, string>();
    const referenceId = referenceIds.get(record.id) ?? this.#randomId();
    referenceIds.set(record.id, referenceId);
    this.#referenceIdsByOwner.set(ownerId, referenceIds);
    this.#references.set(referenceId, { ownerId, record });
    return {
      contentId: record.contentId,
      filename: record.filename,
      id: record.id,
      mediaType: record.mediaType,
      referenceId,
      size: record.size,
    };
  }

  #unavailableAttachment(index: number): MailDraftAttachment {
    const id = `unavailable-${this.#randomId()}-${index}`;
    return {
      filename: "Attachment unavailable — remove and reattach",
      id,
      mediaType: "application/octet-stream",
      referenceId: id,
      size: 0,
    };
  }

  #expireCapabilities(): void {
    for (const [capability, entry] of this.#capabilities) {
      if (entry.expiresAt <= this.#now()) {
        void this.#expireCapability(capability);
      }
    }
  }

  async #expireCapability(capability: string): Promise<void> {
    const entry = this.#capabilities.get(capability);
    if (entry === undefined) {
      return;
    }
    this.#capabilities.delete(capability);
    clearTimeout(entry.timer);
    await closeOutgoingAttachment(entry.file);
  }
}

export const outgoingAttachmentAuthorizations =
  new OutgoingAttachmentAuthorizations();

interface AttachmentOwner {
  readonly id: number;
  readonly once: (event: "destroyed", listener: () => void) => unknown;
}

const boundAttachmentOwners = new WeakSet<AttachmentOwner>();

export const bindOutgoingAttachmentOwner = (owner: AttachmentOwner): number => {
  const ownerId = owner.id;
  if (!boundAttachmentOwners.has(owner)) {
    boundAttachmentOwners.add(owner);
    owner.once("destroyed", () => {
      void outgoingAttachmentAuthorizations.releaseOwner(ownerId);
    });
  }
  return ownerId;
};
