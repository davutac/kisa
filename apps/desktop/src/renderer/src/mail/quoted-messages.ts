// The earlier messages a message quotes at its end, set apart from what the
// message itself says so the conversation can offer each one by itself, and
// matched to the messages the conversation already shows.

import { parseMailboxAddress } from "@/mail/address";
import { splitQuotedHtml } from "@/mail/quoted-html";
import { splitQuotedTextChain } from "@/mail/quoted-text";
import type { QuoteSender } from "@/mail/quoted-text";
import type { MessageBody, ThreadMessage } from "@/shared/ipc/mail";

export interface QuotedMessage {
  readonly body: MessageBody;
  readonly sender: QuoteSender;
}

export interface SplitMessageBody {
  /** The message without the quotes at its end. */
  readonly reply: MessageBody;
  /** Each earlier message it quotes, nearest first. */
  readonly quotes: readonly QuotedMessage[];
  /** The whole message as text, quotes included, for copying. */
  readonly copyText: string;
}

/** A body and the chain of messages quoted at its end, or null without one. */
export const splitQuotedMessages = (
  html: string | undefined,
  text: string | undefined
): SplitMessageBody | null => {
  if (html !== undefined) {
    const split = splitQuotedHtml(html);

    return split === null
      ? null
      : {
          copyText: text ?? split.text,
          quotes: split.quotes.map((quote) => ({
            body: { html: quote.html },
            sender: quote.sender,
          })),
          reply: { html: split.html },
        };
  }

  const chain = text === undefined ? null : splitQuotedTextChain(text);

  return chain === null || text === undefined
    ? null
    : {
        copyText: text,
        quotes: chain.quotes.map((quote) => ({
          body: { text: quote.text },
          sender: quote.sender,
        })),
        reply: { text: chain.reply },
      };
};

const sameText = (left: string | undefined, right: string | undefined) =>
  left !== undefined &&
  right !== undefined &&
  left.trim().toLowerCase() === right.trim().toLowerCase();

const isFrom = (message: ThreadMessage, sender: QuoteSender): boolean => {
  const from = parseMailboxAddress(message.from);

  return sender.email === undefined
    ? sameText(from.name, sender.name)
    : sameText(from.email, sender.email);
};

/**
 * The conversation's own message each quote most likely repeats, or null
 * for a quote of mail the conversation does not hold. A reply
 * quotes the message before it, which quotes the one before that, so each
 * quote is looked for among the messages older than the last one found.
 */
export const matchQuotedMessages = (
  quotes: readonly QuotedMessage[],
  earlier: readonly ThreadMessage[]
): readonly (ThreadMessage | null)[] => {
  let end = earlier.length;

  return quotes.map(({ sender }) => {
    const index = earlier
      .slice(0, end)
      .findLastIndex((message) => isFrom(message, sender));

    if (index === -1) {
      return null;
    }

    end = index;

    return earlier[index] ?? null;
  });
};
