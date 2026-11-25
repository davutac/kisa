import { DownloadIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import type { UpdateApi } from "@/platform/desktop";
import { getSettingsUpdateView } from "@/updates/update-view";
import { useUpdateActions } from "@/updates/use-update-actions";
import { useUpdateStatus } from "@/updates/use-update-status";

import { toSettingsTarget } from "./settings-search";
import { SearchableSettingsRow } from "./settings-search-target";

interface SettingsUpdateRowProps {
  updateApi: UpdateApi;
}

const SettingsUpdateRow = ({ updateApi }: SettingsUpdateRowProps) => {
  const status = useUpdateStatus(updateApi);

  const { checkForUpdates, downloadUpdate, installUpdate, isCheckPending } =
    useUpdateActions(updateApi);

  const view = getSettingsUpdateView(status, isCheckPending);

  return (
    <SearchableSettingsRow target={toSettingsTarget("general", "updates")}>
      <SettingsRowContent>
        <SettingsRowTitle id="updates-title">Updates</SettingsRowTitle>
        <SettingsRowDescription id="updates-description">
          Check whether a newer version is available
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        {view.action === "check" ? (
          <Button
            aria-describedby="updates-description"
            aria-labelledby="updates-title"
            disabled={view.isDisabled}
            onClick={() => {
              void checkForUpdates();
            }}
            type="button"
            variant="secondary"
          >
            {view.isBusy ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <RefreshCwIcon />
            )}
            <span>{view.label}</span>
          </Button>
        ) : (
          <Button
            aria-describedby="updates-description"
            aria-labelledby="updates-title"
            onClick={() => {
              if (view.action === "download") {
                void downloadUpdate();

                return;
              }

              void installUpdate(view.version);
            }}
            type="button"
            variant="secondary"
          >
            <DownloadIcon />
            <span>{view.label}</span>
          </Button>
        )}
      </SettingsRowActions>
    </SearchableSettingsRow>
  );
};

export default SettingsUpdateRow;
