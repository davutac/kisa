// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// The partial adapters keep this test at the settings IPC boundary.
// oxlint-disable unicorn/no-useless-undefined vitest/no-standalone-expect vitest/prefer-import-in-mock
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import {
  SETTINGS_BEGIN_DATABASE_IMPORT_CHANNEL,
  SETTINGS_CANCEL_DATABASE_IMPORT_CHANNEL,
  SETTINGS_DROP_DATABASE_IMPORT_FILE_CHANNEL,
  SETTINGS_EXPORT_DATABASE_RECOVERY_KEY_CHANNEL,
  SETTINGS_IMPORT_DATABASE_CHANNEL,
  SETTINGS_SELECT_DATABASE_IMPORT_FILE_CHANNEL,
} from "../src/shared/ipc/channels";

const state = vi.hoisted(() => ({
  beginDatabaseImport: vi.fn<
    () => Effect.Effect<{ readonly sessionId: string }>
  >(() => Effect.succeed({ sessionId: "import-1" })),
  cancelDatabaseImport: vi.fn<() => Effect.Effect<void>>(() => Effect.void),
  dropDatabaseImportFile: vi.fn<
    () => Effect.Effect<{ readonly fileName: string }>
  >(() => Effect.succeed({ fileName: "source.sqlite" })),
  exportRecoveryKey: vi.fn<() => Effect.Effect<"saved">>(() =>
    Effect.succeed("saved" as const)
  ),
  importDatabase: vi.fn<() => Effect.Effect<"restart-pending">>(() =>
    Effect.succeed("restart-pending" as const)
  ),
  selectDatabaseImportFile: vi.fn<
    () => Effect.Effect<{ readonly fileName: string }>
  >(() => Effect.succeed({ fileName: "source.sqlite" })),
}));

vi.mock("../src/main/database", () => ({
  beginDatabaseImport: state.beginDatabaseImport,
  cancelDatabaseImport: state.cancelDatabaseImport,
  dropDatabaseImportFile: state.dropDatabaseImportFile,
  exportDatabaseRecoveryKey: state.exportRecoveryKey,
  importDatabase: state.importDatabase,
  selectDatabaseImportFile: state.selectDatabaseImportFile,
}));

vi.mock("../src/main/settings/account-settings", () => ({
  listAccountSettings: () => Effect.succeed([]),
  updateAccountSettings: () => Effect.succeed([]),
}));

const {
  beginImport,
  cancelImport,
  dropImportFile,
  exportRecoveryKey,
  importExistingDatabase,
  selectImportFile,
} = await import("../src/main/ipc/methods/settings");

describe("settings IPC", () => {
  it.effect("exports only the recovery-key save outcome", () =>
    Effect.gen(function* exportRecoveryKeyThroughIpc() {
      const reply = yield* exportRecoveryKey.handler(undefined);

      expect(exportRecoveryKey.channel).toBe(
        SETTINGS_EXPORT_DATABASE_RECOVERY_KEY_CHANNEL
      );
      expect(reply).toStrictEqual({ data: "saved", ok: true });
      expect(state.exportRecoveryKey).toHaveBeenCalledOnce();
    })
  );

  it.effect("imports only the restart state", () =>
    Effect.gen(function* importDatabaseThroughIpc() {
      const request = { sessionId: "import-1" };
      const reply = yield* importExistingDatabase.handler(request);

      expect(importExistingDatabase.channel).toBe(
        SETTINGS_IMPORT_DATABASE_CHANNEL
      );
      expect(reply).toStrictEqual({ data: "restart-pending", ok: true });
      expect(state.importDatabase).toHaveBeenCalledWith(request);
    })
  );

  it.effect("selects import files through an opaque session", () =>
    Effect.gen(function* selectImportFilesThroughIpc() {
      const beginReply = yield* beginImport.handler(undefined);
      const request = { kind: "database" as const, sessionId: "import-1" };
      const selectionReply = yield* selectImportFile.handler(request);
      const dropReply = yield* dropImportFile.handler({
        ...request,
        filePath: "/private/source.sqlite",
      });
      const cancelReply = yield* cancelImport.handler({
        sessionId: "import-1",
      });

      expect({
        begin: beginImport.channel,
        cancel: cancelImport.channel,
        drop: dropImportFile.channel,
        select: selectImportFile.channel,
      }).toStrictEqual({
        begin: SETTINGS_BEGIN_DATABASE_IMPORT_CHANNEL,
        cancel: SETTINGS_CANCEL_DATABASE_IMPORT_CHANNEL,
        drop: SETTINGS_DROP_DATABASE_IMPORT_FILE_CHANNEL,
        select: SETTINGS_SELECT_DATABASE_IMPORT_FILE_CHANNEL,
      });
      expect({
        beginReply,
        cancelReply,
        dropReply,
        selectionReply,
      }).toStrictEqual({
        beginReply: {
          data: { sessionId: "import-1" },
          ok: true,
        },
        cancelReply: { data: undefined, ok: true },
        dropReply: {
          data: { fileName: "source.sqlite" },
          ok: true,
        },
        selectionReply: {
          data: { fileName: "source.sqlite" },
          ok: true,
        },
      });
      expect(state.selectDatabaseImportFile).toHaveBeenCalledWith(request);
    })
  );
});
