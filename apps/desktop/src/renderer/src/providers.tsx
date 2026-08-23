import { HotkeysProvider } from "@tanstack/react-hotkeys";

import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppHotkeysProvider } from "@/hotkeys";
import { UndoProvider } from "@/undo/undo-provider";

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
        <UndoProvider>
          <ConfirmDialogProvider>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </ConfirmDialogProvider>
        </UndoProvider>
      </AppHotkeysProvider>
    </HotkeysProvider>
  </ThemeProvider>
);

export default Providers;
