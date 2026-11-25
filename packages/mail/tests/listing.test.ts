import { describe, expect, it } from "vitest";

import { conversationPlaces, listedMessages } from "../src/listing";

const PLACES = ["INBOX", "SENT", "SPAM", "TRASH"] as const;

interface Message {
  readonly labelIds: readonly string[];
}

/** Every set of places one message can be in. */
const MESSAGES: readonly Message[] = Array.from(
  { length: 2 ** PLACES.length },
  (_unused, bits) => ({
    labelIds: PLACES.filter(
      (_place, index) => Math.floor(bits / 2 ** index) % 2 === 1
    ),
  })
);

/** Every conversation of one, two or three such messages. */
const CONVERSATIONS: readonly (readonly Message[])[] = [
  ...MESSAGES.map((first) => [first]),
  ...MESSAGES.flatMap((first) => MESSAGES.map((second) => [first, second])),
  ...MESSAGES.flatMap((first) =>
    MESSAGES.flatMap((second) =>
      MESSAGES.map((third) => [first, second, third])
    )
  ),
];

const isIn = (message: Message, place: (typeof PLACES)[number]): boolean =>
  message.labelIds.includes(place);

/** In the Inbox on the server: there, and neither deleted nor reported. */
const isInboxMail = (message: Message): boolean =>
  isIn(message, "INBOX") && !isIn(message, "TRASH") && !isIn(message, "SPAM");

/** The condition the Inbox list, its unread count and notifications use. */
const isListedInInbox = (conversation: readonly Message[]): boolean => {
  const places = conversationPlaces(conversation);
  return places.isInInbox && !places.isInSpam && !places.isInTrash;
};

const describing = (conversation: readonly Message[]): string =>
  conversation.map((message) => `[${message.labelIds.join(" ")}]`).join(" + ");

describe("where a conversation is listed", () => {
  // The failure this guards against: a message arrives in a conversation
  // that was trashed or reported, and Kisa files it out of sight.
  it("lists every conversation with mail in the Inbox in the Inbox", () => {
    const hidden = CONVERSATIONS.filter(
      (conversation) =>
        conversation.some(isInboxMail) && !isListedInInbox(conversation)
    );

    expect(hidden.map(describing)).toStrictEqual([]);
  });

  it("never shows a message from Trash or Spam in an Inbox conversation", () => {
    const leaking = CONVERSATIONS.filter(
      (conversation) =>
        isListedInInbox(conversation) &&
        listedMessages(conversation).some(
          (message) => isIn(message, "TRASH") || isIn(message, "SPAM")
        )
    );

    expect(leaking.map(describing)).toStrictEqual([]);
  });

  it("lists a conversation that is in Trash altogether under Trash, with all of it", () => {
    const misfiled = CONVERSATIONS.filter(
      (conversation) =>
        conversation.every((message) => isIn(message, "TRASH")) &&
        !(
          conversationPlaces(conversation).isInTrash &&
          listedMessages(conversation).length === conversation.length
        )
    );

    expect(misfiled.map(describing)).toStrictEqual([]);
  });

  // Reporting spam leaves the user's own replies in Sent.
  it("keeps a reported conversation under Spam while none of it is in the Inbox", () => {
    const escaped = CONVERSATIONS.filter(
      (conversation) =>
        !conversation.some(isInboxMail) &&
        conversation.some(
          (message) => isIn(message, "SPAM") && !isIn(message, "TRASH")
        ) &&
        !conversationPlaces(conversation).isInSpam
    );

    expect(escaped.map(describing)).toStrictEqual([]);
  });

  it("lists every conversation by at least one of its messages, and settles", () => {
    const unsettled = CONVERSATIONS.filter((conversation) => {
      const listed = listedMessages(conversation);
      return (
        listed.length === 0 || listedMessages(listed).length !== listed.length
      );
    });

    expect(unsettled.map(describing)).toStrictEqual([]);
  });
});
