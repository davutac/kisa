import { randomUUID } from "node:crypto";

import type { StoredMailDraftAttachment } from "@repo/database/schemas";
import type { WebContents } from "electron";

import { MAX_GMAIL_ATTACHMENT_BYTES } from "../../shared/ipc/mail";
import type {
  GmailOutgoingAttachmentCapability,
  GmailOutgoingAttachmentSelectionRequest,
  MailDraftAttachment,
} from "../../shared/ipc/mail";
import { OutgoingAttachmentAuthorizationError } from "./outgoing-attachment-authorization-error";
import {
  authorizeOutgoingAttachmentFiles,
  closeOutgoingAttachment,
  decodeStoredOutgoingAttachments,
  openOutgoingAttachment,
  readOutgoingAttachment,
} from "./outgoing-attachment-files";
import type {
  LoadedOutgoingAttachment,
  OpenedOutgoingAttachment,
} from "./outgoing-attachment-files";

export { OutgoingAttachmentAuthorizationError } from "./outgoing-attachment-authorization-error";

const DEFAULT_CAPABILITY_TTL_MS = 60_000;
const MAX_ATTACHMENT_COUNT = 100;

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
    if (request.files.length > MAX_ATTACHMENT_COUNT) {
      throw authorizationError("Too many attachments were selected");
    }

    const records = await authorizeOutgoingAttachmentFiles(
      request.files,
      this.#randomId
    );

    return records.map((record) => this.#registerReference(ownerId, record));
  }

  restoreDraftAttachments(
    ownerId: number,
    input: unknown
  ): readonly MailDraftAttachment[] {
    return decodeStoredOutgoingAttachments(input).map((record) =>
      this.#registerReference(ownerId, record)
    );
  }

  serializeDraftAttachments(
    ownerId: number,
    attachments: readonly MailDraftAttachment[]
  ): readonly StoredMailDraftAttachment[] {
    return attachments.map(({ referenceId }) => {
      const reference = this.#references.get(referenceId);
      if (reference === undefined || reference.ownerId !== ownerId) {
        throw authorizationError(
          "An attachment is no longer authorized; attach it again"
        );
      }
      return reference.record;
    });
  }

  async prepare(
    ownerId: number,
    referenceIds: readonly string[]
  ): Promise<readonly GmailOutgoingAttachmentCapability[]> {
    this.#expireCapabilities();
    if (
      referenceIds.length > MAX_ATTACHMENT_COUNT ||
      new Set(referenceIds).size !== referenceIds.length
    ) {
      throw authorizationError("Attachment authorization is invalid");
    }

    const settled = await Promise.allSettled(
      referenceIds.map((referenceId) => {
        const reference = this.#references.get(referenceId);
        if (reference === undefined || reference.ownerId !== ownerId) {
          throw authorizationError(
            "An attachment is no longer authorized; attach it again"
          );
        }

        return openOutgoingAttachment(reference.record);
      })
    );
    const pending: OpenedOutgoingAttachment[] = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const failed = settled.find((result) => result.status === "rejected");
    const totalBytes = pending.reduce((total, entry) => total + entry.size, 0);
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
    if (
      capabilityIds.length > MAX_ATTACHMENT_COUNT ||
      new Set(capabilityIds).size !== capabilityIds.length
    ) {
      throw authorizationError("Attachment authorization is invalid");
    }

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
      filename: record.filename,
      id: record.id,
      mediaType: record.mediaType,
      referenceId,
      size: record.size,
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

const boundAttachmentOwners = new WeakSet<WebContents>();

export const bindOutgoingAttachmentOwner = (owner: WebContents): number => {
  const ownerId = owner.id;
  if (!boundAttachmentOwners.has(owner)) {
    boundAttachmentOwners.add(owner);
    owner.once("destroyed", () => {
      void outgoingAttachmentAuthorizations.releaseOwner(ownerId);
    });
  }
  return ownerId;
};
