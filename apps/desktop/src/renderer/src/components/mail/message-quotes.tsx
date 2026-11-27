import { ArrowUpIcon, TextQuoteIcon } from "lucide-react";
import { useState } from "react";

import MailDate from "@/components/mail/mail-date";
import MailMessageBody from "@/components/mail/message-body";
import { Toggle, ToggleGroup } from "@/components/ui/toggle";
import { Toolbar, ToolbarButton } from "@/components/ui/toolbar";
import { parseMailboxAddress } from "@/mail/address";
import type { QuotedMessage } from "@/mail/quoted-messages";
import type { ThreadMessage } from "@/shared/ipc/mail";

interface MailMessageQuotesProps {
  allowRemoteImages: boolean;
  /** The conversation's own message each quote repeats, or null for none. */
  matches: readonly (ThreadMessage | null)[];
  onFramePointerDown?: () => void;
  onShowMessage: (messageId: string) => void;
  quotes: readonly QuotedMessage[];
}

/**
 * Who a quote is from: the name the conversation knows its message's sender
 * by, or else what the quote's own header says.
 */
const quoteSenderLabel = (
  quote: QuotedMessage,
  match: ThreadMessage | null
): string => {
  if (match !== null) {
    const from = parseMailboxAddress(match.from);

    return from.name ?? from.email;
  }

  return quote.sender.name ?? quote.sender.email ?? "Earlier message";
};

/**
 * The earlier messages a message quotes at its end, one chip each, nearest
 * first. None is open until the reader chooses one: the conversation usually
 * shows the same messages above. A toggle group rather than tabs, so the
 * chosen chip closes again.
 */
const MailMessageQuotes = ({
  allowRemoteImages,
  matches,
  onFramePointerDown,
  onShowMessage,
  quotes,
}: MailMessageQuotesProps) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const selectedQuote =
    selectedIndex === null ? undefined : quotes[selectedIndex];

  const selectedMatch =
    selectedIndex === null ? null : (matches[selectedIndex] ?? null);

  return (
    <div className="flex min-w-0 flex-col gap-2 px-4 pt-1 pb-4">
      <Toolbar
        aria-label="Quoted messages"
        className="scroll-fade-x min-w-0 scrollbar-thin gap-1.5 overflow-x-auto"
      >
        <TextQuoteIcon
          aria-hidden="true"
          className="text-muted-foreground size-3.5 shrink-0"
        />
        <ToggleGroup
          aria-label="Quoted message"
          className="w-max"
          onValueChange={([value]) => {
            setSelectedIndex(value === undefined ? null : Number(value));
          }}
          value={selectedIndex === null ? [] : [String(selectedIndex)]}
        >
          {quotes.map((quote, index) => {
            const match = matches[index] ?? null;

            return (
              <Toggle
                className="max-w-56 shrink-0"
                // A chain of quotes has no ids of its own; its order is fixed.
                // oxlint-disable-next-line react/no-array-index-key
                key={index}
                size="sm"
                value={String(index)}
                variant="outline"
              >
                <span className="truncate">
                  {quoteSenderLabel(quote, match)}
                </span>
                {match === null ? null : (
                  <MailDate
                    className="opacity-70"
                    timestamp={match.sentAt}
                    tooltip={false}
                  />
                )}
              </Toggle>
            );
          })}
        </ToggleGroup>
        {selectedMatch === null ? null : (
          <ToolbarButton
            className="ml-auto shrink-0"
            onClick={() => onShowMessage(selectedMatch.id)}
            size="sm"
          >
            <ArrowUpIcon />
            Show in conversation
          </ToolbarButton>
        )}
      </Toolbar>
      {selectedQuote === undefined ? null : (
        <section
          aria-label={`Quoted message from ${quoteSenderLabel(selectedQuote, selectedMatch)}`}
          className="border-border overflow-hidden rounded-md border"
        >
          {/* The quote's own header line, kept as the panel's: the message
              under it is shown as it was written, not as a quote. */}
          {selectedQuote.sender.attribution === undefined ? null : (
            <p className="text-muted-foreground border-border bg-muted/40 border-b px-4 py-2 text-xs wrap-break-word select-text">
              {selectedQuote.sender.attribution}
            </p>
          )}
          <MailMessageBody
            allowRemoteImages={allowRemoteImages}
            body={selectedQuote.body}
            fallbackText=""
            key={selectedIndex}
            onFramePointerDown={onFramePointerDown}
          />
        </section>
      )}
    </div>
  );
};

export default MailMessageQuotes;
