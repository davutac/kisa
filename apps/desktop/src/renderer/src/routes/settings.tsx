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
import { useHotkeyLayer } from "@/hotkeys";
import { getRuntimeCapabilities } from "@/platform/desktop";

import SettingsAccountsSection from "./-components/settings-accounts-section";
import SettingsUpdateRow from "./-components/settings-update-row";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { auth, mail, settings, updates, versions } = getRuntimeCapabilities();

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
            {updates === undefined ? null : (
              <SettingsUpdateRow updateApi={updates} />
            )}
          </SettingsRows>
        </SettingsSection>

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
