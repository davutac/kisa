import { ModeToggle } from "@/components/shell/mode-toggle";
import Versions from "@/components/shell/versions";
import {
  Settings,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRows,
  SettingsRowTitle,
  SettingsSection,
  SettingsSectionHeader,
  SettingsSectionTitle,
} from "@/components/ui/settings";
import { Switch } from "@/components/ui/switch";
import { getRuntimeCapabilities } from "@/platform/desktop";
import { useAppSettings } from "@/state/app-settings";
import { useLoginItemSettings } from "@/state/login-item-settings";

import { toSettingsTarget } from "./settings-search";
import { SearchableSettingsRow } from "./settings-search-target";
import SettingsUndoSendRow from "./settings-undo-send-row";
import SettingsUpdateRow from "./settings-update-row";

const SettingsGeneralPage = () => {
  const {
    appSettings,
    loginItemSettings: loginItemSettingsApi,
    updates,
    versions,
    window: windowApi,
  } = getRuntimeCapabilities();
  const {
    animationsEnabled,
    openThreadsInNewWindows,
    runInBackground,
    setAnimationsEnabled,
    setOpenThreadsInNewWindows,
    setRunInBackground,
  } = useAppSettings(appSettings);
  const { settings: loginItemSettings, setOpenAtLogin } =
    useLoginItemSettings(loginItemSettingsApi);

  return (
    <Settings>
      <SettingsSection aria-labelledby="appearance-settings-title">
        <SettingsSectionHeader>
          <SettingsSectionTitle id="appearance-settings-title">
            Appearance
          </SettingsSectionTitle>
        </SettingsSectionHeader>
        <SettingsRows>
          <SearchableSettingsRow target={toSettingsTarget("general", "theme")}>
            <SettingsRowContent>
              <SettingsRowTitle id="theme-title">Theme</SettingsRowTitle>
              <SettingsRowDescription id="theme-description">
                Choose how the app appears
              </SettingsRowDescription>
            </SettingsRowContent>
            <SettingsRowActions>
              <ModeToggle />
            </SettingsRowActions>
          </SearchableSettingsRow>
          <SearchableSettingsRow
            target={toSettingsTarget("general", "animations")}
          >
            <SettingsRowContent>
              <SettingsRowTitle id="animations-title">
                Animations
              </SettingsRowTitle>
              <SettingsRowDescription>
                Turn off animations and transitions to reduce lag.
              </SettingsRowDescription>
            </SettingsRowContent>
            <SettingsRowActions>
              <Switch
                aria-labelledby="animations-title"
                checked={animationsEnabled}
                onCheckedChange={setAnimationsEnabled}
              />
            </SettingsRowActions>
          </SearchableSettingsRow>
        </SettingsRows>
      </SettingsSection>

      {appSettings === undefined &&
      loginItemSettingsApi === undefined &&
      updates === undefined ? null : (
        <SettingsSection aria-labelledby="system-settings-title">
          <SettingsSectionHeader>
            <SettingsSectionTitle id="system-settings-title">
              System
            </SettingsSectionTitle>
          </SettingsSectionHeader>
          <SettingsRows>
            {loginItemSettingsApi === undefined ? null : (
              <SearchableSettingsRow
                target={toSettingsTarget("general", "launch-at-login")}
              >
                <SettingsRowContent>
                  <SettingsRowTitle id="launch-at-login-title">
                    Launch at login
                  </SettingsRowTitle>
                  <SettingsRowDescription>
                    {loginItemSettings?.requiresApproval === true
                      ? "Allow Kisa in System Settings to finish enabling this."
                      : "Start Kisa when you sign in to your computer."}
                  </SettingsRowDescription>
                </SettingsRowContent>
                <SettingsRowActions>
                  <Switch
                    aria-labelledby="launch-at-login-title"
                    checked={loginItemSettings?.openAtLogin ?? false}
                    disabled={loginItemSettings === null}
                    onCheckedChange={setOpenAtLogin}
                  />
                </SettingsRowActions>
              </SearchableSettingsRow>
            )}
            {appSettings === undefined ? null : (
              <SearchableSettingsRow
                target={toSettingsTarget("general", "run-in-background")}
              >
                <SettingsRowContent>
                  <SettingsRowTitle id="run-in-background-title">
                    Run in background
                  </SettingsRowTitle>
                  <SettingsRowDescription>
                    Keep Kisa running in the system tray after closing the
                    window so mail notifications continue.
                  </SettingsRowDescription>
                </SettingsRowContent>
                <SettingsRowActions>
                  <Switch
                    aria-labelledby="run-in-background-title"
                    checked={runInBackground}
                    onCheckedChange={setRunInBackground}
                  />
                </SettingsRowActions>
              </SearchableSettingsRow>
            )}
            {updates === undefined ? null : (
              <SettingsUpdateRow updateApi={updates} />
            )}
          </SettingsRows>
        </SettingsSection>
      )}

      {windowApi === undefined ? null : (
        <SettingsSection aria-labelledby="conversations-settings-title">
          <SettingsSectionHeader>
            <SettingsSectionTitle id="conversations-settings-title">
              Conversations
            </SettingsSectionTitle>
          </SettingsSectionHeader>
          <SettingsRows>
            <SearchableSettingsRow
              target={toSettingsTarget("general", "thread-windows")}
            >
              <SettingsRowContent>
                <SettingsRowTitle id="thread-window-title">
                  Always open threads in new windows
                </SettingsRowTitle>
                <SettingsRowDescription>
                  Open conversations in their own window instead of over the
                  mailbox.
                </SettingsRowDescription>
              </SettingsRowContent>
              <SettingsRowActions>
                <Switch
                  aria-labelledby="thread-window-title"
                  checked={openThreadsInNewWindows}
                  onCheckedChange={setOpenThreadsInNewWindows}
                />
              </SettingsRowActions>
            </SearchableSettingsRow>
          </SettingsRows>
        </SettingsSection>
      )}

      {appSettings === undefined ? null : (
        <SettingsSection aria-labelledby="sending-settings-title">
          <SettingsSectionHeader>
            <SettingsSectionTitle id="sending-settings-title">
              Sending
            </SettingsSectionTitle>
          </SettingsSectionHeader>
          <SettingsRows>
            <SettingsUndoSendRow appSettingsApi={appSettings} />
          </SettingsRows>
        </SettingsSection>
      )}

      {versions === undefined ? null : <Versions versions={versions} />}
    </Settings>
  );
};

export default SettingsGeneralPage;
