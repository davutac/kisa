import { LoaderCircleIcon, RotateCwIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import type { DatabaseImportStatus } from "@/shared/ipc/settings";

export type PendingImportAction = "discard" | "restart";

interface SettingsDatabasePendingImportRowProps {
  readonly onDiscard: () => void;
  readonly onRestart: () => void;
  readonly pendingAction: PendingImportAction | undefined;
  /** A development build can only quit; it cannot start itself again. */
  readonly restart: DatabaseImportStatus["restart"];
}

const RESTART_COPY = {
  quit: {
    action: "Quit now",
    description:
      "Kisa is still using the current database. Quit and start Kisa again to switch to the imported one. Anything that changes before then stays with the current database, which is kept as a backup.",
  },
  relaunch: {
    action: "Restart now",
    description:
      "Kisa is still using the current database. Restart to switch to the imported one. Anything that changes before then stays with the current database, which is kept as a backup.",
  },
} satisfies Record<
  DatabaseImportStatus["restart"],
  { readonly action: string; readonly description: string }
>;

/**
 * Shown while an imported database waits for a restart. Until then every
 * change still goes to the current database, so the wait must stay visible
 * and have a way out other than restarting.
 */
const SettingsDatabasePendingImportRow = ({
  onDiscard,
  onRestart,
  pendingAction,
  restart,
}: SettingsDatabasePendingImportRowProps) => {
  const copy = RESTART_COPY[restart];
  const isBusy = pendingAction !== undefined;

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle id="database-pending-import-title">
          Imported database waiting
        </SettingsRowTitle>
        <SettingsRowDescription
          aria-live="polite"
          id="database-pending-import-description"
        >
          {copy.description}
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Button
          aria-describedby="database-pending-import-description"
          disabled={isBusy}
          onClick={onDiscard}
          type="button"
          variant="ghost"
        >
          {pendingAction === "discard" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <Trash2Icon />
          )}
          <span>Discard import</span>
        </Button>
        <Button
          aria-describedby="database-pending-import-description"
          disabled={isBusy}
          onClick={onRestart}
          type="button"
          variant="secondary"
        >
          {pendingAction === "restart" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <RotateCwIcon />
          )}
          <span>{copy.action}</span>
        </Button>
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsDatabasePendingImportRow;
