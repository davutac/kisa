import { MessagesSquareIcon, SendIcon } from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";
import { memo, useState } from "react";

import AccountChip from "@/components/accounts/account-chip";
import MailAttachmentList from "@/components/mail/attachment-list";
import MailLabelBadges from "@/components/mail/label-badges";
import MailDate from "@/components/mail/mail-date";
import MailThreadQuickActions, {
  getMailThreadQuickActionsWidth,
} from "@/components/mail/thread-quick-actions";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemHeader,
  ItemTitle,
} from "@/components/ui/item";
import { useCalendar } from "@/hooks/use-calendar";
import type { Calendar } from "@/hooks/use-calendar";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { parseMailboxAddress } from "@/mail/address";
import { hasSentLabel } from "@/mail/label";
import { formatMailDate } from "@/mail/mail-date";
import { getThreadSelectionKey } from "@/mail/thread-selection";
import {
  MailListCell,
  MailListCheck,
  MailListOpen,
  MailListRow,
} from "@/primitives/mail-list";
import type { MailThreadSummary } from "@/shared/ipc/mail";

const VISIBLE_ATTACHMENT_COUNT = 3;

interface MailThreadItemProps {
  hasCheckedThreads?: boolean;
  isChecked?: boolean;
  isSelected?: boolean;
  /** The listed mailbox's own system label, which every row would repeat. */
  mailboxLabel?: string;
  onDeleteForever?: (thread: MailThreadSummary) => void;
  onNotSpam?: (thread: MailThreadSummary) => void;
  onToggleRead?: (thread: MailThreadSummary) => void;
  onToggleSelection: (thread: MailThreadSummary) => void;
  onTrash?: (thread: MailThreadSummary) => void;
  showAccount?: boolean;
  thread: MailThreadSummary;
  /** Virtual row offset, passed as a number so memoized rows compare equal. */
  top: number;
}

const getThreadRowLabel = (
  thread: MailThreadSummary,
  calendar: Calendar,
  showAccount: boolean
): string =>
  [
    thread.subject,
    `from ${thread.from}`,
    showAccount ? `in ${thread.accountId}` : undefined,
    formatMailDate(thread.latestAt, calendar, "detailed"),
    thread.isUnread ? "unread" : undefined,
    thread.messageCount > 1 ? `${thread.messageCount} messages` : undefined,
    hasSentLabel(thread.labels) ? "sent" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(", ");

// Names each row's controls apart, also across accounts that share a subject.
export const getThreadControlName = (
  thread: Pick<MailThreadSummary, "accountId" | "subject">,
  showAccount: boolean
): string => {
  const subject = thread.subject.trim() || "No subject";
  return showAccount ? `${subject} in ${thread.accountId}` : subject;
};

const bindThreadAction = (
  action: ((thread: MailThreadSummary) => void) | undefined,
  thread: MailThreadSummary
): (() => void) | undefined =>
  action === undefined ? undefined : () => action(thread);

const getThreadItemRevealState = (
  hasCheckedThreads: boolean,
  isChecked: boolean,
  isSelected: boolean,
  isHovered: boolean
) => ({
  areQuickActionsRevealed: isHovered || (isSelected && !hasCheckedThreads),
  isActive: isChecked || isSelected || isHovered,
});

const ThreadSelectionCheckbox = ({
  isChecked,
  isRevealed,
  name,
  onToggle,
}: {
  isChecked: boolean;
  isRevealed: boolean;
  name: string;
  onToggle: () => void;
}) => {
  const shouldReduceMotion = useReducedMotionConfig();

  return (
    <MailListCheck
      className="pointer-events-auto relative flex shrink-0 overflow-visible"
      inert={!isRevealed}
      render={
        <m.span
          animate={{
            marginRight: isRevealed ? 2 : -8,
            opacity: isRevealed ? 1 : 0,
            width: isRevealed ? 16 : 0,
          }}
          initial={{
            marginRight: -8,
            opacity: 0,
            width: 0,
          }}
          transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.26)}
        />
      }
    >
      <Checkbox
        aria-label={`Select ${name}`}
        checked={isChecked}
        onCheckedChange={() => onToggle()}
        onClick={(event) => {
          event.stopPropagation();
          // Pressing it already painted the row for a drag; preventDefault
          // skips the checkbox's own toggle. Keyboard clicks have detail 0.
          if (event.detail > 0) {
            event.preventDefault();
          }
        }}
      />
    </MailListCheck>
  );
};

const ThreadSenderHeader = ({
  isChecked,
  isSelectionRevealed,
  mailboxLabel,
  onToggleSelection,
  showAccount,
  thread,
}: {
  isChecked: boolean;
  isSelectionRevealed: boolean;
  mailboxLabel?: string;
  onToggleSelection: () => void;
  showAccount: boolean;
  thread: MailThreadSummary;
}) => {
  const senderMailbox = parseMailboxAddress(thread.from);
  const hasSenderName = senderMailbox.name !== undefined;
  // Whichever part names the sender carries the unread weight; an address
  // shown beside a name stays secondary.
  const senderClassName = thread.isUnread
    ? "text-foreground font-semibold"
    : "text-foreground/80 font-normal";

  return (
    <ItemHeader className="min-w-0 flex-wrap justify-start gap-2">
      <ThreadSelectionCheckbox
        isChecked={isChecked}
        isRevealed={isSelectionRevealed}
        name={getThreadControlName(thread, showAccount)}
        onToggle={onToggleSelection}
      />
      <ItemTitle
        className="max-w-full min-w-0 gap-1.5 overflow-hidden text-xs"
        title={thread.from}
      >
        {hasSenderName ? (
          <span className={cn("min-w-0 truncate", senderClassName)}>
            {senderMailbox.name}
          </span>
        ) : null}
        <span
          className={cn(
            "min-w-0 truncate",
            hasSenderName ? "text-muted-foreground" : senderClassName
          )}
        >
          {senderMailbox.email}
        </span>
      </ItemTitle>
      {hasSentLabel(thread.labels) && mailboxLabel !== "SENT" ? (
        <span
          aria-hidden="true"
          className="text-muted-foreground inline-flex shrink-0"
          title="Sent conversation"
        >
          <SendIcon className="size-3.5 stroke-[1.8]" />
        </span>
      ) : null}
      <MailLabelBadges
        accountId={thread.accountId}
        labels={thread.labels}
        omitLabel={mailboxLabel}
        size="compact"
      />
      {showAccount ? (
        <Badge
          className="bg-muted text-muted-foreground ml-auto h-auto max-w-full shrink-0 rounded-sm px-1.5 text-[10px] leading-3"
          variant="secondary"
        >
          <AccountChip accountId={thread.accountId} />
        </Badge>
      ) : null}
    </ItemHeader>
  );
};

const MailThreadItem = ({
  hasCheckedThreads = false,
  isChecked = false,
  isSelected = false,
  mailboxLabel,
  onDeleteForever,
  onNotSpam,
  onToggleRead,
  onToggleSelection,
  onTrash,
  showAccount = false,
  thread,
  top,
}: MailThreadItemProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const calendar = useCalendar();
  const [isHovered, setIsHovered] = useState(false);
  const { areQuickActionsRevealed, isActive } = getThreadItemRevealState(
    hasCheckedThreads,
    isChecked,
    isSelected,
    isHovered
  );
  const revealTransition = shouldReduceMotion ? NO_MOTION : easeInOut(0.26);
  const visibleAttachments = thread.attachments.slice(
    0,
    VISIBLE_ATTACHMENT_COUNT
  );
  const hiddenAttachmentCount =
    thread.attachments.length - visibleAttachments.length;
  const handleNotSpam = bindThreadAction(onNotSpam, thread);
  const hasDestructiveAction =
    onDeleteForever !== undefined || onTrash !== undefined;
  const quickActionsWidth = getMailThreadQuickActionsWidth(
    handleNotSpam !== undefined,
    hasDestructiveAction
  );

  return (
    <MailListRow
      className="absolute left-0 w-full pb-px"
      render={
        <m.div
          animate={shouldReduceMotion ? undefined : { opacity: 1 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0 }}
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          layout={shouldReduceMotion ? false : "position"}
          layoutId={
            shouldReduceMotion
              ? undefined
              : `mail-thread:${thread.accountId}:${thread.threadId}`
          }
          transition={{
            layout: easeInOut(0.24),
            opacity: easeInOut(0.16),
          }}
        />
      }
      style={{ top }}
      value={getThreadSelectionKey(thread)}
    >
      <m.div
        className="relative"
        initial={false}
        onHoverEnd={() => {
          setIsHovered(false);
        }}
        onHoverStart={() => {
          setIsHovered(true);
        }}
      >
        {/* Opaque, so the row hides the panel edge it overlaps. */}
        <MailListCell
          className="bg-background relative z-10 rounded-md"
          render={
            <m.div
              animate={{
                marginRight: areQuickActionsRevealed ? quickActionsWidth : 0,
              }}
              initial={false}
              transition={revealTransition}
            />
          }
        >
          <Item
            className={cn(
              "data-[active=true]:bg-muted/60 relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 border-0 px-4 py-3",
              thread.isUnread && "bg-muted/30"
            )}
            data-active={isActive}
            data-checked={isChecked}
            data-selected={isSelected}
          >
            <MailListOpen
              aria-label={getThreadRowLabel(thread, calendar, showAccount)}
              className="absolute inset-0 z-0 rounded-md text-left outline-none"
            />
            <ItemContent className="pointer-events-none relative z-10 min-w-0 gap-1">
              <ThreadSenderHeader
                isChecked={isChecked}
                isSelectionRevealed={isActive}
                mailboxLabel={mailboxLabel}
                onToggleSelection={() => {
                  onToggleSelection(thread);
                }}
                showAccount={showAccount}
                thread={thread}
              />
              <div className="flex min-w-0 items-center gap-1.5">
                <ItemTitle
                  className={cn(
                    "min-w-0 truncate text-sm",
                    thread.isUnread
                      ? "text-foreground font-semibold"
                      : "text-foreground/80 font-normal"
                  )}
                >
                  {thread.subject}
                </ItemTitle>
                {thread.messageCount > 1 ? (
                  // The row's label already announces the count.
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs tabular-nums"
                  >
                    <MessagesSquareIcon className="size-3" />
                    {thread.messageCount}
                  </span>
                ) : null}
              </div>
              <ItemDescription className="line-clamp-1 text-sm">
                {thread.snippet}
              </ItemDescription>
              {thread.attachments.length === 0 ? null : (
                <div
                  aria-label="Attachments"
                  className="flex flex-wrap items-center gap-1.5 pt-1"
                >
                  <MailAttachmentList
                    accountId={thread.accountId}
                    attachments={visibleAttachments}
                  />
                  {hiddenAttachmentCount > 0 ? (
                    <Badge
                      className="bg-muted text-muted-foreground shrink-0"
                      variant="secondary"
                    >
                      <span aria-hidden="true">+{hiddenAttachmentCount}</span>
                      <span className="sr-only">
                        {hiddenAttachmentCount} more attachments
                      </span>
                    </Badge>
                  ) : null}
                </div>
              )}
            </ItemContent>
            <ItemActions className="pointer-events-none relative z-10 gap-1.5 self-start pt-0.5">
              {thread.isUnread ? (
                <span
                  aria-hidden="true"
                  className="bg-primary size-1.5 shrink-0 rounded-full"
                />
              ) : null}
              <MailDate
                className={
                  thread.isUnread
                    ? "text-foreground text-xs font-medium"
                    : "text-muted-foreground text-xs"
                }
                timestamp={thread.latestAt}
                tooltip={false}
              />
            </ItemActions>
          </Item>
        </MailListCell>
        <MailThreadQuickActions
          hotkeysEnabled={isSelected}
          isRevealed={areQuickActionsRevealed}
          isUnread={thread.isUnread}
          name={getThreadControlName(thread, showAccount)}
          subject={thread.subject}
          onDeleteForever={bindThreadAction(onDeleteForever, thread)}
          onNotSpam={handleNotSpam}
          onToggleRead={bindThreadAction(onToggleRead, thread)}
          onTrash={bindThreadAction(onTrash, thread)}
        />
      </m.div>
    </MailListRow>
  );
};

// The list renders outside React Compiler (see thread-list.tsx), so rows are
// memoized explicitly to skip renders when only the scroll range changed.
export default memo(MailThreadItem);
