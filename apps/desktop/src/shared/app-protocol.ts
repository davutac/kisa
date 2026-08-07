import type { GoogleAuthCallback } from "./ipc/auth";

export const APP_PROTOCOL = "kisa";
export const GOOGLE_AUTH_CALLBACK_URL = `${APP_PROTOCOL}://oauth/google/callback`;
export const GOOGLE_AUTH_DEV_CALLBACK_URL =
  "http://127.0.0.1:42813/oauth/google/callback";

export const findAppProtocolUrl = (
  commandLine: readonly string[]
): string | undefined =>
  commandLine.find((argument) => argument.startsWith(`${APP_PROTOCOL}://`));

export const parseGoogleAuthCallback = (
  rawUrl: string
): GoogleAuthCallback | undefined => {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }

  if (
    url.protocol !== `${APP_PROTOCOL}:` ||
    url.hostname !== "oauth" ||
    url.pathname !== "/google/callback"
  ) {
    return undefined;
  }

  const error = url.searchParams.get("error");

  if (error !== null && error.length > 0) {
    return { error };
  }

  const code = url.searchParams.get("code");

  if (code !== null && code.length > 0) {
    return { code };
  }

  return undefined;
};
