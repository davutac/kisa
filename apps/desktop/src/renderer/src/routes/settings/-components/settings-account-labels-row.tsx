import { LoaderCircleIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmMessage, useConfirm } from "@/components/confirm-dialog";
import LabelDialog from "@/components/mail/label-dialog";
import MailLabelBadge from "@/components/mail/mail-label-badge";
import MailRelativeTime from "@/components/mail/relative-time";
import { Button } from "@/components/ui/button";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import { listUserGmailLabels } from "@/mail/label";
import type { MailApi } from "@/platform/desktop";
import type { GmailLabelSummary } from "@/shared/ipc/mail";
import {
  useGmailLabelCatalog,
  useUpsertGmailLabel,
  useUpdateGmailLabelCatalog,
} from "@/state/gmail-labels";

interface SettingsAccountLabelsRowProps {
  accountId: string;
  mailApi: MailApi;
}

type LabelDialogState =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly label: GmailLabelSummary };

const SettingsAccountLabelsRow = ({
  accountId,
  mailApi,
}: SettingsAccountLabelsRowProps) => {
  const confirm = useConfirm();
  const [deletingLabelId, setDeletingLabelId] = useState<string>();
  const [isSyncing, setIsSyncing] = useState(false);
  const [labelDialog, setLabelDialog] = useState<LabelDialogState>();
  const catalog = useGmailLabelCatalog(accountId);
  const upsertLabel = useUpsertGmailLabel();
  const updateLabelCatalog = useUpdateGmailLabelCatalog();

  const handleSync = async (): Promise<void> => {
    setIsSyncing(true);

    try {
      const reply = await mailApi.syncLabels({ accountId });

      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }

      updateLabelCatalog(accountId, reply.data);
      toast.success("Gmail labels synced");
    } catch {
      toast.error("Could not sync the labels", {
        description: "Please try again.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const requestDelete = async (label: GmailLabelSummary): Promise<void> => {
    if (deletingLabelId !== undefined) {
      return;
    }

    setDeletingLabelId(label.id);

    try {
      // Gmail's per-label totals are remote metadata. Refresh immediately
      // before confirmation so a partial or stale local index cannot misstate
      // how many conversations will be affected.
      const syncReply = await mailApi.syncLabels({ accountId });

      if (!syncReply.ok) {
        toast.error(syncReply.error);
        return;
      }

      updateLabelCatalog(accountId, syncReply.data);

      const refreshedLabel = syncReply.data.labels.find(
        (candidate) => candidate.id === label.id
      );

      if (refreshedLabel === undefined) {
        toast.error(`“${label.name}” no longer exists`);
        return;
      }

      const threadCount = refreshedLabel.threadCount ?? 0;
      const confirmed = await confirm({
        confirmLabel: "Delete label",
        confirmVariant: "destructive",
        description: (
          <ConfirmMessage subject={refreshedLabel.name}>
            {threadCount} thread{threadCount === 1 ? " has" : "s have"} this
            label. Deleting it removes the label from those threads and from
            Gmail. This action is not reversible.
          </ConfirmMessage>
        ),
        title: "Delete label?",
      });

      if (!confirmed) {
        return;
      }

      const deleteReply = await mailApi.deleteLabel({
        accountId,
        labelId: refreshedLabel.id,
      });

      if (!deleteReply.ok) {
        toast.error(deleteReply.error);
        return;
      }

      const next = {
        ...syncReply.data,
        labels: syncReply.data.labels.filter(
          (candidate) => candidate.id !== refreshedLabel.id
        ),
      };
      updateLabelCatalog(accountId, next);
      toast.success(`Deleted “${refreshedLabel.name}”`);
    } catch {
      toast.error("Could not delete the label", {
        description: "Please try again.",
      });
    } finally {
      setDeletingLabelId(undefined);
    }
  };

  const labels = listUserGmailLabels(catalog?.labels ?? []);

  return (
    <>
      <SettingsRow>
        <SettingsRowContent>
          <SettingsRowTitle>Labels</SettingsRowTitle>
          <SettingsRowDescription>
            {catalog === undefined
              ? "Loading labels…"
              : `${labels.length} label${labels.length === 1 ? "" : "s"} of your own`}
            {catalog?.syncedAt === undefined ? null : (
              <>
                {" · synced "}
                <MailRelativeTime timestamp={catalog.syncedAt} />
              </>
            )}
          </SettingsRowDescription>
          <div className="flex flex-wrap items-center gap-1 pt-1">
            {labels.map((label) => (
              <MailLabelBadge
                className="max-w-48"
                color={label.color}
                disabled={deletingLabelId !== undefined || isSyncing}
                isRemoving={deletingLabelId === label.id}
                key={label.id}
                label={label.name}
                onClick={() => {
                  setLabelDialog({ kind: "edit", label });
                }}
                onClickAriaLabel={`Edit ${label.name}`}
                onRemove={() => {
                  void requestDelete(label);
                }}
                removeAriaLabel={`Delete ${label.name}`}
              />
            ))}
          </div>
        </SettingsRowContent>
        <SettingsRowActions>
          <Button
            aria-label={`Create label for ${accountId}`}
            disabled={
              catalog === undefined ||
              deletingLabelId !== undefined ||
              isSyncing
            }
            onClick={() => {
              setLabelDialog({ kind: "create" });
            }}
            size="icon"
            title="Create label"
            type="button"
            variant="secondary"
          >
            <PlusIcon />
          </Button>
          <Button
            aria-label={`Sync labels for ${accountId}`}
            disabled={isSyncing || deletingLabelId !== undefined}
            onClick={() => {
              void handleSync();
            }}
            type="button"
            variant="secondary"
          >
            {isSyncing ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <RefreshCwIcon />
            )}
            <span>Sync</span>
          </Button>
        </SettingsRowActions>
      </SettingsRow>
      {catalog === undefined ? null : (
        <LabelDialog
          accountId={accountId}
          existingLabels={catalog.labels}
          isOpen={labelDialog !== undefined}
          key={labelDialog?.kind === "edit" ? labelDialog.label.id : "create"}
          label={labelDialog?.kind === "edit" ? labelDialog.label : undefined}
          mailApi={mailApi}
          onOpenChange={(open) => {
            if (!open) {
              setLabelDialog(undefined);
            }
          }}
          onSaved={(label) => {
            upsertLabel(accountId, label);
          }}
        />
      )}
    </>
  );
};

export default SettingsAccountLabelsRow;
