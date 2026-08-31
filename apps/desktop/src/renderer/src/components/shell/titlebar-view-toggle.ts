export type TitlebarViewPath = "/" | "/scheduled" | "/settings" | "/templates";
export type TitlebarWorkspacePath = Exclude<TitlebarViewPath, "/">;

export interface TitlebarViewToggleInput {
  readonly currentPath: TitlebarViewPath;
  readonly previousPath: TitlebarViewPath | null;
  readonly targetPath: TitlebarWorkspacePath;
}

export const resolveTitlebarViewToggle = ({
  currentPath,
  previousPath,
  targetPath,
}: TitlebarViewToggleInput): TitlebarViewPath =>
  currentPath === targetPath ? (previousPath ?? "/") : targetPath;

export const shouldShowTitlebarScheduledButton = (
  isScheduledOpen: boolean,
  hasScheduledMail: boolean
): boolean => isScheduledOpen || hasScheduledMail;

export const toTitlebarViewPath = (pathname: string): TitlebarViewPath => {
  if (
    pathname === "/scheduled" ||
    pathname === "/settings" ||
    pathname === "/templates"
  ) {
    return pathname;
  }

  return "/";
};
