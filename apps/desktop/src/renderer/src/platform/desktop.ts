import type { DesktopBridge, ElectronVersions } from "@/shared/ipc/bridge";

interface RuntimeWindow {
  desktopBridge?: DesktopBridge;
  navigator?: Pick<Navigator, "userAgent">;
}

export interface AppStartupApi {
  start: DesktopBridge["startApp"];
}

export interface AppLifecycleApi {
  onClosing: DesktopBridge["onAppClosing"];
}

export interface WindowApi {
  openThread: DesktopBridge["openThreadWindow"];
}

export interface AuthApi {
  disconnectGoogleAccount: DesktopBridge["disconnectGoogleAccount"];
  listGoogleAccounts: DesktopBridge["listGoogleAccounts"];
  onGoogleAccountsChanged: DesktopBridge["onGoogleAccountsChanged"];
  reorderGoogleAccounts: DesktopBridge["reorderGoogleAccounts"];
  startGoogle: DesktopBridge["startGoogleAuth"];
}

export interface MailApi {
  authorizeOutgoingAttachments: DesktopBridge["authorizeOutgoingAttachments"];
  deleteSpamThread: DesktopBridge["deleteSpamThread"];
  discardDraft: DesktopBridge["discardMailDraft"];
  getIndexProgress: DesktopBridge["getMailIndexProgress"];
  getSyncStatus: DesktopBridge["getMailSyncStatus"];
  getSpamStatus: DesktopBridge["getSpamStatus"];
  listCachedThreadPage: DesktopBridge["listCachedThreadPage"];
  listLabels: DesktopBridge["listGmailLabels"];
  listSenders: DesktopBridge["listGmailSenders"];
  listStashedDrafts: DesktopBridge["listStashedDrafts"];
  listTrustedImageSenders: DesktopBridge["listTrustedImageSenders"];
  loadThread: DesktopBridge["loadThread"];
  loadThreadDraft: DesktopBridge["loadThreadDraft"];
  markSpamSeen: DesktopBridge["markSpamSeen"];
  markThreadNotSpam: DesktopBridge["markThreadNotSpam"];
  onDraftChanged: DesktopBridge["onMailDraftChanged"];
  onIndexProgressChanged: DesktopBridge["onMailIndexProgressChanged"];
  onSyncStatusChanged: DesktopBridge["onMailSyncStatusChanged"];
  onThreadListUpdated: DesktopBridge["onMailThreadListUpdated"];
  onThreadUpdated: DesktopBridge["onMailThreadUpdated"];
  onTrustedImageSendersChanged: DesktopBridge["onTrustedImageSendersChanged"];
  openAttachmentPreview: DesktopBridge["openAttachmentPreview"];
  prepareOutgoingAttachments: DesktopBridge["prepareOutgoingAttachments"];
  search: DesktopBridge["searchMail"];
  saveAttachment: DesktopBridge["saveAttachment"];
  saveDraft: DesktopBridge["saveMailDraft"];
  sendMessage: DesktopBridge["sendMessage"];
  sendThreadMessage: DesktopBridge["sendThreadMessage"];
  setThreadLabel: DesktopBridge["setThreadLabel"];
  setThreadReadState: DesktopBridge["setThreadReadState"];
  syncLabels: DesktopBridge["syncGmailLabels"];
  trashThread: DesktopBridge["trashThread"];
  trustImageSender: DesktopBridge["trustImageSender"];
}

export interface SettingsApi {
  beginDatabaseImport: DesktopBridge["beginDatabaseImport"];
  cancelDatabaseImport: DesktopBridge["cancelDatabaseImport"];
  dropDatabaseImportFile: DesktopBridge["dropDatabaseImportFile"];
  exportDatabaseRecoveryKey: DesktopBridge["exportDatabaseRecoveryKey"];
  importDatabase: DesktopBridge["importDatabase"];
  listAccountSettings: DesktopBridge["listAccountSettings"];
  onAccountSettingsChanged: DesktopBridge["onAccountSettingsChanged"];
  onDatabaseImportProgress: DesktopBridge["onDatabaseImportProgress"];
  selectDatabaseImportFile: DesktopBridge["selectDatabaseImportFile"];
  updateAccountSettings: DesktopBridge["updateAccountSettings"];
}

export interface UpdateApi {
  check: DesktopBridge["checkForUpdates"];
  getStatus: DesktopBridge["getUpdateStatus"];
  install: DesktopBridge["installUpdate"];
  onStatusChange: DesktopBridge["onUpdateStatus"];
}

export interface TemplateApi {
  delete: DesktopBridge["deleteComposerTemplate"];
  list: DesktopBridge["listComposerTemplates"];
  onChanged: DesktopBridge["onComposerTemplateChanged"];
  save: DesktopBridge["saveComposerTemplate"];
}

export interface RuntimeCapabilities {
  auth?: AuthApi;
  isWeb: boolean;
  lifecycle?: AppLifecycleApi;
  mail?: MailApi;
  settings?: SettingsApi;
  startup?: AppStartupApi;
  templates?: TemplateApi;
  updates?: UpdateApi;
  versions?: ElectronVersions;
  window?: WindowApi;
}

interface DesktopCapabilities {
  auth: AuthApi;
  lifecycle: AppLifecycleApi;
  mail: MailApi;
  settings: SettingsApi;
  startup: AppStartupApi;
  templates: TemplateApi;
  updates: UpdateApi;
  versions: ElectronVersions;
  window: WindowApi;
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
      reorderGoogleAccounts: bridge.reorderGoogleAccounts,
      startGoogle: bridge.startGoogleAuth,
    },
    lifecycle: { onClosing: bridge.onAppClosing },
    mail: {
      authorizeOutgoingAttachments: bridge.authorizeOutgoingAttachments,
      deleteSpamThread: bridge.deleteSpamThread,
      discardDraft: bridge.discardMailDraft,
      getIndexProgress: bridge.getMailIndexProgress,
      getSpamStatus: bridge.getSpamStatus,
      getSyncStatus: bridge.getMailSyncStatus,
      listCachedThreadPage: bridge.listCachedThreadPage,
      listLabels: bridge.listGmailLabels,
      listSenders: bridge.listGmailSenders,
      listStashedDrafts: bridge.listStashedDrafts,
      listTrustedImageSenders: bridge.listTrustedImageSenders,
      loadThread: bridge.loadThread,
      loadThreadDraft: bridge.loadThreadDraft,
      markSpamSeen: bridge.markSpamSeen,
      markThreadNotSpam: bridge.markThreadNotSpam,
      onDraftChanged: bridge.onMailDraftChanged,
      onIndexProgressChanged: bridge.onMailIndexProgressChanged,
      onSyncStatusChanged: bridge.onMailSyncStatusChanged,
      onThreadListUpdated: bridge.onMailThreadListUpdated,
      onThreadUpdated: bridge.onMailThreadUpdated,
      onTrustedImageSendersChanged: bridge.onTrustedImageSendersChanged,
      openAttachmentPreview: bridge.openAttachmentPreview,
      prepareOutgoingAttachments: bridge.prepareOutgoingAttachments,
      saveAttachment: bridge.saveAttachment,
      saveDraft: bridge.saveMailDraft,
      search: bridge.searchMail,
      sendMessage: bridge.sendMessage,
      sendThreadMessage: bridge.sendThreadMessage,
      setThreadLabel: bridge.setThreadLabel,
      setThreadReadState: bridge.setThreadReadState,
      syncLabels: bridge.syncGmailLabels,
      trashThread: bridge.trashThread,
      trustImageSender: bridge.trustImageSender,
    },
    settings: {
      beginDatabaseImport: bridge.beginDatabaseImport,
      cancelDatabaseImport: bridge.cancelDatabaseImport,
      dropDatabaseImportFile: bridge.dropDatabaseImportFile,
      exportDatabaseRecoveryKey: bridge.exportDatabaseRecoveryKey,
      importDatabase: bridge.importDatabase,
      listAccountSettings: bridge.listAccountSettings,
      onAccountSettingsChanged: bridge.onAccountSettingsChanged,
      onDatabaseImportProgress: bridge.onDatabaseImportProgress,
      selectDatabaseImportFile: bridge.selectDatabaseImportFile,
      updateAccountSettings: bridge.updateAccountSettings,
    },
    startup: { start: bridge.startApp },
    templates: {
      delete: bridge.deleteComposerTemplate,
      list: bridge.listComposerTemplates,
      onChanged: bridge.onComposerTemplateChanged,
      save: bridge.saveComposerTemplate,
    },
    updates: {
      check: bridge.checkForUpdates,
      getStatus: bridge.getUpdateStatus,
      install: bridge.installUpdate,
      onStatusChange: bridge.onUpdateStatus,
    },
    versions: bridge.getVersions(),
    window: { openThread: bridge.openThreadWindow },
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
      lifecycle: undefined,
      mail: undefined,
      settings: undefined,
      startup: undefined,
      templates: undefined,
      updates: undefined,
      versions: undefined,
      window: undefined,
    };
  }

  return { ...getDesktopCapabilities(bridge), isWeb: false };
};

export const getStartupApi = (): AppStartupApi | undefined =>
  getRuntimeCapabilities().startup;

export const getAppLifecycleApi = (): AppLifecycleApi | undefined =>
  getRuntimeCapabilities().lifecycle;

export const getAuthApi = (): AuthApi | undefined =>
  getRuntimeCapabilities().auth;

export const getMailApi = (): MailApi | undefined =>
  getRuntimeCapabilities().mail;

export const getSettingsApi = (): SettingsApi | undefined =>
  getRuntimeCapabilities().settings;

export const getUpdateApi = (): UpdateApi | undefined =>
  getRuntimeCapabilities().updates;

export const getTemplateApi = (): TemplateApi | undefined =>
  getRuntimeCapabilities().templates;

export const getElectronVersions = (): ElectronVersions | undefined =>
  getRuntimeCapabilities().versions;

export const getWindowApi = (): WindowApi | undefined =>
  getRuntimeCapabilities().window;

export const isWebEnvironment = (): boolean => getRuntimeCapabilities().isWeb;
