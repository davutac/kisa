// Adapted from T3 Code:
// https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/linuxSecretStorage.ts
const PASSWORD_STORE_SWITCH = "password-store";
const GNOME_LIBSECRET_PASSWORD_STORE = "gnome-libsecret";

const ELECTRON_SECURE_DESKTOPS = new Set([
  "cosmic",
  "deepin",
  "gnome",
  "kde",
  "pantheon",
  "plasma",
  "ukui",
  "unity",
  "x-cinnamon",
  "xfce",
]);

const SECURE_STORAGE_BACKENDS = new Set([
  "gnome_libsecret",
  "kwallet",
  "kwallet5",
  "kwallet6",
]);

interface CommandLineSwitches {
  readonly appendSwitch: (switchName: string, value?: string) => void;
  readonly hasSwitch: (switchName: string) => boolean;
}

interface LinuxSecretStorageOptions {
  readonly commandLine: CommandLineSwitches;
  readonly currentDesktop?: string;
  readonly platform: NodeJS.Platform;
}

const getDesktopNames = (currentDesktop: string | undefined): string[] =>
  currentDesktop
    ?.split(":")
    .map((desktop) => desktop.trim().toLowerCase())
    .filter((desktop) => desktop.length > 0) ?? [];

const isElectronSecureDesktop = (desktop: string): boolean =>
  ELECTRON_SECURE_DESKTOPS.has(desktop) ||
  desktop.startsWith("gnome-") ||
  desktop.startsWith("plasma") ||
  desktop.startsWith("xfce");

const shouldForceGnomeLibsecret = (
  currentDesktop: string | undefined
): boolean => !getDesktopNames(currentDesktop).some(isElectronSecureDesktop);

export const configureLinuxSecretStorage = ({
  commandLine,
  currentDesktop,
  platform,
}: LinuxSecretStorageOptions): void => {
  if (
    platform !== "linux" ||
    commandLine.hasSwitch(PASSWORD_STORE_SWITCH) ||
    !shouldForceGnomeLibsecret(currentDesktop)
  ) {
    return;
  }

  commandLine.appendSwitch(
    PASSWORD_STORE_SWITCH,
    GNOME_LIBSECRET_PASSWORD_STORE
  );
};

export const isSecureLinuxStorageBackend = (backend: string): boolean =>
  SECURE_STORAGE_BACKENDS.has(backend);

export const getLinuxSecretStorageErrorMessage = (
  currentDesktop: string | undefined
): string => {
  const isKde = getDesktopNames(currentDesktop).some(
    (desktop) => desktop === "kde" || desktop.startsWith("plasma")
  );

  if (isKde) {
    return "Kisa needs an unlocked KWallet for secure credential storage. Configure or unlock KWallet, then restart Kisa.";
  }

  return "Kisa needs an unlocked Secret Service provider, such as GNOME Keyring, for secure credential storage. Install or unlock it, then restart Kisa.";
};
