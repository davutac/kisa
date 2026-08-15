export const shouldQuitAfterAllWindowsClose = (
  platform: NodeJS.Platform,
  runInBackground: boolean
): boolean => platform !== "darwin" || !runInBackground;
