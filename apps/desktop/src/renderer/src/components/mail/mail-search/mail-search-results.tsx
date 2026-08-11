import { useVirtualizer } from "@tanstack/react-virtual";
import { PaperclipIcon } from "lucide-react";
import { useEffect, useState } from "react";

import MailRelativeTime from "@/components/mail/relative-time";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { parseMailboxAddress } from "@/mail/address";
import { getThreadSelectionKey } from "@/mail/thread-selection";
import type { GmailThreadSummary } from "@/shared/ipc/mail";

const RESULT_ROW_HEIGHT = 68;

const getSenderLabel = (thread: GmailThreadSummary): string => {
  const mailbox = parseMailboxAddress(thread.from);
  return mailbox.name ?? mailbox.email;
};

const MailSearchResultRow = ({
  onSelect,
  showAccount,
  thread,
}: {
  onSelect: (thread: GmailThreadSummary) => void;
  showAccount: boolean;
  thread: GmailThreadSummary;
}) => (
  <CommandItem
    className="items-start gap-3 py-2"
    onSelect={() => onSelect(thread)}
    value={`thread:${getThreadSelectionKey(thread)}`}
  >
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{getSenderLabel(thread)}</span>
        {showAccount ? (
          <span className="text-muted-foreground truncate text-[0.625rem]">
            {thread.accountId}
          </span>
        ) : null}
        {thread.hasAttachments ? (
          <PaperclipIcon className="opacity-60" />
        ) : null}
      </span>
      <span className="truncate">{thread.subject}</span>
      <span className="text-muted-foreground truncate">{thread.snippet}</span>
    </span>
    <MailRelativeTime
      className="text-muted-foreground text-[0.625rem]"
      timestamp={thread.latestAt}
    />
  </CommandItem>
);

interface MailSearchResultsProps {
  hasMore: boolean;
  isLoading: boolean;
  onSelect: (thread: GmailThreadSummary) => void;
  selectionToCenter: string | null;
  showAccount: boolean;
  threads: readonly GmailThreadSummary[];
}

const MailSearchResults = ({
  hasMore,
  isLoading,
  onSelect,
  selectionToCenter,
  showAccount,
  threads,
}: MailSearchResultsProps) => {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: threads.length,
    estimateSize: () => RESULT_ROW_HEIGHT,
    getItemKey: (index) => {
      const thread = threads[index];
      return thread === undefined ? index : getThreadSelectionKey(thread);
    },
    getScrollElement: () => scrollElement,
    overscan: 12,
  });
  const selectedIndex = threads.findIndex(
    (thread) => `thread:${getThreadSelectionKey(thread)}` === selectionToCenter
  );

  useEffect(() => {
    if (selectedIndex === -1 || scrollElement === null) {
      return;
    }
    const animationFrame = window.requestAnimationFrame(() => {
      scrollElement
        .querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
        ?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [scrollElement, selectedIndex, selectionToCenter]);

  return (
    <CommandGroup heading={hasMore ? "Results (top matches)" : "Results"}>
      {threads.length === 0 ? (
        <p className="text-muted-foreground px-2.5 py-6 text-center">
          {isLoading
            ? "Interrogating the index…"
            : "No indexed mail matches. Even the search bar is stumped."}
        </p>
      ) : (
        <div
          className="relative w-full"
          ref={(node) => {
            setScrollElement(
              node?.closest<HTMLElement>('[data-slot="command-list"]') ?? null
            );
          }}
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          {rowVirtualizer.getVirtualItems().map((row) => {
            const thread = threads[row.index];
            return thread === undefined ? null : (
              <div
                className="absolute top-0 left-0 w-full"
                data-index={row.index}
                key={row.key}
                ref={rowVirtualizer.measureElement}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <MailSearchResultRow
                  onSelect={onSelect}
                  showAccount={showAccount}
                  thread={thread}
                />
              </div>
            );
          })}
        </div>
      )}
    </CommandGroup>
  );
};

export default MailSearchResults;
