import { DownloadIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";

import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRows,
  SettingsRowTitle,
  SettingsSection,
  SettingsSectionHeader,
  SettingsSectionTitle,
} from "@/components/ui/settings";
import type { SettingsApi } from "@/platform/desktop";

import SettingsDatabaseImportDialog from "./settings-database-import-dialog";
import SettingsDatabasePendingImportRow from "./settings-database-pending-import-row";
import {
  DATABASE_IMPORT_PROGRESS_LABELS,
  useSettingsDatabase,
} from "./use-settings-database";

interface SettingsDatabaseSectionProps {
  settingsApi: SettingsApi;
}

const SettingsDatabaseSection = ({
  settingsApi,
}: SettingsDatabaseSectionProps) => {
  const confirm = useConfirm();
  const workflow = useSettingsDatabase(settingsApi);
  const handleExportRecoveryKey = workflow.exportRecoveryKey;
  const handleOpenImport = workflow.openImport;
  const { discardPendingImport, restartForPendingImport } = workflow;
  const importState = workflow.importStatus?.state;
  const handleDiscardPendingImport = async (): Promise<void> => {
    const confirmed = await confirm({
      cancelLabel: "Keep import",
      confirmLabel: "Discard import",
      confirmVariant: "destructive",
      description:
        "Kisa keeps using the current database. The file you imported from is not changed; import it again to use it.",
      title: "Discard the waiting import?",
    });
    if (confirmed) {
      await discardPendingImport();
    }
  };

  return (
    <>
      <SettingsDatabaseImportDialog {...workflow.dialog} />
      <SettingsSection aria-labelledby="database-settings-title">
        <SettingsSectionHeader>
          <SettingsSectionTitle id="database-settings-title">
            Database
          </SettingsSectionTitle>
        </SettingsSectionHeader>
        <SettingsRows>
          {workflow.importStatus?.state === "restart-pending" ? (
            <SettingsDatabasePendingImportRow
              onDiscard={() => {
                void handleDiscardPendingImport();
              }}
              onRestart={() => {
                void restartForPendingImport();
              }}
              pendingAction={workflow.pendingImportAction}
              restart={workflow.importStatus.restart}
            />
          ) : null}
          <SettingsRow>
            <SettingsRowContent>
              <SettingsRowTitle id="database-import-title">
                Import database
              </SettingsRowTitle>
              <SettingsRowDescription
                aria-live="polite"
                id="database-import-description"
              >
                {workflow.importProgress === undefined
                  ? "Restore an existing Kisa database using its recovery key"
                  : DATABASE_IMPORT_PROGRESS_LABELS[workflow.importProgress]}
              </SettingsRowDescription>
            </SettingsRowContent>
            <SettingsRowActions>
              <Button
                aria-describedby="database-import-description"
                aria-labelledby="database-import-title"
                disabled={
                  workflow.pendingAction !== undefined ||
                  workflow.pendingImportAction !== undefined ||
                  importState === "importing"
                }
                onClick={handleOpenImport}
                type="button"
                variant="secondary"
              >
                <UploadIcon />
                <span>Import</span>
              </Button>
            </SettingsRowActions>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowContent>
              <SettingsRowTitle id="database-recovery-key-title">
                Recovery key
              </SettingsRowTitle>
              <SettingsRowDescription id="database-recovery-key-description">
                Export the portable key needed to recover this encrypted
                database
              </SettingsRowDescription>
            </SettingsRowContent>
            <SettingsRowActions>
              <Button
                aria-describedby="database-recovery-key-description"
                aria-labelledby="database-recovery-key-title"
                disabled={workflow.pendingAction !== undefined}
                onClick={handleExportRecoveryKey}
                type="button"
                variant="secondary"
              >
                {workflow.pendingAction === "export" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <DownloadIcon />
                )}
                <span>
                  {workflow.pendingAction === "export"
                    ? "Exporting…"
                    : "Export key"}
                </span>
              </Button>
            </SettingsRowActions>
          </SettingsRow>
        </SettingsRows>
      </SettingsSection>
    </>
  );
};

export default SettingsDatabaseSection;
