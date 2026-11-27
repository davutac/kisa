import { createColorScheme, createLocalStorage } from "@ui-sdk/core";
import type { ColorSchemeState, SystemColorScheme } from "@ui-sdk/core";
import { Preferences, usePreference } from "@ui-sdk/react/preferences";
import { useLayoutEffect } from "react";
import type { ReactNode } from "react";

import { getAppThemeApi } from "@/platform/desktop";

export type Theme = "dark" | "light" | "system";

export type ColorScheme = "dark" | "light";

interface ThemeProviderState {
  /** What "system" actually resolved to, for surfaces that cannot use CSS. */
  resolvedTheme: ColorScheme;
  setTheme: (theme: Theme) => void;
  theme: Theme;
}

// Every window shares the theme. It keeps the key and values next-themes
// saved, so a theme chosen before the upgrade still applies.
const themePreference = createColorScheme({
  defaultValue: "dark",
  global: true,
  storage: createLocalStorage("vite-ui-theme"),
});

// Until the browser's preference is known, the app paints dark, as the
// windows' markup already does.
const toColorScheme = (resolved: SystemColorScheme): ColorScheme =>
  resolved === "light" ? "light" : "dark";

// `main.css` styles dark mode from a `dark` class on `<html>`, and the windows'
// CSP runs no inline script, so the class is set here before the first paint.
// Electron is told the choice itself, not what it resolved to, so "system"
// goes on following the system. Native menus and each frame's
// `prefers-color-scheme` then answer for the app's theme.
const syncNativeTheme = async (theme: Theme): Promise<void> => {
  try {
    await getAppThemeApi()?.set({ theme });
  } catch {
    // A window with no desktop bridge, or a call that fails, leaves Electron
    // following the system, as it did before it was told anything.
  }
};

const applyColorScheme = ({ resolved, value }: ColorSchemeState): void => {
  document.documentElement.classList.toggle(
    "dark",
    toColorScheme(resolved) === "dark"
  );
  void syncNativeTheme(value);
};

const ThemeProvider = ({ children }: { readonly children: ReactNode }) => {
  useLayoutEffect(() => {
    applyColorScheme(themePreference.get());

    return themePreference.subscribe(applyColorScheme);
  }, []);

  return <Preferences preferences={[themePreference]}>{children}</Preferences>;
};

export const useTheme = (): ThemeProviderState => {
  const { resolved, value } = usePreference(themePreference);

  return {
    resolvedTheme: toColorScheme(resolved),
    setTheme: (theme) => {
      themePreference.set(theme);
    },
    theme: value,
  };
};

export { ThemeProvider };
