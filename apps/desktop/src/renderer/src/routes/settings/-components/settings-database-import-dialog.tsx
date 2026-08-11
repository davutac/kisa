import FileSelectionRow from "@/components/file-selection-row";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useHotkeyLayer } from "@/hotkeys";
import type { DatabaseImportFileKind } from "@/shared/ipc/settings";

interface DatabaseImportDialogSession {
  readonly databaseFileName?: string;
  readonly recoveryKeyFileName?: string;
  readonly sessionId?: string;
}

interface SettingsDatabaseImportDialogProps {
  readonly isRunning: boolean;
  readonly onCancel: () => void;
  readonly onDropFile: (kind: DatabaseImportFileKind, file: File) => void;
  readonly onSelectFile: (kind: DatabaseImportFileKind) => void;
  readonly onStart: () => void;
  readonly progressMessage?: string;
  readonly selectingKind?: DatabaseImportFileKind;
  readonly session?: DatabaseImportDialogSession;
}

export const DATABASE_IMPORT_OVERLAY_CLASS_NAME =
  "bg-background inset-0 size-full max-w-none translate-x-0 translate-y-0 place-items-center rounded-none p-6 ring-0 sm:max-w-none";

const SettingsDatabaseImportDialog = ({
  isRunning,
  onCancel,
  onDropFile,
  onSelectFile,
  onStart,
  progressMessage,
  selectingKind,
  session,
}: SettingsDatabaseImportDialogProps) => {
  const isOpen = session !== undefined;
  const isSelecting = selectingKind !== undefined;

  useHotkeyLayer("blocking", isOpen);

  return (
    <Dialog open={isOpen}>
      <DialogContent
        aria-busy={isRunning}
        className={DATABASE_IMPORT_OVERLAY_CLASS_NAME}
        showCloseButton={false}
      >
        {isRunning ? (
          <div className="flex max-w-80 flex-col items-center gap-4 text-center">
            <Spinner aria-hidden="true" className="size-5" />
            <div className="flex flex-col gap-1.5">
              <DialogTitle>Importing database</DialogTitle>
              <DialogDescription>
                <output aria-live="assertive">
                  {progressMessage ?? "Starting the database import…"}
                </output>
              </DialogDescription>
            </div>
          </div>
        ) : (
          <div className="flex w-full max-w-lg flex-col gap-5">
            <div className="flex flex-col gap-1.5 text-center">
              <DialogTitle>Import database</DialogTitle>
              <DialogDescription>
                Close the Kisa instance that created the database, then select
                it and its matching recovery key. The current database will be
                backed up before replacement on restart.
              </DialogDescription>
            </div>

            <div className="grid gap-3">
              <FileSelectionRow
                disabled={session?.sessionId === undefined || isSelecting}
                fileName={session?.databaseFileName}
                isSelecting={selectingKind === "database"}
                label="Database"
                onDropFile={(file) => {
                  onDropFile("database", file);
                }}
                onSelect={() => {
                  onSelectFile("database");
                }}
              />
              <FileSelectionRow
                disabled={session?.sessionId === undefined || isSelecting}
                fileName={session?.recoveryKeyFileName}
                isSelecting={selectingKind === "recovery-key"}
                label="Key"
                onDropFile={(file) => {
                  onDropFile("recovery-key", file);
                }}
                onSelect={() => {
                  onSelectFile("recovery-key");
                }}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button onClick={onCancel} type="button" variant="outline">
                Cancel
              </Button>
              <Button
                disabled={
                  session?.sessionId === undefined ||
                  session.databaseFileName === undefined ||
                  session.recoveryKeyFileName === undefined ||
                  isSelecting
                }
                onClick={onStart}
                type="button"
              >
                Start import
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDatabaseImportDialog;
