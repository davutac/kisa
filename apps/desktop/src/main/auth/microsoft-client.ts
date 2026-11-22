import { net, shell } from "electron";

import type { MicrosoftOAuthEnvironment } from "./microsoft-oauth";

/**
 * Kisa's registration with Microsoft Entra: the Application (client) ID of a
 * public client. Microsoft only issues tokens to a registered app, so without
 * one Microsoft sign-in is not offered. It is not a secret, but it belongs to
 * whoever builds Kisa, so it comes from the build's environment rather than
 * the source: `MAIN_VITE_MICROSOFT_CLIENT_ID`, from `apps/desktop/.env.local`
 * or the shell, which electron-vite writes into the main process's bundle.
 */
const CONFIGURED_CLIENT_ID: string | undefined = import.meta.env
  .MAIN_VITE_MICROSOFT_CLIENT_ID;

/** A client ID is a GUID; anything else is not put in a URL. */
const CLIENT_ID_PATTERN =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

export const toMicrosoftClientId = (
  configured: string | undefined
): string | undefined => {
  const clientId = configured?.trim() ?? "";
  return CLIENT_ID_PATTERN.test(clientId) ? clientId : undefined;
};

/** What Microsoft sign-in runs with, or nothing when this build has no client. */
export const getMicrosoftOAuthEnvironment = ():
  | MicrosoftOAuthEnvironment
  | undefined => {
  const clientId = toMicrosoftClientId(CONFIGURED_CLIENT_ID);

  return clientId === undefined
    ? undefined
    : {
        clientId,
        // Electron's network stack, so the system's proxy settings apply.
        fetch: (url, init) => net.fetch(url, init),
        openBrowser: (url) => shell.openExternal(url),
      };
};

export const isMicrosoftSignInAvailable = (): boolean =>
  toMicrosoftClientId(CONFIGURED_CLIENT_ID) !== undefined;
