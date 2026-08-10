import path from "node:path";

import { is } from "@electron-toolkit/utils";
import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { DatabaseError } from "@repo/database/runtime";
import { Effect, ManagedRuntime } from "effect";
import { app, utilityProcess } from "electron";

// electron-vite exposes child entry points as a default module-path import.
// oxlint-disable-next-line import/default
import databaseProcessPath from "../utility/database-process/entry?modulePath";
import { getDatabasePath } from "./database-path";
import type { DatabaseProcessClient } from "./database-process/client";
import { createDatabaseProcessClient } from "./database-process/client";
import { DatabaseRpcClient } from "./database-process/rpc-client";

export { DatabaseError } from "@repo/database/runtime";

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

const createRuntime = () => {
  const databasePath = getDatabasePath({
    isDevelopment: is.dev,
    userDataPath: app.getPath("userData"),
  });
  const migrationsFolder = getMigrationsFolder();

  return ManagedRuntime.make(
    DatabaseRpcClient.layer(() =>
      utilityProcess.fork(
        databaseProcessPath,
        [databasePath, migrationsFolder],
        { serviceName: "Kisa Database", stdio: "inherit" }
      )
    )
  );
};

type DatabaseManagedRuntime = ReturnType<typeof createRuntime>;

let databaseClient: DatabaseProcessClient | null = null;
let databaseRuntime: DatabaseManagedRuntime | null = null;

const getRuntime = (): DatabaseManagedRuntime => {
  databaseRuntime ??= createRuntime();
  return databaseRuntime;
};

export const startDatabase = Effect.fn("startDatabase")(
  function* startDatabaseEffect() {
    if (databaseClient !== null) {
      return;
    }

    const runtime = getRuntime();
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

export const closeDatabase = Effect.fn("closeDatabase")(
  function* closeDatabaseEffect() {
    const runtime = databaseRuntime;
    databaseClient = null;
    databaseRuntime = null;

    if (runtime === null) {
      return;
    }

    yield* Effect.tryPromise({
      catch: (cause) => DatabaseError.new({ cause, reason: "open" }),
      try: () => runtime.dispose(),
    });
  }
);
