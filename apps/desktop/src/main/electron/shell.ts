import { shell } from "electron";

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

export const parseSafeExternalUrl = (rawUrl: string): string | undefined => {
  try {
    const url = new URL(rawUrl);

    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

export const openExternalUrl = (rawUrl: string): boolean => {
  const url = parseSafeExternalUrl(rawUrl);

  if (url === undefined) {
    return false;
  }

  void shell.openExternal(url);
  return true;
};
