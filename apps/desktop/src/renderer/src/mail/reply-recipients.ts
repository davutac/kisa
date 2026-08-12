import { extractEmailAddresses, parseMailboxAddress } from "@/mail/address";
import type { GmailThreadMessage } from "@/shared/ipc/mail";

export type MailMessageAction = "forward" | "reply" | "reply-all";

export interface MailReplyRecipients {
  readonly bcc: readonly string[];
  readonly cc: readonly string[];
  readonly to: readonly string[];
}

const getAddresses = (header?: string): readonly string[] => {
  if (header === undefined) {
    return [];
  }

  const addresses = extractEmailAddresses(header);
  return addresses.length > 0 ? addresses : [parseMailboxAddress(header).email];
};

const uniqueAddresses = (
  addresses: readonly string[],
  excludedAddresses: readonly string[] = []
): readonly string[] => {
  const excluded = new Set(
    excludedAddresses.map((address) => address.toLowerCase())
  );
  const seen = new Set<string>();

  return addresses.filter((address) => {
    const normalizedAddress = address.toLowerCase();

    if (excluded.has(normalizedAddress) || seen.has(normalizedAddress)) {
      return false;
    }

    seen.add(normalizedAddress);
    return true;
  });
};

export const getInitialReplyRecipients = (
  accountId: string,
  action: MailMessageAction,
  latestMessage: GmailThreadMessage
): MailReplyRecipients => {
  if (action === "forward") {
    return { bcc: [], cc: [], to: [] };
  }

  const senderAddresses = uniqueAddresses(
    getAddresses(latestMessage.replyTo ?? latestMessage.from),
    [accountId]
  );
  const fallbackAddresses = uniqueAddresses(getAddresses(latestMessage.to), [
    accountId,
  ]);
  const toAddresses =
    senderAddresses.length > 0 ? senderAddresses : fallbackAddresses;

  if (action === "reply") {
    return { bcc: [], cc: [], to: toAddresses };
  }

  const originalToAddresses = uniqueAddresses(getAddresses(latestMessage.to), [
    accountId,
    ...toAddresses,
  ]);
  const replyAllToAddresses = [...toAddresses, ...originalToAddresses];
  const ccAddresses = uniqueAddresses(getAddresses(latestMessage.cc), [
    accountId,
    ...replyAllToAddresses,
  ]);

  return {
    bcc: [],
    cc: ccAddresses,
    to: replyAllToAddresses,
  };
};

export const shouldShowReplyAll = (
  accountId: string,
  message: GmailThreadMessage
): boolean => {
  const recipients = getInitialReplyRecipients(accountId, "reply-all", message);

  return recipients.to.length + recipients.cc.length > 1;
};
