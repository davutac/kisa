import path from "node:path";

import { is } from "@electron-toolkit/utils";
import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { DatabaseError } from "@repo/database/runtime";
import { Effect, ManagedRuntime } from "effect";
import { app, safeStorage, utilityProcess } from "electron";
// Electron's utility-process postMessage is not the DOM API.
// oxlint-disable unicorn/require-post-message-target-origin

import { SETTINGS_DATABASE_IMPORT_PROGRESS_CHANNEL } from "../shared/ipc/channels";
import type {
  DatabaseImportDroppedFileRequest,
  DatabaseImportFileSelectionRequest,
  DatabaseImportSession,
} from "../shared/ipc/settings";
import { DatabaseImportProgress } from "../shared/ipc/settings";
// electron-vite exposes child entry points as a default module-path import.
// oxlint-disable-next-line import/default
import databaseProcessPath from "../utility/database-process/entry?modulePath";
import {
  getLinuxSecretStorageErrorMessage,
  isSecureLinuxStorageBackend,
} from "./app/linux-secret-storage";
import {
  activatePendingDatabaseImport,
  attachDatabaseImportFile,
  cancelDatabaseImportSelection,
  importExistingDatabase,
  selectDatabaseImportFile as selectImportFile,
} from "./database-import";
import { loadOrCreateDatabaseKey } from "./database-key";
import { getDatabaseKeyPath, getDatabasePath } from "./database-path";
import type { DatabaseProcessClient } from "./database-process/client";
import { createDatabaseProcessClient } from "./database-process/client";
import { DatabaseRpcClient } from "./database-process/rpc-client";
import { exportDatabaseRecoveryKey as exportRecoveryKey } from "./database-recovery-key";
import { sendRendererEvent } from "./electron/renderer-events";

export { DatabaseError } from "@repo/database/runtime";
export { beginDatabaseImportSelection as beginDatabaseImport } from "./database-import";

const getMigrationsFolder = (): string => {
  if (is.dev) {
    return path.join(
      app.getAppPath(),
      "..",
      "..",
      "packages",
      "database",
      "drizzle"
    );
  }

  return path.join(process.resourcesPath, "database", "drizzle");
};

const requireSecureDatabaseKeyStorage = async (): Promise<void> => {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("Secure database key storage is unavailable");
  }

  if (
    process.platform === "linux" &&
    !isSecureLinuxStorageBackend(safeStorage.getSelectedStorageBackend())
  ) {
    throw new Error(
      getLinuxSecretStorageErrorMessage(process.env["XDG_CURRENT_DESKTOP"])
    );
  }
};

const databaseKeyProtector = {
  decrypt: async (encrypted: Buffer): Promise<string> => {
    await requireSecureDatabaseKeyStorage();
    let decrypted = await safeStorage.decryptStringAsync(encrypted);

    if (decrypted.shouldReEncrypt) {
      decrypted = await safeStorage.decryptStringAsync(encrypted);
    }

    return decrypted.result;
  },
  encrypt: async (plaintext: string): Promise<Buffer> => {
    await requireSecureDatabaseKeyStorage();
    return safeStorage.encryptStringAsync(plaintext);
  },
};

const createRuntime = (databasePath: string, databaseKey: Buffer) => {
  const migrationsFolder = getMigrationsFolder();

  return ManagedRuntime.make(
    DatabaseRpcClient.layer(() => {
      const child = utilityProcess.fork(
        databaseProcessPath,
        [databasePath, migrationsFolder],
        { serviceName: "Kisa Database", stdio: "inherit" }
      );
      child.postMessage({ _tag: "DatabaseUnlock", key: databaseKey });
      return child;
    })
  );
};

const loadDatabaseKey = (databasePath: string): Promise<Buffer> =>
  loadOrCreateDatabaseKey(
    getDatabaseKeyPath(databasePath),
    databaseKeyProtector
  );

const getActiveDatabasePath = (): string =>
  getDatabasePath({
    isDevelopment: is.dev,
    userDataPath: app.getPath("userData"),
  });

const validateImportedDatabase = async (
  databasePath: string,
  key: Uint8Array
): Promise<void> => {
  const validationKey = Buffer.from(key);
  const runtime = createRuntime(databasePath, validationKey);

  try {
    const rpc = await runtime.runPromise(DatabaseRpcClient);
    await runtime.runPromise(rpc.DatabaseReady());
    await runtime.runPromise(
      rpc.ExecuteDatabase({
        method: "all",
        params: [],
        sql: "PRAGMA wal_checkpoint(TRUNCATE)",
      })
    );
  } finally {
    try {
      await runtime.dispose();
    } finally {
      validationKey.fill(0);
    }
  }
};

type DatabaseManagedRuntime = ReturnType<typeof createRuntime>;

let databaseClient: DatabaseProcessClient | null = null;
let databaseKey: Buffer | null = null;
let databaseRuntime: DatabaseManagedRuntime | null = null;

const getDatabaseRuntime = Effect.fn("getDatabaseRuntime")(
  function* getDatabaseRuntimeEffect() {
    if (databaseRuntime !== null) {
      return databaseRuntime;
    }

    const databasePath = getActiveDatabasePath();
    yield* Effect.tryPromise({
      catch: (cause) => DatabaseError.new({ cause, reason: "open" }),
      try: () => activatePendingDatabaseImport(databasePath),
    });
    const nextDatabaseKey = yield* Effect.tryPromise({
      catch: (cause) => DatabaseError.new({ cause, reason: "open" }),
      try: () => loadDatabaseKey(databasePath),
    });

    databaseKey = nextDatabaseKey;
    databaseRuntime = createRuntime(databasePath, nextDatabaseKey);
    return databaseRuntime;
  }
);

export const startDatabase = Effect.fn("startDatabase")(
  function* startDatabaseEffect() {
    if (databaseClient !== null) {
      return;
    }

    const runtime = yield* getDatabaseRuntime();
    const rpc = yield* Effect.tryPromise({
      catch: (cause) => DatabaseError.new({ cause, reason: "open" }),
      try: async () => {
        const nextRpc = await runtime.runPromise(DatabaseRpcClient);
        await runtime.runPromise(nextRpc.DatabaseReady());
        return nextRpc;
      },
    });

    databaseClient = createDatabaseProcessClient((payload) =>
      rpc.ExecuteDatabase(payload)
    );
  }
);

export const withDatabaseClient = Effect.fn("withDatabaseClient")(
  function* withDatabaseClientEffect<A>(
    run: (database: RemoteDatabaseClient) => Promise<A>
  ): Effect.fn.Return<A, DatabaseError> {
    if (databaseClient === null) {
      return yield* DatabaseError.new({ reason: "not-ready" });
    }

    return yield* databaseClient.use((database) =>
      Effect.tryPromise({
        catch: (cause) => DatabaseError.new({ cause, reason: "query" }),
        try: () => run(database),
      })
    );
  }
);

export const exportDatabaseRecoveryKey = Effect.fn("exportDatabaseRecoveryKey")(
  function* exportDatabaseRecoveryKeyEffect() {
    yield* getDatabaseRuntime();
    const key = databaseKey;

    if (key === null) {
      return yield* DatabaseError.new({ reason: "not-ready" });
    }

    const exportKey = Buffer.from(key);

    return yield* exportRecoveryKey(exportKey, is.dev).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          exportKey.fill(0);
        })
      )
    );
  }
);

export const cancelDatabaseImport = Effect.fn("cancelDatabaseImport")(
  function* cancelDatabaseImportEffect(request: DatabaseImportSession) {
    yield* cancelDatabaseImportSelection(request.sessionId);
  }
);

export const selectDatabaseImportFile = Effect.fn("selectDatabaseImportFile")(
  function* selectDatabaseImportFileEffect(
    request: DatabaseImportFileSelectionRequest
  ) {
    return yield* selectImportFile(request.sessionId, request.kind);
  }
);

export const dropDatabaseImportFile = Effect.fn("dropDatabaseImportFile")(
  function* dropDatabaseImportFileEffect(
    request: DatabaseImportDroppedFileRequest
  ) {
    return yield* attachDatabaseImportFile(
      request.sessionId,
      request.kind,
      request.filePath
    );
  }
);

export const importDatabase = Effect.fn("importDatabase")(
  function* importDatabaseEffect(request: DatabaseImportSession) {
    return yield* importExistingDatabase({
      activeDatabasePath: getActiveDatabasePath(),
      isDevelopment: is.dev,
      keyEncryptor: databaseKeyProtector,
      onProgress: (progress) => {
        sendRendererEvent(
          SETTINGS_DATABASE_IMPORT_PROGRESS_CHANNEL,
          DatabaseImportProgress,
          progress
        );
      },
      sessionId: request.sessionId,
      validate: validateImportedDatabase,
    });
  }
);

export const closeDatabase = Effect.fn("closeDatabase")(
  function* closeDatabaseEffect() {
    const key = databaseKey;
    const runtime = databaseRuntime;
    databaseClient = null;
    databaseKey = null;
    databaseRuntime = null;

    if (runtime === null) {
      key?.fill(0);
      return;
    }

    yield* Effect.tryPromise({
      catch: (cause) => DatabaseError.new({ cause, reason: "open" }),
      try: () => runtime.dispose(),
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          key?.fill(0);
        })
      )
    );
  }
);
