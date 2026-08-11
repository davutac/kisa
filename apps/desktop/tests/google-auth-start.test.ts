/// <reference types="electron-vite/node" />

import { Effect } from "effect";
import type * as Electron from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RemoteDatabaseClient } from "../../../packages/database/src/remote-client";
import type { notifyGoogleAccountConnected } from "../src/main/auth/account-events";
import {
  getGoogleAccessToken,
  handleGoogleAuthCallback,
  startGoogleAuth,
  stopGoogleAuth,
} from "../src/main/auth/auth";
import { withDatabaseClient } from "../src/main/database";
import { sendRendererEvent } from "../src/main/electron/renderer-events";
import type { getMainWindow } from "../src/main/window/create-window";

const electronState = vi.hoisted(() => {
  const clientId = "test-client-id.apps.googleusercontent.com";
  const clientSecret = "test-desktop-client-secret";
  process.env["MAIN_VITE_GOOGLE_OAUTH_CLIENT_ID"] = clientId;
  process.env["MAIN_VITE_GOOGLE_OAUTH_CLIENT_SECRET"] = clientSecret;

  return {
    accountCount: 0,
    clientId,
    clientSecret,
    openedUrls: [] as string[],
  };
});

vi.mock(import("electron"), () => ({
  BrowserWindow: {
    getAllWindows: vi.fn<typeof Electron.BrowserWindow.getAllWindows>(() => []),
  } as unknown as typeof Electron.BrowserWindow,
  app: {
    focus: vi.fn<typeof Electron.app.focus>(),
  } as unknown as typeof Electron.app,
  safeStorage: {
    decryptString: vi.fn<typeof Electron.safeStorage.decryptString>((value) =>
      value.toString("utf-8")
    ),
    encryptString: vi.fn<typeof Electron.safeStorage.encryptString>((value) =>
      Buffer.from(value)
    ),
    getSelectedStorageBackend: vi.fn<
      typeof Electron.safeStorage.getSelectedStorageBackend
    >(() => "gnome_libsecret"),
    isEncryptionAvailable: vi.fn<
      typeof Electron.safeStorage.isEncryptionAvailable
    >(() => true),
  } as unknown as typeof Electron.safeStorage,
  shell: {
    openExternal: vi.fn<typeof Electron.shell.openExternal>((url) => {
      electronState.openedUrls.push(url);
      return Promise.resolve();
    }),
  } as unknown as typeof Electron.shell,
}));

vi.mock(import("../src/main/database"), () => ({
  withDatabaseClient: vi.fn<
    () => never
  >() as unknown as typeof withDatabaseClient,
}));

vi.mock(import("../src/main/electron/renderer-events"), () => ({
  sendRendererEvent: vi.fn<typeof sendRendererEvent>(),
}));

vi.mock(import("../src/main/auth/account-events"), () => ({
  notifyGoogleAccountConnected: vi.fn<typeof notifyGoogleAccountConnected>(),
}));

vi.mock(import("../src/main/window/create-window"), () => ({
  getMainWindow: vi.fn<typeof getMainWindow>(() => {}),
}));

const startAuthorization = async () => {
  await Effect.runPromise(startGoogleAuth());
  const authorizationUrl = new URL(electronState.openedUrls.at(-1) ?? "");
  const callbackUrl = new URL(
    authorizationUrl.searchParams.get("redirect_uri") ?? ""
  );
  const state = authorizationUrl.searchParams.get("state");

  if (state === null) {
    throw new Error("Expected the login URL to contain OAuth state");
  }

  return { authorizationUrl, callbackUrl, state };
};

describe("Google authentication startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopGoogleAuth();
    electronState.accountCount = 0;
    electronState.openedUrls = [];
    vi.mocked(withDatabaseClient).mockImplementation(((run) =>
      Effect.promise(() =>
        run({
          select: () => ({
            from: () => ({
              all: () =>
                Promise.resolve([{ value: electronState.accountCount }]),
            }),
          }),
        } as unknown as RemoteDatabaseClient)
      )) as typeof withDatabaseClient);
  });

  afterEach(() => {
    stopGoogleAuth();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens Google's desktop authorization flow with PKCE and loopback", async () => {
    const { authorizationUrl, callbackUrl } = await startAuthorization();

    expect({
      callbackHost: callbackUrl.hostname,
      callbackPath: callbackUrl.pathname,
      clientId: authorizationUrl.searchParams.get("client_id"),
      includeGrantedScopes: authorizationUrl.searchParams.get(
        "include_granted_scopes"
      ),
      method: authorizationUrl.searchParams.get("code_challenge_method"),
      origin: authorizationUrl.origin,
      path: authorizationUrl.pathname,
      scopes: authorizationUrl.searchParams.get("scope")?.split(" "),
    }).toStrictEqual({
      callbackHost: "127.0.0.1",
      callbackPath: "/oauth/google/callback",
      clientId: electronState.clientId,
      includeGrantedScopes: "true",
      method: "S256",
      origin: "https://accounts.google.com",
      path: "/o/oauth2/v2/auth",
      scopes: ["openid", "email", "profile", "https://mail.google.com/"],
    });
    expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(
      /^[\w-]{43}$/u
    );
    expect(authorizationUrl.searchParams.get("state")).toMatch(/^[\w-]{43}$/u);
    expect(Number(callbackUrl.port)).toBeGreaterThan(0);
  });

  it("opens a new browser flow while an earlier login is still pending", async () => {
    await Effect.runPromise(startGoogleAuth());
    await Effect.runPromise(startGoogleAuth());

    expect(electronState.openedUrls).toHaveLength(2);
  });

  it("rejects a loopback callback with the wrong OAuth state", async () => {
    const { callbackUrl, state } = await startAuthorization();
    callbackUrl.searchParams.set("error", "access_denied");
    callbackUrl.searchParams.set("state", "wrong-state");

    const invalidResponse = await fetch(callbackUrl);
    callbackUrl.searchParams.set("state", state);
    const validResponse = await fetch(callbackUrl);
    const validPage = await validResponse.text();

    expect({
      cacheControl: validResponse.headers.get("cache-control"),
      contentSecurityPolicy: validResponse.headers.get(
        "content-security-policy"
      ),
      contentType: validResponse.headers.get("content-type"),
      invalidStatus: invalidResponse.status,
      validStatus: validResponse.status,
    }).toStrictEqual({
      cacheControl: "no-store",
      contentSecurityPolicy:
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      contentType: "text/html; charset=utf-8",
      invalidStatus: 400,
      validStatus: 200,
    });
    expect(validPage).toContain("Sign-in canceled");
    expect(validPage).toContain("return to Kisa");
  });

  it("does not open OAuth after nine accounts are connected", async () => {
    electronState.accountCount = 9;

    await expect(Effect.runPromise(startGoogleAuth())).rejects.toThrow(
      "You can connect up to 9 Google accounts."
    );
    expect(electronState.openedUrls).toStrictEqual([]);
  });

  it("expires a pending login after ten minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const { state } = await startAuthorization();
    vi.advanceTimersByTime(10 * 60 * 1000);
    await handleGoogleAuthCallback({ code: "authorization-code", state });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the authorization code directly with Google", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: "invalid_request",
          error_description: "client_secret is missing.",
        },
        { status: 400 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { authorizationUrl, state } = await startAuthorization();

    await handleGoogleAuthCallback({ code: "authorization-code", state });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [tokenUrl, options] = fetchMock.mock.calls[0] ?? [];
    const body = options?.body;

    expect(body).toBeInstanceOf(URLSearchParams);
    expect({
      clientId: (body as URLSearchParams).get("client_id"),
      clientSecret: (body as URLSearchParams).get("client_secret"),
      code: (body as URLSearchParams).get("code"),
      redirectUri: (body as URLSearchParams).get("redirect_uri"),
      tokenUrl,
    }).toStrictEqual({
      clientId: electronState.clientId,
      clientSecret: electronState.clientSecret,
      code: "authorization-code",
      redirectUri: authorizationUrl.searchParams.get("redirect_uri"),
      tokenUrl: "https://oauth2.googleapis.com/token",
    });
    expect((body as URLSearchParams).get("code_verifier")).toMatch(
      /^[\w-]{64}$/u
    );
    expect(sendRendererEvent).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.anything(),
      {
        error:
          "Google sign-in exchange failed (400, invalid_request): client_secret is missing.",
        ok: false,
      }
    );
  });

  it("refreshes desktop credentials directly with Google", async () => {
    const account = {
      createdAt: 1,
      credentials: Buffer.from(
        JSON.stringify({
          accessToken: "expired-access-token",
          clientId: electronState.clientId,
          expiresAt: 1,
          refreshToken: "refresh-token",
        })
      ),
      email: "person@example.com",
      scopes: "[]",
      sortOrder: 1,
      updatedAt: 1,
    };
    const save = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const database = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({ run: save }),
        }),
      }),
      query: {
        googleAccounts: {
          findFirst: () => Promise.resolve(account),
        },
      },
    } as unknown as RemoteDatabaseClient;
    vi.mocked(withDatabaseClient).mockImplementation(((run) =>
      Effect.promise(() => run(database))) as typeof withDatabaseClient);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "fresh-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      Effect.runPromise(getGoogleAccessToken("person@example.com"))
    ).resolves.toBe("fresh-access-token");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [tokenUrl, options] = fetchMock.mock.calls[0] ?? [];
    const body = options?.body as URLSearchParams;

    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect({
      clientId: body.get("client_id"),
      clientSecret: body.get("client_secret"),
      grantType: body.get("grant_type"),
      refreshToken: body.get("refresh_token"),
    }).toStrictEqual({
      clientId: electronState.clientId,
      clientSecret: electronState.clientSecret,
      grantType: "refresh_token",
      refreshToken: "refresh-token",
    });
    expect(save).toHaveBeenCalledOnce();
  });
});
