import type { HTMLMotionProps } from "motion/react";
import { m, useReducedMotion } from "motion/react";
import { useState } from "react";

import MailAttachmentList from "@/components/mail/attachment-list";
import MailLabelBadges from "@/components/mail/label-badges";
import MailRelativeTime from "@/components/mail/relative-time";
import MailThreadQuickActions, {
  MAIL_THREAD_QUICK_ACTIONS_WIDTH,
} from "@/components/mail/thread-quick-actions";
import { Badge } from "@/components/ui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemHeader,
  ItemTitle,
} from "@/components/ui/item";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { parseMailboxAddress } from "@/mail/address";
import type { GmailThreadSummary } from "@/shared/ipc/mail";

const VISIBLE_ATTACHMENT_COUNT = 3;

const rowVariants = {
  idle: { marginRight: 0 },
  revealed: { marginRight: MAIL_THREAD_QUICK_ACTIONS_WIDTH },
};

interface MailThreadItemProps extends Omit<HTMLMotionProps<"li">, "children"> {
  isSelected?: boolean;
  onOpen: (thread: GmailThreadSummary) => void;
  onNotSpam?: (thread: GmailThreadSummary) => void;
  onToggleRead?: (thread: GmailThreadSummary) => void;
  onTrash?: (thread: GmailThreadSummary) => void;
  position: number;
  setSize: number;
  showAccount?: boolean;
  thread: GmailThreadSummary;
}

const bindThreadAction = (
  action: ((thread: GmailThreadSummary) => void) | undefined,
  thread: GmailThreadSummary
): (() => void) | undefined => action?.bind(undefined, thread);

const MailThreadItem = ({
  isSelected = false,
  onOpen,
  onNotSpam,
  onToggleRead,
  onTrash,
  position,
  setSize,
  showAccount = false,
  thread,
  ...props
}: MailThreadItemProps) => {
  const shouldReduceMotion = useReducedMotion();
  const [isHovered, setIsHovered] = useState(false);
  // Hovering the uncovered strip still counts as hovering the row, so the
  // actions cannot be chased away by the pointer that is reaching for them.
  const isRevealed = isSelected || isHovered;
  const revealTransition = shouldReduceMotion ? NO_MOTION : easeInOut(0.26);
  const senderMailbox = parseMailboxAddress(thread.from);
  const visibleAttachments = thread.attachments.slice(
    0,
    VISIBLE_ATTACHMENT_COUNT
  );
  const hiddenAttachmentCount =
    thread.attachments.length - visibleAttachments.length;
  const handleNotSpam = bindThreadAction(onNotSpam, thread);

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
      {...props}
    >
      <m.div
        animate={isRevealed ? "revealed" : "idle"}
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
          isRevealed={isRevealed}
          isUnread={thread.isUnread}
          onNotSpam={handleNotSpam}
          onToggleRead={() => {
            onToggleRead?.(thread);
          }}
          onTrash={() => {
            onTrash?.(thread);
          }}
        />
        {/* Opaque, so the row hides the panel edge it overlaps. */}
        <m.div
          className="bg-background relative z-10 rounded-md"
          transition={revealTransition}
          variants={rowVariants}
        >
          <Item
            className={cn(
              "data-[active=true]:bg-muted/60 relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 border-0 px-4 py-3 data-[active=true]:opacity-100",
              thread.isUnread ? "bg-muted/30" : "opacity-60"
            )}
            data-active={isRevealed}
            data-selected={isSelected}
          >
            <button
              aria-current={isSelected}
              aria-label={`${thread.subject}, from ${thread.from}`}
              className="focus-visible:ring-ring/50 absolute inset-0 z-0 rounded-md text-left outline-none focus-visible:ring-[3px]"
              onClick={() => {
                onOpen(thread);
              }}
              type="button"
            />
            <ItemContent className="pointer-events-none relative z-10 min-w-0 gap-1">
              <ItemHeader className="min-w-0 flex-wrap justify-start gap-2">
                <ItemTitle
                  className="max-w-full min-w-0 gap-1.5 overflow-hidden text-xs"
                  title={thread.from}
                >
                  {senderMailbox?.name === undefined ? null : (
                    <span className="min-w-0 truncate font-medium">
                      {senderMailbox.name}
                    </span>
                  )}
                  <span className="text-muted-foreground min-w-0 truncate">
                    {senderMailbox.email}
                  </span>
                </ItemTitle>
                <MailLabelBadges
                  accountId={thread.accountId}
                  labels={thread.labels}
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
              <div className="flex min-w-0 items-center gap-1.5">
                <ItemTitle
                  className={cn(
                    "min-w-0 truncate text-sm",
                    thread.isUnread
                      ? "font-semibold"
                      : "text-foreground/90 font-medium"
                  )}
                >
                  {thread.subject}
                </ItemTitle>
                {thread.messageCount > 1 ? (
                  <Badge
                    aria-label={`${thread.messageCount} messages in this thread`}
                    className="h-5 px-2 text-[10px] tabular-nums"
                    title={`${thread.messageCount} messages`}
                    variant="secondary"
                  >
                    +{thread.messageCount} messages
                  </Badge>
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
            <ItemActions className="pointer-events-none relative z-10 self-start pt-0.5">
              <MailRelativeTime
                className={
                  thread.isUnread
                    ? "text-foreground text-xs font-medium"
                    : "text-muted-foreground text-xs"
                }
                timestamp={thread.latestAt}
              />
            </ItemActions>
          </Item>
        </m.div>
      </m.div>
    </m.li>
  );
};

export default MailThreadItem;
