import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
} from "next-themes";
import type { ThemeProviderProps as NextThemesProviderProps } from "next-themes";
import type { ReactNode } from "react";

export type Theme = "dark" | "light" | "system";

interface ThemeProviderProps extends Omit<
  NextThemesProviderProps,
  "children" | "defaultTheme" | "storageKey"
> {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export type ColorScheme = "dark" | "light";

interface ThemeProviderState {
  /** What "system" actually resolved to, for surfaces that cannot use CSS. */
  resolvedTheme: ColorScheme;
  setTheme: (theme: Theme) => void;
  theme: Theme;
}

const isTheme = (theme: string | undefined): theme is Theme =>
  theme === "dark" || theme === "light" || theme === "system";

const ThemeProvider = ({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) => (
  <NextThemesProvider
    attribute="class"
    defaultTheme={defaultTheme}
    enableSystem
    storageKey={storageKey}
    {...props}
  >
    {children}
  </NextThemesProvider>
);

export const useTheme = (): ThemeProviderState => {
  const { resolvedTheme, setTheme, theme } = useNextTheme();

  return {
    // Before the provider has read storage nothing is resolved yet, and the app
    // paints dark until it is.
    resolvedTheme: resolvedTheme === "light" ? "light" : "dark",
    setTheme: (nextTheme) => setTheme(nextTheme),
    theme: isTheme(theme) ? theme : "system",
  };
};

export { ThemeProvider };
