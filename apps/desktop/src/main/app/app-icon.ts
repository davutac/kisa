interface DockIconTarget {
  readonly setIcon: (icon: string) => void;
}

interface SetDevelopmentDockIconOptions {
  readonly dock: DockIconTarget | undefined;
  readonly icon: string;
  readonly isDevelopment: boolean;
  readonly platform: NodeJS.Platform;
}

export const setDevelopmentDockIcon = ({
  dock,
  icon,
  isDevelopment,
  platform,
}: SetDevelopmentDockIconOptions): void => {
  if (isDevelopment && platform === "darwin") {
    dock?.setIcon(icon);
  }
};
