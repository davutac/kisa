import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@/components/ui/toast";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import type { SettingsApi } from "@/platform/desktop";
import type {
  DatabaseImportFileKind,
  DatabaseImportProgress,
  DatabaseImportStatus,
} from "@/shared/ipc/settings";

import type { PendingImportAction } from "./settings-database-pending-import-row";

type PendingAction = "export" | "import" | undefined;

interface ImportSession {
  readonly databaseFileName?: string;
  readonly recoveryKeyFileName?: string;
  readonly sessionId?: string;
}

export const DATABASE_IMPORT_PROGRESS_LABELS = {
  copying: "Copying the database into a safe staging area…",
  preparing: "Preparing the restart-safe handoff…",
  ready: "Ready—restart Kisa to activate the imported database.",
  validating: "Checking the database and recovery key…",
} satisfies Record<DatabaseImportProgress, string>;

export const useSettingsDatabase = (settingsApi: SettingsApi) => {
  const importGeneration = useRef(0);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [importSession, setImportSession] = useState<ImportSession>();
  const [importProgress, setImportProgress] =
    useState<DatabaseImportProgress>();
  const [selectingKind, setSelectingKind] = useState<DatabaseImportFileKind>();
  // Whether an import waits for a restart is main's to say: it reads the
  // manifest each time. This is only the last answer, asked again on mount
  // and after everything here that can change it.
  const [importStatus, setImportStatus] = useState<DatabaseImportStatus>();
  const [pendingImportAction, setPendingImportAction] =
    useState<PendingImportAction>();
  const mountedRef = useRef(false);

  const refreshImportStatus = useCallback(async (): Promise<void> => {
    try {
      const reply = await settingsApi.getDatabaseImportStatus();
      if (mountedRef.current && reply.ok) {
        setImportStatus(reply.data);
      }
    } catch {
      // The last answer stays; the next refresh asks again.
    }
  }, [settingsApi]);

  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(() => {
      if (mountedRef.current) {
        void refreshImportStatus();
      }
    });
    return () => {
      mountedRef.current = false;
    };
  }, [refreshImportStatus]);

  useEffect(
    () =>
      settingsApi.onDatabaseImportProgress((progress) => {
        setImportProgress(progress);
        void refreshImportStatus();
      }),
    [refreshImportStatus, settingsApi]
  );

  const discardPendingImport = async (): Promise<void> => {
    setPendingImportAction("discard");
    await runWithCleanup(
      async () => {
        try {
          const reply = await settingsApi.discardDatabaseImport();
          if (!reply.ok) {
            toast.error(reply.error);
            return;
          }
          // The Import row must stop saying a restart will activate it.
          setImportProgress(undefined);
          toast.success("Database import discarded");
        } catch {
          toast.error("Could not discard the import");
        }
        await refreshImportStatus();
      },
      () => {
        setPendingImportAction(undefined);
      }
    );
  };

  const restartForPendingImport = async (): Promise<void> => {
    setPendingImportAction("restart");
    await runWithCleanup(
      async () => {
        try {
          const reply = await settingsApi.restartForDatabaseImport();
          if (!reply.ok) {
            toast.error(reply.error);
          }
        } catch {
          toast.error("Could not restart to finish the import");
        }
        await refreshImportStatus();
      },
      () => {
        setPendingImportAction(undefined);
      }
    );
  };

  const exportRecoveryKey = async (): Promise<void> => {
    setPendingAction("export");
    await runWithCleanup(
      async () => {
        try {
          const reply = await settingsApi.exportDatabaseRecoveryKey();
          if (!reply.ok) {
            toast.error(reply.error);
          } else if (reply.data === "saved") {
            toast.success("Database recovery key exported");
          }
        } catch {
          toast.error("Could not export the database recovery key");
        }
      },
      () => {
        setPendingAction(undefined);
      }
    );
  };

  const openImport = async (): Promise<void> => {
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

  const cancelImport = async (): Promise<void> => {
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

  const selectImportFile = async (
    kind: DatabaseImportFileKind
  ): Promise<void> => {
    const sessionId = importSession?.sessionId;
    if (sessionId === undefined) {
      return;
    }
    setSelectingKind(kind);
    await runWithCleanup(
      async () => {
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
        }
      },
      () => {
        setSelectingKind((current) => (current === kind ? undefined : current));
      }
    );
  };

  const dropImportFile = async (
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
    await runWithCleanup(
      async () => {
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
        }
      },
      () => {
        setSelectingKind((current) => (current === kind ? undefined : current));
      }
    );
  };

  const startImport = async (): Promise<void> => {
    const sessionId = importSession?.sessionId;
    if (sessionId === undefined) {
      return;
    }
    setPendingAction("import");
    setImportProgress(undefined);
    await runWithCleanup(
      async () => {
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
        }
        // Main reports "importing" until the restart dialog is answered,
        // which is when the reply above arrives.
        await refreshImportStatus();
      },
      () => {
        setPendingAction(undefined);
        setImportSession(undefined);
        setSelectingKind(undefined);
      }
    );
  };

  return {
    dialog: {
      isRunning: pendingAction === "import",
      onCancel: cancelImport,
      onDropFile: dropImportFile,
      onSelectFile: selectImportFile,
      onStart: startImport,
      progressMessage:
        importProgress === undefined
          ? undefined
          : DATABASE_IMPORT_PROGRESS_LABELS[importProgress],
      selectingKind,
      session: importSession,
    },
    discardPendingImport,
    exportRecoveryKey,
    importProgress,
    importStatus,
    openImport,
    pendingAction,
    pendingImportAction,
    restartForPendingImport,
  };
};
