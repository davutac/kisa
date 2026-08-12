export type TitlebarViewPath = "/" | "/settings" | "/templates";
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

export const toTitlebarViewPath = (pathname: string): TitlebarViewPath => {
  if (pathname === "/settings" || pathname === "/templates") {
    return pathname;
  }

  return "/";
};
