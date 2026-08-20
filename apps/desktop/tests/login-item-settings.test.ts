import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ElectronLoginItemSettings {
  readonly executableWillLaunchAtLogin?: boolean;
  readonly openAtLogin?: boolean;
  readonly status?:
    | "enabled"
    | "not-found"
    | "not-registered"
    | "requires-approval";
}

const electron = vi.hoisted(() => ({
  getLoginItemSettings: vi.fn<() => ElectronLoginItemSettings>(),
  setLoginItemSettings:
    vi.fn<(settings: { readonly openAtLogin: boolean }) => void>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("electron", () => ({
  app: electron,
}));

const { readLoginItemSettings, updateLoginItemSettings } =
  await import("../src/main/settings/login-item-settings");

const setPlatform = (platform: NodeJS.Platform): void => {
  vi.spyOn(process, "platform", "get").mockReturnValue(platform);
};

describe("login item settings", () => {
  beforeEach(() => {
    electron.getLoginItemSettings.mockReset();
    electron.setLoginItemSettings.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the enabled macOS service state", () => {
    setPlatform("darwin");
    electron.getLoginItemSettings.mockReturnValue({
      openAtLogin: true,
      status: "enabled",
    });

    expect(readLoginItemSettings()).toStrictEqual({
      openAtLogin: true,
      requiresApproval: false,
    });
  });

  it("reports when macOS requires user approval", () => {
    setPlatform("darwin");
    electron.getLoginItemSettings.mockReturnValue({
      openAtLogin: true,
      status: "requires-approval",
    });

    expect(readLoginItemSettings()).toStrictEqual({
      openAtLogin: false,
      requiresApproval: true,
    });
  });

  it("reads whether Windows will launch the executable", () => {
    setPlatform("win32");
    electron.getLoginItemSettings.mockReturnValue({
      executableWillLaunchAtLogin: true,
    });

    expect(readLoginItemSettings()).toStrictEqual({
      openAtLogin: true,
      requiresApproval: false,
    });
  });

  it("returns disabled on unsupported platforms", () => {
    setPlatform("linux");
    electron.getLoginItemSettings.mockReturnValue({});

    expect(readLoginItemSettings()).toStrictEqual({
      openAtLogin: false,
      requiresApproval: false,
    });
  });

  it("returns the operating system state after an update", () => {
    setPlatform("win32");
    electron.getLoginItemSettings.mockReturnValue({
      executableWillLaunchAtLogin: true,
    });

    expect(updateLoginItemSettings(true)).toStrictEqual({
      openAtLogin: true,
      requiresApproval: false,
    });
    expect(electron.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
    });
  });
});
