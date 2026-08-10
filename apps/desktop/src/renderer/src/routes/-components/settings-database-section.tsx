import { DownloadIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
import type {
  DatabaseImportFileKind,
  DatabaseImportProgress,
} from "@/shared/ipc/settings";

import SettingsDatabaseImportDialog from "./settings-database-import-dialog";

interface SettingsDatabaseSectionProps {
  settingsApi: SettingsApi;
}

type PendingAction = "export" | "import" | undefined;

interface ImportSession {
  readonly databaseFileName?: string;
  readonly recoveryKeyFileName?: string;
  readonly sessionId?: string;
}

const IMPORT_PROGRESS_LABELS: Record<DatabaseImportProgress, string> = {
  copying: "Copying the database into a safe staging area…",
  preparing: "Preparing the restart-safe handoff…",
  ready: "Ready—restart Kisa to activate the imported database.",
  validating: "Checking the database and recovery key…",
};

const SettingsDatabaseSection = ({
  settingsApi,
}: SettingsDatabaseSectionProps) => {
  const importGeneration = useRef(0);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [importSession, setImportSession] = useState<ImportSession>();
  const [importProgress, setImportProgress] =
    useState<DatabaseImportProgress>();
  const [selectingKind, setSelectingKind] = useState<DatabaseImportFileKind>();
  const isImportRunning = pendingAction === "import";

  useEffect(
    () => settingsApi.onDatabaseImportProgress(setImportProgress),
    [settingsApi]
  );

  const handleExport = async (): Promise<void> => {
    setPendingAction("export");

    try {
      const reply = await settingsApi.exportDatabaseRecoveryKey();

      if (!reply.ok) {
        toast.error(reply.error);
      } else if (reply.data === "saved") {
        toast.success("Database recovery key exported");
      }
    } catch {
      toast.error("Could not export the database recovery key");
    } finally {
      setPendingAction(undefined);
    }
  };

  const handleOpenImport = async (): Promise<void> => {
    const generation = importGeneration.current + 1;
    importGeneration.current = generation;
    setImportSession({});
    setImportProgress(undefined);

    try {
      const reply = await settingsApi.beginDatabaseImport();

      if (importGeneration.current !== generation) {
        if (reply.ok) {
          await settingsApi.cancelDatabaseImport(reply.data);
        }
        return;
      }

      if (!reply.ok) {
        toast.error(reply.error);
        setImportSession(undefined);
        return;
      }

      setImportSession({ sessionId: reply.data.sessionId });
    } catch {
      if (importGeneration.current === generation) {
        toast.error("Could not start the database import");
        setImportSession(undefined);
      }
    }
  };

  const handleCancelImport = async (): Promise<void> => {
    const sessionId = importSession?.sessionId;
    importGeneration.current += 1;
    setImportSession(undefined);
    setImportProgress(undefined);
    setSelectingKind(undefined);

    try {
      if (sessionId !== undefined) {
        const reply = await settingsApi.cancelDatabaseImport({ sessionId });
        if (!reply.ok) {
          toast.error(reply.error);
        }
      }
    } catch {
      toast.error("Could not cancel the database import");
    }
  };

  const rememberImportFile = (
    kind: DatabaseImportFileKind,
    sessionId: string,
    fileName: string
  ): void => {
    setImportSession((current) => {
      if (current?.sessionId !== sessionId) {
        return current;
      }

      return kind === "database"
        ? { ...current, databaseFileName: fileName }
        : { ...current, recoveryKeyFileName: fileName };
    });
  };

  const handleSelectImportFile = async (
    kind: DatabaseImportFileKind
  ): Promise<void> => {
    const sessionId = importSession?.sessionId;
    if (sessionId === undefined) {
      return;
    }

    setSelectingKind(kind);

    try {
      const reply = await settingsApi.selectDatabaseImportFile({
        kind,
        sessionId,
      });
      if (!reply.ok) {
        toast.error(reply.error);
      } else if (reply.data !== null) {
        rememberImportFile(kind, sessionId, reply.data.fileName);
      }
    } catch {
      toast.error("Could not select the import file");
    } finally {
      setSelectingKind((current) => (current === kind ? undefined : current));
    }
  };

  const handleDropImportFile = async (
    kind: DatabaseImportFileKind,
    file: File
  ): Promise<void> => {
    const sessionId = importSession?.sessionId;
    if (sessionId === undefined) {
      return;
    }

    const fileName = file.name.toLowerCase();
    const hasExpectedExtension =
      kind === "database"
        ? fileName.endsWith(".db") ||
          fileName.endsWith(".sqlite") ||
          fileName.endsWith(".sqlite3")
        : fileName.endsWith(".kisa-key");
    if (!hasExpectedExtension) {
      toast.error(
        kind === "database"
          ? "Drop a .sqlite, .sqlite3, or .db database"
          : "Drop a .kisa-key recovery key"
      );
      return;
    }

    setSelectingKind(kind);

    try {
      const reply = await settingsApi.dropDatabaseImportFile({
        file,
        kind,
        sessionId,
      });
      if (!reply.ok) {
        toast.error(reply.error);
      } else if (reply.data !== null) {
        rememberImportFile(kind, sessionId, reply.data.fileName);
      }
    } catch {
      toast.error("Could not use the dropped import file");
    } finally {
      setSelectingKind((current) => (current === kind ? undefined : current));
    }
  };

  const handleStartImport = async (): Promise<void> => {
    const sessionId = importSession?.sessionId;
    if (sessionId === undefined) {
      return;
    }

    setPendingAction("import");
    setImportProgress(undefined);

    try {
      const reply = await settingsApi.importDatabase({ sessionId });

      if (reply.ok) {
        setImportProgress("ready");
        toast.success("Database import ready", {
          description: "Restart Kisa to activate it.",
        });
      } else {
        toast.error(reply.error);
        setImportProgress(undefined);
      }
    } catch {
      toast.error("Could not import the database");
      setImportProgress(undefined);
    } finally {
      setPendingAction(undefined);
      setImportSession(undefined);
      setSelectingKind(undefined);
    }
  };

  return (
    <>
      <SettingsDatabaseImportDialog
        isRunning={isImportRunning}
        onCancel={() => {
          void handleCancelImport();
        }}
        onDropFile={(kind, file) => {
          void handleDropImportFile(kind, file);
        }}
        onSelectFile={(kind) => {
          void handleSelectImportFile(kind);
        }}
        onStart={() => {
          void handleStartImport();
        }}
        progressMessage={
          importProgress === undefined
            ? undefined
            : IMPORT_PROGRESS_LABELS[importProgress]
        }
        selectingKind={selectingKind}
        session={importSession}
      />

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
                {importProgress === undefined
                  ? "Restore an existing Kisa database using its recovery key"
                  : IMPORT_PROGRESS_LABELS[importProgress]}
              </SettingsRowDescription>
            </SettingsRowContent>
            <SettingsRowActions>
              <Button
                aria-describedby="database-import-description"
                aria-labelledby="database-import-title"
                disabled={pendingAction !== undefined}
                onClick={() => {
                  void handleOpenImport();
                }}
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
                disabled={pendingAction !== undefined}
                onClick={() => {
                  void handleExport();
                }}
                type="button"
                variant="outline"
              >
                {pendingAction === "export" ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <DownloadIcon />
                )}
                <span>
                  {pendingAction === "export" ? "Exporting…" : "Export key"}
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
