// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable unicorn/no-useless-undefined vitest/max-expects vitest/no-standalone-expect vitest/prefer-import-in-mock
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import {
  UPDATES_CHECK_CHANNEL,
  UPDATES_DOWNLOAD_CHANNEL,
  UPDATES_GET_STATUS_CHANNEL,
  UPDATES_INSTALL_CHANNEL,
} from "../src/shared/ipc/channels";
import type { UpdateStatus } from "../src/shared/update-status";

const state = vi.hoisted(() => ({
  checkForUpdates: vi.fn<() => Promise<UpdateStatus>>(() =>
    Promise.resolve({ state: "available" as const, version: "1.2.3" })
  ),
  downloadUpdate: vi.fn<() => Promise<UpdateStatus>>(() =>
    Promise.resolve({
      percent: 0,
      state: "downloading" as const,
      version: "1.2.3",
    })
  ),
  getUpdateStatus: vi.fn<() => UpdateStatus>(() => ({
    state: "available" as const,
    version: "1.2.3",
  })),
  installUpdate: vi.fn<() => void>(),
}));

vi.mock("../src/main/updates/updater", () => ({
  checkForUpdates: state.checkForUpdates,
  downloadUpdate: state.downloadUpdate,
  getUpdateStatus: state.getUpdateStatus,
  installUpdate: state.installUpdate,
}));

const { check, download, getStatus, install } =
  await import("../src/main/ipc/methods/updates");

describe("update IPC", () => {
  it.effect("exposes check, download, status, and install methods", () =>
    Effect.gen(function* updateIpc() {
      expect({
        check: check.channel,
        download: download.channel,
        getStatus: getStatus.channel,
        install: install.channel,
      }).toStrictEqual({
        check: UPDATES_CHECK_CHANNEL,
        download: UPDATES_DOWNLOAD_CHANNEL,
        getStatus: UPDATES_GET_STATUS_CHANNEL,
        install: UPDATES_INSTALL_CHANNEL,
      });

      expect(yield* check.handler(undefined)).toStrictEqual({
        state: "available",
        version: "1.2.3",
      });
      expect(yield* download.handler(undefined)).toStrictEqual({
        percent: 0,
        state: "downloading",
        version: "1.2.3",
      });
      expect(yield* getStatus.handler(undefined)).toStrictEqual({
        state: "available",
        version: "1.2.3",
      });
      yield* install.handler(undefined);

      expect(state.checkForUpdates).toHaveBeenCalledOnce();
      expect(state.downloadUpdate).toHaveBeenCalledOnce();
      expect(state.getUpdateStatus).toHaveBeenCalledOnce();
      expect(state.installUpdate).toHaveBeenCalledOnce();
    })
  );
});
