import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import type { AppSettingsApi } from "@/platform/desktop";
import type { UndoSendSeconds } from "@/shared/ipc/app";
import { useAppSettings } from "@/state/app-settings";

import { toSettingsTarget } from "./settings-search";
import { SearchableSettingsRow } from "./settings-search-target";

export const UNDO_SEND_OPTIONS = [
  { label: "Off", seconds: 0, value: "0" },
  { label: "5 seconds", seconds: 5, value: "5" },
  { label: "10 seconds", seconds: 10, value: "10" },
  { label: "20 seconds", seconds: 20, value: "20" },
  { label: "30 seconds", seconds: 30, value: "30" },
] as const satisfies readonly {
  readonly label: string;
  readonly seconds: UndoSendSeconds;
  readonly value: string;
}[];

export const findUndoSendOption = (seconds: UndoSendSeconds) =>
  UNDO_SEND_OPTIONS.find((option) => option.seconds === seconds) ??
  UNDO_SEND_OPTIONS[2];

/** How long a sent message waits before it leaves, so Undo can take it back. */
const SettingsUndoSendRow = ({
  appSettingsApi,
}: {
  readonly appSettingsApi: AppSettingsApi;
}) => {
  const { setUndoSendSeconds, undoSendSeconds } =
    useAppSettings(appSettingsApi);
  const selected = findUndoSendOption(undoSendSeconds);

  return (
    <SearchableSettingsRow target={toSettingsTarget("general", "undo-send")}>
      <SettingsRowContent>
        <SettingsRowTitle id="undo-send-title">Undo send</SettingsRowTitle>
        <SettingsRowDescription id="undo-send-description">
          Wait this long before a message leaves, so you can take it back.
          Quitting Kisa sends it at once.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Menu>
          <MenuTrigger
            render={
              <Button
                aria-describedby="undo-send-description"
                aria-label={`Undo send, ${selected.label}`}
                className="w-fit justify-between gap-3 font-normal"
                type="button"
                variant="secondary"
              />
            }
          >
            <span>{selected.label}</span>
            <ChevronDownIcon
              aria-hidden
              className="text-muted-foreground shrink-0"
            />
          </MenuTrigger>
          <MenuContent align="end" side="bottom">
            <MenuRadioGroup
              onValueChange={(value: string) => {
                const option = UNDO_SEND_OPTIONS.find(
                  (candidate) => candidate.value === value
                );
                if (option !== undefined) {
                  setUndoSendSeconds(option.seconds);
                }
              }}
              value={selected.value}
            >
              {UNDO_SEND_OPTIONS.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </SettingsRowActions>
    </SearchableSettingsRow>
  );
};

export default SettingsUndoSendRow;
