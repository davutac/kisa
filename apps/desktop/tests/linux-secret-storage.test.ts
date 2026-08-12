import { describe, expect, it, vi } from "vitest";

import {
  configureLinuxSecretStorage,
  getLinuxSecretStorageErrorMessage,
  isSecureLinuxStorageBackend,
} from "../src/main/app/linux-secret-storage";

const createCommandLine = (hasPasswordStoreSwitch = false) => ({
  appendSwitch: vi.fn<(switchName: string, value?: string) => void>(),
  hasSwitch: vi.fn<(switchName: string) => boolean>(
    (switchName: string) =>
      hasPasswordStoreSwitch && switchName === "password-store"
  ),
});

describe(configureLinuxSecretStorage, () => {
  it.each([
    "GNOME",
    "GNOME-Classic:GNOME",
    "X-Cinnamon",
    "KDE",
    "KDE:Plasma",
    "COSMIC",
    "XFCE",
  ])("keeps Electron's secure automatic selection for %s", (desktop) => {
    const commandLine = createCommandLine();

    configureLinuxSecretStorage({
      commandLine,
      currentDesktop: desktop,
      platform: "linux",
    });

    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "LXQt", "sway", "MATE"])(
    "forces Secret Service when %s lacks a secure automatic selection",
    (desktop) => {
      const commandLine = createCommandLine();

      configureLinuxSecretStorage({
        commandLine,
        currentDesktop: desktop,
        platform: "linux",
      });

      expect(commandLine.appendSwitch).toHaveBeenCalledExactlyOnceWith(
        "password-store",
        "gnome-libsecret"
      );
    }
  );

  it("respects an explicit password-store switch", () => {
    const commandLine = createCommandLine(true);

    configureLinuxSecretStorage({
      commandLine,
      currentDesktop: "LXQt",
      platform: "linux",
    });

    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it("does not configure another platform", () => {
    const commandLine = createCommandLine();

    configureLinuxSecretStorage({
      commandLine,
      currentDesktop: undefined,
      platform: "darwin",
    });

    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});

describe(isSecureLinuxStorageBackend, () => {
  it.each(["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"])(
    "accepts the protected %s backend",
    (backend) => {
      expect(isSecureLinuxStorageBackend(backend)).toBeTruthy();
    }
  );

  it.each(["basic_text", "unknown", "unexpected"])(
    "rejects the unprotected %s backend",
    (backend) => {
      expect(isSecureLinuxStorageBackend(backend)).toBeFalsy();
    }
  );
});

describe(getLinuxSecretStorageErrorMessage, () => {
  it("directs KDE users to KWallet", () => {
    expect(getLinuxSecretStorageErrorMessage("KDE:Plasma")).toContain(
      "KWallet"
    );
  });

  it("directs other desktops to a Secret Service provider", () => {
    expect(getLinuxSecretStorageErrorMessage("sway")).toContain(
      "GNOME Keyring"
    );
  });
});
