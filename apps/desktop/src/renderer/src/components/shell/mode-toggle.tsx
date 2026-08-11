import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/shell/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themeOptions = {
  dark: {
    Icon: Moon,
    label: "Dark",
  },
  light: {
    Icon: Sun,
    label: "Light",
  },
  system: {
    Icon: Monitor,
    label: "System",
  },
} as const;

const ModeToggle = () => {
  const { setTheme, theme } = useTheme();
  const { Icon: ThemeIcon, label: themeLabel } = themeOptions[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Change theme, current theme is ${themeLabel}`}
            variant="secondary"
          />
        }
      >
        <ThemeIcon aria-hidden="true" data-icon="inline-start" />
        {themeLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun aria-hidden="true" data-icon="inline-start" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon aria-hidden="true" data-icon="inline-start" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor aria-hidden="true" data-icon="inline-start" />
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export { ModeToggle };
