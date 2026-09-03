/// <reference types="electron-vite/node" />

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "@repo/database/client";
import type { DatabaseRemoteCallback } from "@repo/database/remote-client";
import { createRemoteDatabaseClient } from "@repo/database/remote-client";
import { Effect, Schema } from "effect";
import { dialog, safeStorage } from "electron";
import type * as Electron from "electron";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { notifyGoogleAccountConnected } from "../src/main/auth/account-events";
import {
  getGoogleAccessToken,
  getGoogleOAuthClientStatus,
  handleGoogleAuthCallback,
  listGoogleAccounts,
  reorderGoogleAccounts,
  setupGoogleOAuthClient,
  startGoogleAuth,
  stopGoogleAuth,
} from "../src/main/auth/auth";
import { sendRendererEvent } from "../src/main/electron/renderer-events";
import type { getMainWindow } from "../src/main/window/create-window";

const electronState = vi.hoisted(() => {
  const clientId = "test-client-id.apps.googleusercontent.com";
  const clientSecret = "test-desktop-client-secret";

  return {
    canceled: false,
    clientId,
    clientSecret,
    credentialsPath: "",
    openedUrls: [] as string[],
    userDataPath: "",
  };
});

interface TestDatabaseState {
  client?: ReturnType<typeof createRemoteDatabaseClient>;
}

const databaseState = vi.hoisted((): TestDatabaseState => ({}));

vi.mock(import("electron"), async (importOriginal) => {
  const original = await importOriginal();

  return {
    ...original,
    BrowserWindow: Object.assign(vi.fn(), original.BrowserWindow, {
      getAllWindows: vi.fn<typeof Electron.BrowserWindow.getAllWindows>(
        () => []
      ),
    }),
    app: {
      ...original.app,
      focus: vi.fn<typeof Electron.app.focus>(),
      getPath: vi.fn<typeof Electron.app.getPath>((name) =>
        name === "userData"
          ? electronState.userDataPath
          : original.app.getPath(name)
      ),
    },
    dialog: {
      ...original.dialog,
      showOpenDialog: vi.fn<typeof Electron.dialog.showOpenDialog>(() =>
        Promise.resolve({
          canceled: electronState.canceled,
          filePaths: electronState.canceled
            ? []
            : [electronState.credentialsPath],
        })
      ),
    },
    safeStorage: {
      ...original.safeStorage,
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
    },
    shell: {
      ...original.shell,
      openExternal: vi.fn<typeof Electron.shell.openExternal>((url) => {
        electronState.openedUrls.push(url);
        return Promise.resolve();
      }),
    },
  };
});

vi.mock(import("../src/main/database-query"), async () => {
  const { DatabaseError } = await import("@repo/database/runtime");
  const { Effect: EffectModule } = await import("effect");

  return {
    withDatabaseClient: <A>(
      run: (
        database: ReturnType<typeof createRemoteDatabaseClient>
      ) => Promise<A>
    ) =>
      EffectModule.tryPromise({
        catch: (cause) => DatabaseError.new({ cause, reason: "query" }),
        try: () => {
          if (databaseState.client === undefined) {
            throw new Error("Test database client is not initialized");
          }
          return run(databaseState.client);
        },
      }),
  };
});

vi.mock(import("../src/main/electron/renderer-events"), () => ({
  sendRendererEvent: vi.fn<typeof sendRendererEvent>(),
}));

vi.mock(import("../src/main/auth/account-events"), () => ({
  notifyGoogleAccountConnected: vi.fn<typeof notifyGoogleAccountConnected>(),
}));

vi.mock(import("../src/main/window/create-window"), () => ({
  getMainWindow: vi.fn<typeof getMainWindow>(),
}));

const connection = openDatabaseConnection(":memory:");
applyDatabaseMigrations(
  createDatabaseClient(connection),
  fileURLToPath(new URL("../../../packages/database/drizzle", import.meta.url))
);

const executeRemoteQuery: DatabaseRemoteCallback = (
  query,
  parameters,
  method
) => {
  const statement = connection.prepare(query);

  if (method === "run") {
    statement.run(...parameters);
    return Promise.resolve({ rows: [] });
  }

  const dataStatement = statement.raw(true);
  if (method === "get") {
    const row = dataStatement.get(...parameters);
    return Promise.resolve({ rows: Array.isArray(row) ? row : [] });
  }

  return Promise.resolve({ rows: dataStatement.all(...parameters) });
};

databaseState.client = createRemoteDatabaseClient(executeRemoteQuery);

const SavedCredentials = Schema.Struct({
  accessToken: Schema.String,
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
  expiresAt: Schema.Finite,
  oauthClient: Schema.Literal("user-owned"),
  refreshToken: Schema.String,
});
const decodeSavedCredentials = Schema.decodeUnknownSync(SavedCredentials);

const insertAccount = (
  email: string,
  credentials: Buffer = Buffer.from([1]),
  sortOrder = 1
): void => {
  connection
    .prepare(
      `INSERT INTO google_accounts (
        created_at, credentials, email, scopes, sort_order, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(1, credentials, email, "[]", sortOrder, 1);
};

const createUserOwnedCredentials = (): Buffer =>
  Buffer.from(
    JSON.stringify({
      accessToken: "access-token",
      clientId: electronState.clientId,
      expiresAt: Date.now() + 60_000,
      oauthClient: "user-owned",
      refreshToken: "refresh-token",
    })
  );

const stubSuccessfulGoogleAuthorization = (email: string, name: string) => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        access_token: "new-access-token",
        expires_in: 3600,
        refresh_token: "new-refresh-token",
        scope: "openid email profile https://mail.google.com/",
        token_type: "Bearer",
      })
    )
    .mockResolvedValueOnce(Response.json({ emailAddress: email }))
    .mockResolvedValueOnce(Response.json({ email, name }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const startAuthorization = async () => {
  if (!(await Effect.runPromise(getGoogleOAuthClientStatus()))) {
    const didSetup = await Effect.runPromise(setupGoogleOAuthClient());

    if (!didSetup) {
      throw new Error("Expected Google OAuth setup to complete");
    }
  }
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
  beforeAll(async () => {
    electronState.userDataPath = await mkdtemp(
      path.join(tmpdir(), "kisa-google-auth-")
    );
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    stopGoogleAuth();
    await rm(electronState.userDataPath, { force: true, recursive: true });
    await mkdir(electronState.userDataPath, { recursive: true });
    electronState.canceled = false;
    electronState.credentialsPath = fileURLToPath(
      new URL("fixtures/google-desktop-oauth.json", import.meta.url)
    );
    electronState.openedUrls = [];
    connection.prepare("DELETE FROM google_accounts").run();
  });

  afterEach(() => {
    stopGoogleAuth();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  afterAll(async () => {
    connection.close();
    await rm(electronState.userDataPath, { force: true, recursive: true });
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

  it("stores one OAuth client and reuses it for later accounts", async () => {
    await Effect.runPromise(setupGoogleOAuthClient());
    electronState.credentialsPath = "/the/file-is-not-selected-again.json";
    await Effect.runPromise(startGoogleAuth());
    await Effect.runPromise(startGoogleAuth());

    expect(electronState.openedUrls).toHaveLength(2);
    expect(dialog.showOpenDialog).toHaveBeenCalledOnce();
    expect(safeStorage.encryptString).toHaveBeenCalledWith(
      JSON.stringify({
        clientId: electronState.clientId,
        clientSecret: electronState.clientSecret,
      })
    );
  });

  it("keeps Google login disabled when credential selection is canceled", async () => {
    electronState.canceled = true;

    await expect(
      Effect.runPromise(setupGoogleOAuthClient())
    ).resolves.toBeFalsy();
    await expect(
      Effect.runPromise(getGoogleOAuthClientStatus())
    ).resolves.toBeFalsy();
    expect(electronState.openedUrls).toStrictEqual([]);
  });

  it("rejects OAuth credentials created for a Web application", async () => {
    electronState.credentialsPath = fileURLToPath(
      new URL("fixtures/google-web-oauth.json", import.meta.url)
    );

    await expect(Effect.runPromise(setupGoogleOAuthClient())).rejects.toThrow(
      "Choose the Desktop OAuth credentials JSON downloaded from Google Cloud"
    );
    expect(electronState.openedUrls).toStrictEqual([]);
  });

  it("requires Google setup before sign-in", async () => {
    await expect(Effect.runPromise(startGoogleAuth())).rejects.toThrow(
      "Set up Google before signing in"
    );
    expect(electronState.openedUrls).toStrictEqual([]);
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

  it("connects more than nine Google accounts", async () => {
    for (let index = 0; index < 9; index += 1) {
      insertAccount(
        `person-${index}@example.com`,
        createUserOwnedCredentials(),
        index
      );
    }

    stubSuccessfulGoogleAuthorization("person-9@example.com", "Person 9");
    const { state } = await startAuthorization();

    await handleGoogleAuthCallback({ code: "authorization-code", state });

    expect(
      connection.prepare("SELECT count(*) FROM google_accounts").pluck().get()
    ).toBe(10);
    await expect(Effect.runPromise(listGoogleAccounts())).resolves.toHaveLength(
      10
    );
    expect(sendRendererEvent).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.anything(),
      {
        data: expect.arrayContaining([
          expect.objectContaining({
            displayName: "Person 9",
            email: "person-9@example.com",
          }),
        ]),
        ok: true,
      }
    );
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

  it("binds imported OAuth credentials to the connected account", async () => {
    const fetchMock = stubSuccessfulGoogleAuthorization(
      "person@example.com",
      "Person"
    );
    const { state } = await startAuthorization();

    await handleGoogleAuthCallback({ code: "authorization-code", state });

    const savedCredentials = connection
      .prepare("SELECT credentials FROM google_accounts WHERE email = ?")
      .pluck()
      .get("person@example.com");
    if (!Buffer.isBuffer(savedCredentials)) {
      throw new TypeError("Expected account credentials to be stored as bytes");
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      decodeSavedCredentials(JSON.parse(savedCredentials.toString("utf-8")))
    ).toMatchObject({
      accessToken: "new-access-token",
      clientId: electronState.clientId,
      clientSecret: electronState.clientSecret,
      oauthClient: "user-owned",
      refreshToken: "new-refresh-token",
    });
  });

  it("refreshes desktop credentials directly with Google", async () => {
    const account = {
      createdAt: 1,
      credentials: Buffer.from(
        JSON.stringify({
          accessToken: "expired-access-token",
          clientId: electronState.clientId,
          clientSecret: electronState.clientSecret,
          expiresAt: 1,
          oauthClient: "user-owned",
          refreshToken: "refresh-token",
        })
      ),
      email: "person@example.com",
      scopes: "[]",
      sortOrder: 1,
      updatedAt: 1,
    };
    insertAccount(account.email, account.credentials);
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
    const savedCredentials = connection
      .prepare("SELECT credentials FROM google_accounts WHERE email = ?")
      .pluck()
      .get(account.email);
    if (!Buffer.isBuffer(savedCredentials)) {
      throw new TypeError(
        "Expected encrypted credentials to be stored as bytes"
      );
    }
    expect(
      decodeSavedCredentials(JSON.parse(savedCredentials.toString("utf-8")))
    ).toMatchObject({
      accessToken: "fresh-access-token",
      clientId: electronState.clientId,
      clientSecret: electronState.clientSecret,
      oauthClient: "user-owned",
      refreshToken: "refresh-token",
    });
  });

  it("requires accounts from the retired shared client to reconnect", async () => {
    insertAccount(
      "legacy@example.com",
      Buffer.from(
        JSON.stringify({
          accessToken: "legacy-access-token",
          clientId: "retired-shared-client.apps.googleusercontent.com",
          expiresAt: Date.now() + 60_000,
          refreshToken: "legacy-refresh-token",
        })
      )
    );

    await expect(
      Effect.runPromise(listGoogleAccounts())
    ).resolves.toStrictEqual([]);
    await expect(
      Effect.runPromise(getGoogleAccessToken("legacy@example.com"))
    ).rejects.toThrow(
      "Google account must be connected again with your own credentials JSON"
    );
  });

  it("reorders reconnected accounts while legacy accounts remain hidden", async () => {
    insertAccount("first@example.com", createUserOwnedCredentials(), 1);
    insertAccount("legacy@example.com", Buffer.from("{}"), 2);
    insertAccount("second@example.com", createUserOwnedCredentials(), 3);

    await expect(
      Effect.runPromise(
        reorderGoogleAccounts(["second@example.com", "first@example.com"])
      )
    ).resolves.toBeUndefined();

    expect(
      connection
        .prepare(
          "SELECT email, sort_order FROM google_accounts ORDER BY sort_order, email"
        )
        .all()
    ).toStrictEqual([
      { email: "second@example.com", sort_order: 0 },
      { email: "first@example.com", sort_order: 1 },
      { email: "legacy@example.com", sort_order: 2 },
    ]);
  });
});
