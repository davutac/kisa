import { MessagesSquareIcon, SendIcon } from "lucide-react";
import type { HTMLMotionProps } from "motion/react";
import { m, useReducedMotionConfig } from "motion/react";
import { memo, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";

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
import type { GmailThreadSummary } from "@/shared/ipc/mail";

const VISIBLE_ATTACHMENT_COUNT = 3;

interface MailThreadItemProps extends Omit<
  HTMLMotionProps<"li">,
  "children" | "style"
> {
  hasCheckedThreads?: boolean;
  isChecked?: boolean;
  isSelected?: boolean;
  /** The listed mailbox's own system label, which every row would repeat. */
  mailboxLabel?: string;
  onDeleteForever?: (thread: GmailThreadSummary) => void;
  onOpen: (
    thread: GmailThreadSummary,
    event: MouseEvent<HTMLButtonElement>
  ) => void;
  onRowPointerDown: (
    thread: GmailThreadSummary,
    event: PointerEvent<HTMLButtonElement>
  ) => void;
  onSelectionPointerDown: (
    thread: GmailThreadSummary,
    event: PointerEvent
  ) => void;
  onSelectionPointerEnter: (thread: GmailThreadSummary) => void;
  onNotSpam?: (thread: GmailThreadSummary) => void;
  onToggleRead?: (thread: GmailThreadSummary) => void;
  onToggleSelection: (thread: GmailThreadSummary) => void;
  onTrash?: (thread: GmailThreadSummary) => void;
  position: number;
  setSize: number;
  showAccount?: boolean;
  thread: GmailThreadSummary;
  /** Virtual row offset, passed as a number so memoized rows compare equal. */
  top: number;
}

const getThreadRowLabel = (
  thread: GmailThreadSummary,
  calendar: Calendar
): string =>
  [
    thread.subject,
    `from ${thread.from}`,
    formatMailDate(thread.latestAt, calendar, "detailed"),
    thread.isUnread ? "unread" : undefined,
    thread.messageCount > 1 ? `${thread.messageCount} messages` : undefined,
    hasSentLabel(thread.labels) ? "sent" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(", ");

const bindThreadAction = (
  action: ((thread: GmailThreadSummary) => void) | undefined,
  thread: GmailThreadSummary
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
  onPointerDown,
  onToggle,
  subject,
}: {
  isChecked: boolean;
  isRevealed: boolean;
  onPointerDown: (event: PointerEvent) => void;
  onToggle: () => void;
  subject: string;
}) => {
  const shouldReduceMotion = useReducedMotionConfig();

  return (
    <m.span
      initial={{
        marginRight: -8,
        opacity: 0,
        width: 0,
      }}
      animate={{
        marginRight: isRevealed ? 2 : -8,
        opacity: isRevealed ? 1 : 0,
        width: isRevealed ? 16 : 0,
      }}
      className="pointer-events-auto relative flex shrink-0 overflow-visible"
      inert={!isRevealed}
      transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.26)}
    >
      <Checkbox
        aria-label={`${isChecked ? "Deselect" : "Select"} ${subject}`}
        checked={isChecked}
        onCheckedChange={() => onToggle()}
        onClick={(event) => {
          event.stopPropagation();
          // Pointer-down toggles immediately for drag painting. Base UI still
          // handles synthesized keyboard and assistive activation.
          if (event.detail > 0) {
            event.preventDefault();
            event.preventBaseUIHandler();
          }
        }}
        onPointerDown={onPointerDown}
        tabIndex={isRevealed ? 0 : -1}
      />
    </m.span>
  );
};

const ThreadSenderHeader = ({
  isChecked,
  isSelectionRevealed,
  mailboxLabel,
  onSelectionPointerDown,
  onToggleSelection,
  showAccount,
  thread,
}: {
  isChecked: boolean;
  isSelectionRevealed: boolean;
  mailboxLabel?: string;
  onSelectionPointerDown: (event: PointerEvent) => void;
  onToggleSelection: () => void;
  showAccount: boolean;
  thread: GmailThreadSummary;
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
        onPointerDown={onSelectionPointerDown}
        onToggle={onToggleSelection}
        subject={thread.subject}
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
          className="bg-muted text-muted-foreground ml-auto h-auto shrink-0 rounded-sm px-1.5 text-[10px] leading-none"
          variant="secondary"
        >
          {thread.accountId}
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
  onOpen,
  onRowPointerDown,
  onSelectionPointerDown,
  onSelectionPointerEnter,
  onNotSpam,
  onToggleRead,
  onToggleSelection,
  onTrash,
  position,
  setSize,
  showAccount = false,
  thread,
  top,
  ...props
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
    <m.li
      animate={shouldReduceMotion ? undefined : { opacity: 1 }}
      aria-posinset={position}
      aria-setsize={setSize}
      className="absolute left-0 w-full pb-px"
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
      onPointerEnter={() => {
        onSelectionPointerEnter(thread);
      }}
      style={{ top }}
      {...props}
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
        <MailThreadQuickActions
          hotkeysEnabled={isSelected}
          isRevealed={areQuickActionsRevealed}
          isUnread={thread.isUnread}
          onDeleteForever={bindThreadAction(onDeleteForever, thread)}
          onNotSpam={handleNotSpam}
          onToggleRead={bindThreadAction(onToggleRead, thread)}
          onTrash={bindThreadAction(onTrash, thread)}
        />
        {/* Opaque, so the row hides the panel edge it overlaps. */}
        <m.div
          animate={{
            marginRight: areQuickActionsRevealed ? quickActionsWidth : 0,
          }}
          className="bg-background relative z-10 rounded-md"
          initial={false}
          transition={revealTransition}
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
            <button
              aria-current={isSelected}
              aria-label={getThreadRowLabel(thread, calendar)}
              className="absolute inset-0 z-0 rounded-md text-left outline-none"
              onClick={(event) => {
                onOpen(thread, event);
              }}
              onPointerDown={(event) => {
                onRowPointerDown(thread, event);
              }}
              type="button"
            />
            <ItemContent className="pointer-events-none relative z-10 min-w-0 gap-1">
              <ThreadSenderHeader
                isChecked={isChecked}
                isSelectionRevealed={isActive}
                mailboxLabel={mailboxLabel}
                onSelectionPointerDown={(event) => {
                  onSelectionPointerDown(thread, event);
                }}
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
                      aria-label={`${hiddenAttachmentCount} more attachments`}
                      className="bg-muted text-muted-foreground shrink-0"
                      variant="secondary"
                    >
                      +{hiddenAttachmentCount}
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
        </m.div>
      </m.div>
    </m.li>
  );
};

// The list renders outside React Compiler (see thread-list.tsx), so rows are
// memoized explicitly to skip renders when only the scroll range changed.
export default memo(MailThreadItem);
