import {
  AlertTriangleIcon,
  ArchiveRestoreIcon,
  LoaderCircleIcon,
  Trash2Icon,
} from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";
import { useState } from "react";
import type { CSSProperties, Ref } from "react";

import { MailAttachmentSummaryPill } from "@/components/mail/attachment-pill";
import MailRelativeTime from "@/components/mail/relative-time";
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
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatScheduledAt, LOCAL_TIME_ZONE } from "@/scheduled/schedule-time";
import {
  getScheduledMailAttentionCopy,
  getScheduledRecipientSummary,
} from "@/scheduled/scheduled-mail-view";
import type { ScheduledMailSummary } from "@/shared/ipc/scheduled-mail";

const SCHEDULED_MAIL_QUICK_ACTION_WIDTH = 48;
const VISIBLE_ATTACHMENT_COUNT = 3;

const quickActionVariants = {
  idle: { opacity: 0 },
  revealed: { opacity: 1 },
};

const getDeliveryNotice = (item: ScheduledMailSummary): string | null => {
  if (item.deliveryState === "attention") {
    return getScheduledMailAttentionCopy(item.attentionReason);
  }
  if (item.deliveryState === "retrying") {
    return item.nextAttemptAt === undefined
      ? "Retrying delivery"
      : `Retrying ${formatScheduledAt(item.nextAttemptAt)}`;
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
    <m.div
      animate={isRevealed ? "revealed" : "idle"}
      className="bg-card absolute inset-y-0 right-0 z-0 grid w-15 grid-cols-[60px] grid-rows-2 overflow-hidden rounded-r-md"
      data-slot="scheduled-mail-quick-action"
      inert={!isRevealed}
      initial={false}
      transition={
        shouldReduceMotion ? NO_MOTION : { ...easeInOut(0.18), delay: 0.05 }
      }
      variants={quickActionVariants}
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
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive h-auto w-full min-w-0 rounded-none pl-3"
        disabled={disabled}
        onClick={onDiscard}
        size="icon"
        title={`Discard scheduled email (${discardDisplay.bindings[0]})`}
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </m.div>
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
          <span className="min-w-0 truncate font-medium">{recipientLabel}</span>
        </ItemTitle>
        <ItemTitle
          className="max-w-full min-w-0 gap-1.5 overflow-hidden text-xs"
          title={`From ${item.accountId}`}
        >
          <span className="text-muted-foreground shrink-0">From</span>
          <span className="min-w-0 truncate font-medium">{item.accountId}</span>
        </ItemTitle>
      </ItemHeader>
      <ItemTitle className="text-foreground/90 min-w-0 truncate text-sm font-medium">
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
              aria-label={`${hiddenAttachmentCount} more attachments`}
              className="bg-muted text-muted-foreground shrink-0"
              variant="secondary"
            >
              +{hiddenAttachmentCount}
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
  readonly measureElement: (element: HTMLLIElement | null) => void;
  readonly onCancel: (item: ScheduledMailSummary) => void;
  readonly onDiscard: (item: ScheduledMailSummary) => void;
  readonly onOpen: (item: ScheduledMailSummary) => void;
  readonly position: number;
  readonly quickActionResetRevision: number;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly selected: boolean;
  readonly setSize: number;
  readonly style?: CSSProperties;
  readonly virtualIndex: number;
}

const ScheduledMailRow = ({
  item,
  measureElement,
  onCancel,
  onDiscard,
  onOpen,
  position,
  quickActionResetRevision,
  ref,
  selected,
  setSize,
  style,
  virtualIndex,
}: ScheduledMailRowProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const [hoveredAtRevision, setHoveredAtRevision] = useState<number | null>(
    null
  );
  const isHovered = hoveredAtRevision === quickActionResetRevision;
  const scheduledLabel = formatScheduledAt(item.scheduledAt);
  const recipientLabel = getScheduledRecipientSummary(item.recipients);
  const subject = item.subject.trim() || "No subject";
  const deliveryNotice = getDeliveryNotice(item);
  const deliverySummary =
    deliveryNotice === null
      ? `Scheduled for ${scheduledLabel}`
      : `${deliveryNotice}, scheduled for ${scheduledLabel}`;
  const canOpen = item.deliveryState !== "sending";
  const areQuickActionsRevealed = selected || isHovered;

  return (
    <li
      aria-posinset={position}
      aria-setsize={setSize}
      className="absolute top-0 left-0 w-full pb-px"
      data-index={virtualIndex}
      ref={measureElement}
      style={style}
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
        <ScheduledMailQuickAction
          disabled={item.deliveryState === "sending"}
          isRevealed={areQuickActionsRevealed}
          onCancel={() => onCancel(item)}
          onDiscard={() => onDiscard(item)}
          subject={subject}
        />
        <m.div
          animate={{
            marginRight: areQuickActionsRevealed
              ? SCHEDULED_MAIL_QUICK_ACTION_WIDTH
              : 0,
          }}
          className="bg-background relative z-10 rounded-md"
          initial={false}
          transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.26)}
        >
          <Item
            className={cn(
              "data-[active=true]:bg-muted/60 relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 border-0 px-4 py-3 opacity-60 data-[active=true]:opacity-100",
              item.deliveryState === "attention" &&
                !(selected || isHovered) &&
                "bg-[color-mix(in_oklch,var(--card)_95%,var(--destructive))]"
            )}
            data-active={selected || isHovered}
            data-selected={selected}
            render={<article />}
          >
            <button
              aria-current={selected ? "true" : undefined}
              aria-disabled={!canOpen}
              aria-label={`Edit scheduled email: ${subject}, from ${item.accountId}, to ${recipientLabel}, ${deliverySummary}`}
              className="absolute inset-0 rounded-md text-left outline-none"
              onClick={() => {
                if (canOpen) {
                  onOpen(item);
                }
              }}
              ref={ref}
              type="button"
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
              <MailRelativeTime
                className="text-muted-foreground text-xs"
                exactDateLabel={`${scheduledLabel} (${LOCAL_TIME_ZONE})`}
                timestamp={item.scheduledAt}
              />
            </ItemActions>
          </Item>
        </m.div>
      </m.div>
    </li>
  );
};

export default ScheduledMailRow;
