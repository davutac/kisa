import { ThemeProvider } from "@/components/shell/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const Providers = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
    <TooltipProvider>
      {children}
      <Toaster />
    </TooltipProvider>
  </ThemeProvider>
);

export default Providers;
