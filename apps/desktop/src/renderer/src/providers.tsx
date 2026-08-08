import { HotkeysProvider } from "@tanstack/react-hotkeys";

import { ThemeProvider } from "@/components/shell/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppHotkeysProvider } from "@/hotkeys";

const TANSTACK_HOTKEY_DEFAULTS = {
  hotkey: {
    conflictBehavior: "warn",
    eventType: "keydown",
    ignoreInputs: true,
    preventDefault: true,
    stopPropagation: true,
  },
} as const;

const Providers = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
    <HotkeysProvider defaultOptions={TANSTACK_HOTKEY_DEFAULTS}>
      <AppHotkeysProvider>
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </AppHotkeysProvider>
    </HotkeysProvider>
  </ThemeProvider>
);

export default Providers;
