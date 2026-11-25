import { useRef, useState } from "react";

import MailLabelBadges from "@/components/mail/label-badges";
import LabelDialog from "@/components/mail/label-dialog";
import ThreadCategorizeButton from "@/components/mail/thread-categorize-button";
import ThreadLabelPicker from "@/components/mail/thread-label-picker";
import { Badge } from "@/components/ui/badge";
import { createMenuController } from "@/components/ui/menu";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { useAppCommand } from "@/hotkeys";
import { cn } from "@/lib/utils";
import { listUserLabels } from "@/mail/label";
import {
  getPendingLabelIds,
  usePendingThreadChanges,
} from "@/mail/pending-thread-changes";
import type {
  ThreadActions,
  ThreadLabelChange,
} from "@/mail/use-thread-actions";
import { getMailApi } from "@/platform/desktop";
import { useLabelCatalog, useUpsertLabel } from "@/state/labels";

interface ThreadLabelsProps {
  accountId: string;
  /** Shapes the row to its place in the conversation's stack of cards. */
  className?: string;
  labels: readonly string[];
  onSetLabel: ThreadActions["setLabel"];
  threadId: string;
}

const ThreadLabels = ({
  accountId,
  className,
  labels,
  onSetLabel,
  threadId,
}: ThreadLabelsProps) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const picker = useInstanceValue(createMenuController);
  const pendingChanges = usePendingThreadChanges();
  const catalog = useLabelCatalog(accountId);
  const mailApi = getMailApi();
  const upsertLabel = useUpsertLabel();
  const userLabels = listUserLabels(catalog?.labels ?? []);
  const userLabelsByName = new Map(
    userLabels.map((label) => [label.name, label] as const)
  );

  // `labels` already shows changes still on their way to the server; a label
  // with one pending waits for it before it can be changed again.
  const pendingLabelIds = getPendingLabelIds(
    { accountId, threadId },
    pendingChanges
  );

  useAppCommand(
    "thread.manageLabels",
    () => {
      rowRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
      void picker.open({ focus: "first" });
    },
    { enabled: !isPickerOpen }
  );

  const setLabel = (label: ThreadLabelChange): void => {
    onSetLabel({ accountId, threadId }, label);
  };

  return (
    <div
      className={cn(
        "no-scrollbar bg-card flex min-w-0 scroll-mt-20 items-center gap-1 overflow-x-auto overscroll-x-contain p-4",
        className
      )}
      ref={rowRef}
    >
      <MailLabelBadges
        accountId={accountId}
        empty={
          <Badge
            className="border-muted-foreground/30 text-muted-foreground h-5 border-dashed bg-transparent"
            variant="outline"
          >
            No labels
          </Badge>
        }
        labels={labels}
        onRemoveLabel={(labelName) => {
          const label = userLabelsByName.get(labelName);

          if (label !== undefined) {
            setLabel({
              applied: false,
              labelId: label.id,
              labelName: label.name,
            });
          }
        }}
        removableLabels={new Set(userLabelsByName.keys())}
      />
      <ThreadLabelPicker
        appliedLabels={labels}
        controller={picker}
        isOpen={isPickerOpen}
        isLoading={catalog === undefined}
        labels={userLabels}
        onCreateLabel={
          catalog === undefined || mailApi === undefined
            ? undefined
            : () => {
                setIsCreateDialogOpen(true);
              }
        }
        onOpenChange={setIsPickerOpen}
        onSetLabel={setLabel}
        pendingLabelIds={pendingLabelIds}
      />
      <ThreadCategorizeButton accountId={accountId} threadId={threadId} />
      {catalog === undefined || mailApi === undefined ? null : (
        <LabelDialog
          accountId={accountId}
          existingLabels={catalog.labels}
          isOpen={isCreateDialogOpen}
          mailApi={mailApi}
          onSaved={(label) => {
            upsertLabel(accountId, label);
            setLabel({
              applied: true,
              labelId: label.id,
              labelName: label.name,
            });
          }}
          onOpenChange={setIsCreateDialogOpen}
        />
      )}
    </div>
  );
};

export default ThreadLabels;
