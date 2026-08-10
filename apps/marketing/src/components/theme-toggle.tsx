import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

const toggleTheme = (): void => {
  const root = document.documentElement;
  const isDark = root.classList.toggle("dark");
  localStorage.setItem("kisa-theme", isDark ? "dark" : "light");
};

const ThemeToggle = () => (
  <Button
    aria-label="Toggle color theme"
    className="rounded-full"
    onClick={toggleTheme}
    size="icon"
    type="button"
    variant="ghost"
  >
    <SunIcon className="hidden dark:block" />
    <MoonIcon className="block dark:hidden" />
  </Button>
);

export default ThemeToggle;
