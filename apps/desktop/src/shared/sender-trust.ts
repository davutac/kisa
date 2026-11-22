// "Always display images from this sender" names an address, and a From
// address is whatever the sender wrote. The choice therefore only applies to a
// message whose sender Gmail authenticated, and never in Spam, where the server has
// already judged the message suspicious. Main uses the same rule before it
// looks up a sender's logo.

const SPAM_LABEL_ID = "SPAM";

export interface SenderTrustMessage {
  readonly labelIds: readonly string[];
  readonly senderAuthenticated: boolean;
}

export const canApplySenderTrust = (message: SenderTrustMessage): boolean =>
  message.senderAuthenticated && !message.labelIds.includes(SPAM_LABEL_ID);
