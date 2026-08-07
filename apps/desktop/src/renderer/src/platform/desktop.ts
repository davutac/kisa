import type { DesktopBridge, ElectronVersions } from "@/shared/ipc/bridge";

interface RuntimeWindow {
  desktopBridge?: DesktopBridge;
  navigator?: Pick<Navigator, "userAgent">;
}

export interface AppStartupApi {
  start: DesktopBridge["startApp"];
}

export interface AuthApi {
  disconnectGoogleAccount: DesktopBridge["disconnectGoogleAccount"];
  listGoogleAccounts: DesktopBridge["listGoogleAccounts"];
  onGoogleAccountsChanged: DesktopBridge["onGoogleAccountsChanged"];
  startGoogle: DesktopBridge["startGoogleAuth"];
}

export interface MailApi {
  getIndexProgress: DesktopBridge["getMailIndexProgress"];
  getSyncStatus: DesktopBridge["getMailSyncStatus"];
  listCachedThreadPage: DesktopBridge["listCachedThreadPage"];
  listLabels: DesktopBridge["listGmailLabels"];
  listSenders: DesktopBridge["listGmailSenders"];
  listTrustedImageSenders: DesktopBridge["listTrustedImageSenders"];
  loadThread: DesktopBridge["loadThread"];
  search: DesktopBridge["searchMail"];
  onIndexProgressChanged: DesktopBridge["onMailIndexProgressChanged"];
  onSyncStatusChanged: DesktopBridge["onMailSyncStatusChanged"];
  onThreadsChanged: DesktopBridge["onMailThreadsChanged"];
  onTrustedImageSendersChanged: DesktopBridge["onTrustedImageSendersChanged"];
  setThreadReadState: DesktopBridge["setThreadReadState"];
  syncLabels: DesktopBridge["syncGmailLabels"];
  trashThread: DesktopBridge["trashThread"];
  trustImageSender: DesktopBridge["trustImageSender"];
}

export interface SettingsApi {
  listAccountSettings: DesktopBridge["listAccountSettings"];
  onAccountSettingsChanged: DesktopBridge["onAccountSettingsChanged"];
  updateAccountSettings: DesktopBridge["updateAccountSettings"];
}

export interface UpdateApi {
  check: DesktopBridge["checkForUpdates"];
  getStatus: DesktopBridge["getUpdateStatus"];
  install: DesktopBridge["installUpdate"];
  onStatusChange: DesktopBridge["onUpdateStatus"];
}

export interface RuntimeCapabilities {
  auth?: AuthApi;
  isWeb: boolean;
  mail?: MailApi;
  settings?: SettingsApi;
  startup?: AppStartupApi;
  updates?: UpdateApi;
  versions?: ElectronVersions;
}

interface DesktopCapabilities {
  auth: AuthApi;
  mail: MailApi;
  settings: SettingsApi;
  startup: AppStartupApi;
  updates: UpdateApi;
  versions: ElectronVersions;
}

const capabilitiesByBridge = new WeakMap<DesktopBridge, DesktopCapabilities>();

const getRuntimeWindow = (): RuntimeWindow =>
  window as unknown as RuntimeWindow;

const getDesktopCapabilities = (bridge: DesktopBridge): DesktopCapabilities => {
  const cached = capabilitiesByBridge.get(bridge);

  if (cached !== undefined) {
    return cached;
  }

  const capabilities: DesktopCapabilities = {
    auth: {
      disconnectGoogleAccount: bridge.disconnectGoogleAccount,
      listGoogleAccounts: bridge.listGoogleAccounts,
      onGoogleAccountsChanged: bridge.onGoogleAccountsChanged,
      startGoogle: bridge.startGoogleAuth,
    },
    mail: {
      getIndexProgress: bridge.getMailIndexProgress,
      getSyncStatus: bridge.getMailSyncStatus,
      listCachedThreadPage: bridge.listCachedThreadPage,
      listLabels: bridge.listGmailLabels,
      listSenders: bridge.listGmailSenders,
      listTrustedImageSenders: bridge.listTrustedImageSenders,
      loadThread: bridge.loadThread,
      onIndexProgressChanged: bridge.onMailIndexProgressChanged,
      onSyncStatusChanged: bridge.onMailSyncStatusChanged,
      onThreadsChanged: bridge.onMailThreadsChanged,
      onTrustedImageSendersChanged: bridge.onTrustedImageSendersChanged,
      search: bridge.searchMail,
      setThreadReadState: bridge.setThreadReadState,
      syncLabels: bridge.syncGmailLabels,
      trashThread: bridge.trashThread,
      trustImageSender: bridge.trustImageSender,
    },
    settings: {
      listAccountSettings: bridge.listAccountSettings,
      onAccountSettingsChanged: bridge.onAccountSettingsChanged,
      updateAccountSettings: bridge.updateAccountSettings,
    },
    startup: { start: bridge.startApp },
    updates: {
      check: bridge.checkForUpdates,
      getStatus: bridge.getUpdateStatus,
      install: bridge.installUpdate,
      onStatusChange: bridge.onUpdateStatus,
    },
    versions: bridge.getVersions(),
  };

  capabilitiesByBridge.set(bridge, capabilities);
  return capabilities;
};

export const getRuntimeCapabilities = (
  runtimeWindow: RuntimeWindow = getRuntimeWindow()
): RuntimeCapabilities => {
  const bridge = runtimeWindow.desktopBridge;
  const isElectron =
    runtimeWindow.navigator?.userAgent.includes("Electron/") === true;

  if (bridge === undefined) {
    return {
      auth: undefined,
      isWeb: !isElectron,
      mail: undefined,
      settings: undefined,
      startup: undefined,
      updates: undefined,
      versions: undefined,
    };
  }

  return { ...getDesktopCapabilities(bridge), isWeb: false };
};

export const getStartupApi = (): AppStartupApi | undefined =>
  getRuntimeCapabilities().startup;

export const getAuthApi = (): AuthApi | undefined =>
  getRuntimeCapabilities().auth;

export const getMailApi = (): MailApi | undefined =>
  getRuntimeCapabilities().mail;

export const getSettingsApi = (): SettingsApi | undefined =>
  getRuntimeCapabilities().settings;

export const getUpdateApi = (): UpdateApi | undefined =>
  getRuntimeCapabilities().updates;

export const getElectronVersions = (): ElectronVersions | undefined =>
  getRuntimeCapabilities().versions;

export const isWebEnvironment = (): boolean => getRuntimeCapabilities().isWeb;
