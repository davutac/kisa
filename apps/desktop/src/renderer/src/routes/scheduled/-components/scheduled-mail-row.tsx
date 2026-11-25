import {
  AlertTriangleIcon,
  ArchiveRestoreIcon,
  LoaderCircleIcon,
  Trash2Icon,
} from "lucide-react";
import { m, useIsPresent, useReducedMotionConfig } from "motion/react";
import { useState } from "react";

import { MailAttachmentSummaryPill } from "@/components/mail/attachment-pill";
import MailDate from "@/components/mail/mail-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import { quietDestructiveClassName } from "@/lib/action-hierarchy";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatExactMailDate, formatMailDate } from "@/mail/mail-date";
import {
  MailListActions,
  MailListCell,
  MailListOpen,
  MailListRow,
} from "@/primitives/mail-list";
import {
  getScheduledMailAttentionCopy,
  getScheduledMailKey,
  getScheduledRecipientSummary,
} from "@/scheduled/scheduled-mail-view";
import type { ScheduledMailSummary } from "@/shared/ipc/scheduled-mail";

const SCHEDULED_MAIL_QUICK_ACTION_WIDTH = 48;
const VISIBLE_ATTACHMENT_COUNT = 3;

const quickActionVariants = {
  idle: { opacity: 0 },
  revealed: { opacity: 1 },
};

const getDeliveryNotice = (
  item: ScheduledMailSummary,
  calendar: Calendar
): string | null => {
  if (item.deliveryState === "attention") {
    return getScheduledMailAttentionCopy(item.attentionReason);
  }

  if (item.deliveryState === "retrying") {
    return item.nextAttemptAt === undefined
      ? "Retrying delivery"
      : `Retrying · next attempt: ${formatMailDate(item.nextAttemptAt, calendar, "detailed")}`;
  }

  return item.deliveryState === "sending" ? "Sending…" : null;
};

const StatusIcon = ({ item }: { readonly item: ScheduledMailSummary }) => {
  if (item.deliveryState === "attention") {
    return (
      <AlertTriangleIcon
        aria-hidden="true"
        className="text-destructive size-3.5"
      />
    );
  }

  if (item.deliveryState === "sending" || item.deliveryState === "retrying") {
    return (
      <LoaderCircleIcon
        aria-hidden="true"
        className="size-3.5 animate-spin motion-reduce:animate-none"
      />
    );
  }

  return null;
};

const ScheduledMailQuickAction = ({
  disabled,
  isRevealed,
  onCancel,
  onDiscard,
  subject,
}: {
  readonly disabled: boolean;
  readonly isRevealed: boolean;
  readonly onCancel: () => void;
  readonly onDiscard: () => void;
  readonly subject: string;
}) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const cancelDisplay = getHotkeyDisplay("scheduled.cancel");
  const discardDisplay = getHotkeyDisplay("scheduled.discard");

  return (
    // Like mailbox thread actions, this stays parked behind the opaque row.
    // `inert` keeps its covered button out of the focus order.
    <MailListActions
      className="bg-card absolute inset-y-0 right-0 z-0 grid w-15 grid-cols-[60px] grid-rows-2 overflow-hidden"
      inert={!isRevealed}
      render={
        <m.div
          animate={isRevealed ? "revealed" : "idle"}
          initial={false}
          transition={
            shouldReduceMotion ? NO_MOTION : { ...easeInOut(0.18), delay: 0.05 }
          }
          variants={quickActionVariants}
        />
      }
    >
      <Button
        aria-keyshortcuts={getHotkeyAriaLabel("scheduled.cancel")}
        aria-label={`Cancel schedule for ${subject} and move it to Stash`}
        className="text-muted-foreground hover:bg-muted/60 hover:text-foreground h-auto w-full min-w-0 rounded-none pl-3"
        disabled={disabled}
        onClick={onCancel}
        size="icon"
        title={`Cancel schedule and move to Stash (${cancelDisplay.bindings[0]})`}
        type="button"
        variant="ghost"
      >
        <ArchiveRestoreIcon />
      </Button>
      <Button
        aria-keyshortcuts={getHotkeyAriaLabel("scheduled.discard")}
        aria-label={`Discard scheduled email: ${subject}`}
        className={cn(
          "text-muted-foreground h-auto w-full min-w-0 rounded-none pl-3",
          quietDestructiveClassName
        )}
        disabled={disabled}
        onClick={onDiscard}
        size="icon"
        title={`Discard scheduled email (${discardDisplay.bindings[0]})`}
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </MailListActions>
  );
};

const ScheduledMailDetails = ({
  deliveryNotice,
  item,
  recipientLabel,
  subject,
}: {
  readonly deliveryNotice: string | null;
  readonly item: ScheduledMailSummary;
  readonly recipientLabel: string;
  readonly subject: string;
}) => {
  const visibleAttachments = item.attachments.slice(
    0,
    VISIBLE_ATTACHMENT_COUNT
  );

  const hiddenAttachmentCount =
    item.attachments.length - visibleAttachments.length;

  return (
    <ItemContent className="pointer-events-none relative z-10 min-w-0 gap-1">
      <ItemHeader className="min-w-0 flex-wrap justify-start gap-x-4 gap-y-1">
        <ItemTitle
          className="max-w-full min-w-0 gap-1.5 overflow-hidden text-xs"
          title={`To ${recipientLabel}`}
        >
          <span className="text-muted-foreground shrink-0">To</span>
          <span className="text-foreground/80 min-w-0 truncate">
            {recipientLabel}
          </span>
        </ItemTitle>
        <ItemTitle
          className="max-w-full min-w-0 gap-1.5 overflow-hidden text-xs"
          title={`From ${item.accountId}`}
        >
          <span className="text-muted-foreground shrink-0">From</span>
          <span className="text-foreground/80 min-w-0 truncate">
            {item.accountId}
          </span>
        </ItemTitle>
      </ItemHeader>
      <ItemTitle className="text-foreground/80 min-w-0 truncate text-sm font-normal">
        {subject}
      </ItemTitle>
      {item.preview.length === 0 ? null : (
        <ItemDescription className="line-clamp-1 text-sm">
          {item.preview}
        </ItemDescription>
      )}
      {visibleAttachments.length === 0 ? null : (
        <div
          aria-label="Attachments"
          className="flex flex-wrap items-center gap-1.5 pt-1"
        >
          {visibleAttachments.map((attachment, index) => (
            <MailAttachmentSummaryPill
              attachment={attachment}
              key={`${attachment.filename}:${attachment.mediaType}:${index}`}
            />
          ))}
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
      {deliveryNotice === null ? null : (
        <div
          className={cn(
            "text-muted-foreground flex items-center gap-1.5 pt-1 text-xs",
            item.deliveryState === "attention" && "text-destructive"
          )}
        >
          <StatusIcon item={item} />
          {deliveryNotice}
        </div>
      )}
    </ItemContent>
  );
};

interface ScheduledMailRowProps {
  readonly item: ScheduledMailSummary;
  readonly onCancel: (item: ScheduledMailSummary) => void;
  readonly onDiscard: (item: ScheduledMailSummary) => void;
  readonly onOpen: (item: ScheduledMailSummary) => void;
  readonly quickActionResetRevision: number;
  readonly selected: boolean;
  readonly top: number;
}

const ScheduledMailRow = ({
  item,
  onCancel,
  onDiscard,
  onOpen,
  quickActionResetRevision,
  selected,
  top,
}: ScheduledMailRowProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const isPresent = useIsPresent();

  const [hoveredAtRevision, setHoveredAtRevision] = useState<number | null>(
    null
  );

  const isHovered = hoveredAtRevision === quickActionResetRevision;
  // The visible date, its tooltip, and the spoken summary all read the same
  // calendar, so a time-zone change while Scheduled is open moves them
  // together.
  const calendar = useCalendar();
  const scheduledLabel = formatExactMailDate(item.scheduledAt, calendar);
  const timeZoneLabel = calendar.timeZone ?? "local time";
  const recipientLabel = getScheduledRecipientSummary(item.recipients);
  const subject = item.subject.trim() || "No subject";
  const deliveryNotice = getDeliveryNotice(item, calendar);

  const deliverySummary =
    deliveryNotice === null
      ? `Scheduled for ${scheduledLabel}`
      : `${deliveryNotice}, scheduled for ${scheduledLabel}`;

  const canOpen = item.deliveryState !== "sending";
  const areQuickActionsRevealed = selected || isHovered;

  return (
    // A row fading out after main canceled or discarded it is inert, so a
    // second press can't ask again.
    <MailListRow
      className="border-border/60 absolute left-0 w-full border-b"
      inert={!isPresent}
      render={
        <m.div
          animate={shouldReduceMotion ? undefined : { opacity: 1 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0 }}
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          layout={shouldReduceMotion ? false : "position"}
          layoutId={
            shouldReduceMotion
              ? undefined
              : `scheduled-mail:${getScheduledMailKey(item)}`
          }
          transition={{
            layout: easeInOut(0.24),
            opacity: easeInOut(0.16),
          }}
        />
      }
      style={{ top }}
      value={getScheduledMailKey(item)}
    >
      <m.div
        className="relative"
        initial={false}
        onHoverEnd={() => {
          setHoveredAtRevision(null);
        }}
        onHoverStart={() => {
          setHoveredAtRevision(quickActionResetRevision);
        }}
      >
        <MailListCell
          className="bg-background relative z-10"
          render={
            <m.div
              animate={{
                marginRight: areQuickActionsRevealed
                  ? SCHEDULED_MAIL_QUICK_ACTION_WIDTH
                  : 0,
              }}
              initial={false}
              transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.26)}
            />
          }
        >
          <Item
            className={cn(
              "data-[active=true]:bg-muted/60 relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 rounded-none border-0 px-4 py-3",
              item.deliveryState === "attention" &&
                !(selected || isHovered) &&
                "bg-[color-mix(in_oklch,var(--card)_95%,var(--destructive))]"
            )}
            data-active={selected || isHovered}
            data-selected={selected}
            render={<article />}
          >
            <MailListOpen
              aria-disabled={!canOpen}
              aria-label={`Edit scheduled email: ${subject}, from ${item.accountId}, to ${recipientLabel}, ${deliverySummary}`}
              className="absolute inset-0 text-left outline-none"
            />
            <ScheduledMailDetails
              deliveryNotice={deliveryNotice}
              item={item}
              recipientLabel={recipientLabel}
              subject={subject}
            />
            <ItemActions
              className="relative z-10 self-start pt-0.5"
              onClick={() => {
                if (canOpen) {
                  onOpen(item);
                }
              }}
            >
              <MailDate
                className="text-muted-foreground text-xs"
                exactDateLabel={`${scheduledLabel} (${timeZoneLabel})`}
                timestamp={item.scheduledAt}
                variant="detailed"
              />
            </ItemActions>
          </Item>
        </MailListCell>
        <ScheduledMailQuickAction
          disabled={item.deliveryState === "sending"}
          isRevealed={areQuickActionsRevealed}
          onCancel={() => onCancel(item)}
          onDiscard={() => onDiscard(item)}
          subject={subject}
        />
      </m.div>
    </MailListRow>
  );
};

export default ScheduledMailRow;
