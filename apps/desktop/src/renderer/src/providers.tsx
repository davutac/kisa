import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { AppHotkeysProvider } from "@/hotkeys";
import { UndoProvider } from "@/undo/undo-provider";

const Providers = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <AppHotkeysProvider>
      <UndoProvider>
        <ConfirmDialogProvider>
          {children}
          <Toaster />
        </ConfirmDialogProvider>
      </UndoProvider>
    </AppHotkeysProvider>
  </ThemeProvider>
);

export default Providers;
