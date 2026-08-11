import { DownloadIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";

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
  const workflow = useSettingsDatabase(settingsApi);
  const handleExportRecoveryKey = workflow.exportRecoveryKey;
  const handleOpenImport = workflow.openImport;

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
                disabled={workflow.pendingAction !== undefined}
                onClick={handleOpenImport}
                type="button"
                variant="outline"
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
                variant="outline"
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
