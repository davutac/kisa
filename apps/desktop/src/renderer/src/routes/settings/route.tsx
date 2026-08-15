import { createFileRoute } from "@tanstack/react-router";

import { ModeToggle } from "@/components/shell/mode-toggle";
import Versions from "@/components/shell/versions";
import {
  Settings,
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
import { Switch } from "@/components/ui/switch";
import { useHotkeyLayer } from "@/hotkeys";
import { getRuntimeCapabilities } from "@/platform/desktop";
import {
  useAnimationsEnabled,
  useGeneralSettingsStore,
  useOpenThreadsInNewWindows,
} from "@/state/general-settings";

import SettingsAccountsSection from "./-components/settings-accounts-section";
import SettingsAiSection from "./-components/settings-ai-section";
import SettingsDatabaseSection from "./-components/settings-database-section";
import SettingsUpdateRow from "./-components/settings-update-row";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const {
    ai,
    auth,
    mail,
    settings,
    updates,
    versions,
    window: windowApi,
  } = getRuntimeCapabilities();
  const animationsEnabled = useAnimationsEnabled();
  const setAnimationsEnabled = useGeneralSettingsStore(
    (state) => state.setAnimationsEnabled
  );
  const openThreadsInNewWindows = useOpenThreadsInNewWindows();
  const setOpenThreadsInNewWindows = useGeneralSettingsStore(
    (state) => state.setOpenThreadsInNewWindows
  );

  useHotkeyLayer("settings", true);

  return (
    <section
      aria-labelledby="general-settings-title"
      className="min-h-full w-full min-w-0 flex-1 p-6 sm:p-10"
    >
      <Settings>
        <SettingsSection aria-labelledby="general-settings-title">
          <SettingsSectionHeader>
            <SettingsSectionTitle id="general-settings-title">
              General
            </SettingsSectionTitle>
          </SettingsSectionHeader>

          <SettingsRows>
            <SettingsRow>
              <SettingsRowContent>
                <SettingsRowTitle id="theme-title">Theme</SettingsRowTitle>
                <SettingsRowDescription id="theme-description">
                  Choose how the app appears
                </SettingsRowDescription>
              </SettingsRowContent>
              <SettingsRowActions>
                <ModeToggle />
              </SettingsRowActions>
            </SettingsRow>
            <SettingsRow>
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
            </SettingsRow>
            {windowApi === undefined ? null : (
              <SettingsRow>
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
              </SettingsRow>
            )}
            {updates === undefined ? null : (
              <SettingsUpdateRow updateApi={updates} />
            )}
          </SettingsRows>
        </SettingsSection>

        {ai === undefined ? null : <SettingsAiSection />}

        {settings === undefined ? null : (
          <SettingsDatabaseSection settingsApi={settings} />
        )}

        {auth === undefined ? null : (
          <SettingsAccountsSection
            authApi={auth}
            mailApi={mail}
            settingsApi={settings}
          />
        )}

        {versions === undefined ? null : <Versions versions={versions} />}
      </Settings>
    </section>
  );
}
