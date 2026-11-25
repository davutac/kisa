import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/shell/theme-provider";
import type { Theme } from "@/components/shell/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";

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

const isTheme = (value: string): value is Theme => value in themeOptions;

const ModeToggle = () => {
  const { setTheme, theme } = useTheme();
  const { Icon: ThemeIcon, label: themeLabel } = themeOptions[theme];

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Change theme, current theme is ${themeLabel}`}
            variant="secondary"
          />
        }
      >
        <ThemeIcon aria-hidden="true" data-icon="inline-start" />
        {themeLabel}
      </MenuTrigger>
      <MenuContent align="end">
        <MenuRadioGroup
          onValueChange={(value) => {
            if (isTheme(value)) {
              setTheme(value);
            }
          }}
          value={theme}
        >
          <MenuRadioItem closeOnSelect value="light">
            <Sun aria-hidden="true" data-icon="inline-start" />
            Light
          </MenuRadioItem>
          <MenuRadioItem closeOnSelect value="dark">
            <Moon aria-hidden="true" data-icon="inline-start" />
            Dark
          </MenuRadioItem>
          <MenuSeparator />
          <MenuRadioItem closeOnSelect value="system">
            <Monitor aria-hidden="true" data-icon="inline-start" />
            System
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
};

export { ModeToggle };
