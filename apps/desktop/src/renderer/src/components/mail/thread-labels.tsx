import { useRef, useState } from "react";

import MailLabelBadges from "@/components/mail/label-badges";
import ThreadLabelPicker from "@/components/mail/thread-label-picker";
import type { ThreadLabelChange } from "@/components/mail/thread-label-picker";
import { Badge } from "@/components/ui/badge";
import { useAppCommand } from "@/hotkeys";
import { listUserGmailLabels, withGmailLabelState } from "@/mail/label";
import type { ThreadActions } from "@/mail/use-thread-actions";
import { useGmailLabelCatalog } from "@/state/gmail-labels";

interface ThreadLabelsProps {
  accountId: string;
  labels: readonly string[];
  onSetLabel: ThreadActions["setLabel"];
  threadId: string;
}

interface OptimisticLabelState {
  readonly applied: boolean;
  readonly labelName: string;
  readonly requestId: number;
}

const ThreadLabels = ({
  accountId,
  labels,
  onSetLabel,
  threadId,
}: ThreadLabelsProps) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [optimisticLabels, setOptimisticLabels] = useState<
    ReadonlyMap<string, OptimisticLabelState>
  >(new Map());
  const nextRequestIdRef = useRef(0);
  const catalog = useGmailLabelCatalog(accountId);
  const userLabels = listUserGmailLabels(catalog ?? []);
  const userLabelsByName = new Map(
    userLabels.map((label) => [label.name, label] as const)
  );

  let displayedLabels = labels;

  for (const state of optimisticLabels.values()) {
    displayedLabels = withGmailLabelState(
      displayedLabels,
      state.labelName,
      state.applied
    );
  }

  const pendingLabelIds = new Set(optimisticLabels.keys());

  useAppCommand(
    "thread.manageLabels",
    () => {
      rowRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
      setIsPickerOpen(true);
    },
    { enabled: !isPickerOpen }
  );

  const setLabel = async (label: ThreadLabelChange): Promise<void> => {
    const requestId = nextRequestIdRef.current + 1;
    nextRequestIdRef.current = requestId;
    setOptimisticLabels(
      (current) =>
        new Map([...current, [label.labelId, { ...label, requestId }]])
    );

    await onSetLabel(
      { accountId, threadId },
      { applied: label.applied, labelId: label.labelId }
    );
    setOptimisticLabels((current) => {
      if (current.get(label.labelId)?.requestId !== requestId) {
        return current;
      }

      const next = new Map(current);
      next.delete(label.labelId);
      return next;
    });
  };

  return (
    <div
      className="no-scrollbar bg-card flex min-w-0 scroll-mt-20 items-center gap-1 overflow-x-auto overscroll-x-contain p-4"
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
        labels={displayedLabels}
        onRemoveLabel={(labelName) => {
          const label = userLabelsByName.get(labelName);

          if (label !== undefined) {
            void setLabel({
              applied: false,
              labelId: label.id,
              labelName: label.name,
            });
          }
        }}
        removableLabels={new Set(userLabelsByName.keys())}
      />
      <ThreadLabelPicker
        appliedLabels={displayedLabels}
        isOpen={isPickerOpen}
        isLoading={catalog === undefined}
        labels={userLabels}
        onOpenChange={setIsPickerOpen}
        onSetLabel={(label) => {
          void setLabel(label);
        }}
        pendingLabelIds={pendingLabelIds}
      />
    </div>
  );
};

export default ThreadLabels;
