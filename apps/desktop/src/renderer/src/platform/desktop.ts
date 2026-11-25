import type { DesktopBridge, ElectronVersions } from "@/shared/ipc/bridge";

interface RuntimeWindow {
  desktopBridge?: DesktopBridge;
  navigator?: Pick<Navigator, "userAgent">;
}

export interface AppStartupApi {
  start: DesktopBridge["startApp"];
}

export interface AppSettingsApi {
  set: DesktopBridge["setAppSettings"];
}

export interface LoginItemSettingsApi {
  get: DesktopBridge["getLoginItemSettings"];
  set: DesktopBridge["setLoginItemSettings"];
}

export interface AppLifecycleApi {
  onClosing: DesktopBridge["onAppClosing"];
}

export interface AiApi {
  categorizeThread: DesktopBridge["categorizeThread"];
  cleanupDraft: DesktopBridge["cleanupEmailDraft"];
  generateReply: DesktopBridge["generateEmailReply"];
  getSettings: DesktopBridge["getAiSettings"];
  listProviders: DesktopBridge["listAiProviders"];
  updateSettings: DesktopBridge["updateAiSettings"];
}

export interface WindowApi {
  openThread: DesktopBridge["openThreadWindow"];
}

export interface AccountsApi {
  disconnectAccount: DesktopBridge["disconnectAccount"];
  listAccounts: DesktopBridge["listAccounts"];
  onAccountsChanged: DesktopBridge["onAccountsChanged"];
  openAccountSetup: DesktopBridge["openAccountSetup"];
  openAccountSignIn: DesktopBridge["openAccountSignIn"];
  reorderAccounts: DesktopBridge["reorderAccounts"];
  updateAccountName: DesktopBridge["updateAccountName"];
}

export interface MailApi {
  authorizeOutgoingAttachments: DesktopBridge["authorizeOutgoingAttachments"];
  bulkMutateThreads: DesktopBridge["bulkMutateThreads"];
  createLabel: DesktopBridge["createLabel"];
  deleteLabel: DesktopBridge["deleteLabel"];
  updateLabel: DesktopBridge["updateLabel"];
  deleteThreadForever: DesktopBridge["deleteThreadForever"];
  discardDraft: DesktopBridge["discardMailDraft"];
  getIndexProgress: DesktopBridge["getMailIndexProgress"];
  getSyncStatus: DesktopBridge["getMailSyncStatus"];
  getUnreadCounts: DesktopBridge["getUnreadCounts"];
  getUnreadLabels: DesktopBridge["getUnreadLabels"];
  listCachedThreadPage: DesktopBridge["listCachedThreadPage"];
  listLabels: DesktopBridge["listLabels"];
  listSenders: DesktopBridge["listSenders"];
  listStashedDrafts: DesktopBridge["listStashedDrafts"];
  listTrustedImageSenders: DesktopBridge["listTrustedImageSenders"];
  loadOutgoingInlineImagePreview: DesktopBridge["loadOutgoingInlineImagePreview"];
  loadThread: DesktopBridge["loadThread"];
  loadThreadDraft: DesktopBridge["loadThreadDraft"];
  markThreadNotSpam: DesktopBridge["markThreadNotSpam"];
  reportThreadSpam: DesktopBridge["reportThreadSpam"];
  onDraftChanged: DesktopBridge["onMailDraftChanged"];
  onIndexProgressChanged: DesktopBridge["onMailIndexProgressChanged"];
  onLabelCatalogChanged: DesktopBridge["onMailLabelCatalogChanged"];
  onSyncStatusChanged: DesktopBridge["onMailSyncStatusChanged"];
  onThreadListUpdated: DesktopBridge["onMailThreadListUpdated"];
  onTrustedImageSendersChanged: DesktopBridge["onTrustedImageSendersChanged"];
  openAttachmentPreview: DesktopBridge["openAttachmentPreview"];
  prepareOutgoingAttachments: DesktopBridge["prepareOutgoingAttachments"];
  reindex: DesktopBridge["reindexMail"];
  search: DesktopBridge["searchMail"];
  saveAttachment: DesktopBridge["saveAttachment"];
  saveDraft: DesktopBridge["saveMailDraft"];
  cancelSend: DesktopBridge["cancelSend"];
  sendMessage: DesktopBridge["sendMessage"];
  sendThreadMessage: DesktopBridge["sendThreadMessage"];
  setThreadLabel: DesktopBridge["setThreadLabel"];
  setThreadReadState: DesktopBridge["setThreadReadState"];
  syncLabels: DesktopBridge["syncLabels"];
  trashThread: DesktopBridge["trashThread"];
  trustImageSender: DesktopBridge["trustImageSender"];
}

export interface ScheduledMailApi {
  beginEdit: DesktopBridge["beginScheduledMailEdit"];
  cancelToStash: DesktopBridge["cancelScheduledMailToStash"];
  discard: DesktopBridge["discardScheduledMail"];
  finishEdit: DesktopBridge["finishScheduledMailEdit"];
  getAttentionCount: DesktopBridge["getScheduledMailAttentionCount"];
  listPage: DesktopBridge["listScheduledMailPage"];
  onChanged: DesktopBridge["onScheduledMailChanged"];
  onOutcome: DesktopBridge["onScheduledMailOutcome"];
  schedule: DesktopBridge["scheduleMail"];
  sendNow: DesktopBridge["sendScheduledMailNow"];
}

export interface SettingsApi {
  beginDatabaseImport: DesktopBridge["beginDatabaseImport"];
  cancelDatabaseImport: DesktopBridge["cancelDatabaseImport"];
  discardDatabaseImport: DesktopBridge["discardDatabaseImport"];
  dropDatabaseImportFile: DesktopBridge["dropDatabaseImportFile"];
  exportDatabaseRecoveryKey: DesktopBridge["exportDatabaseRecoveryKey"];
  getDatabaseImportStatus: DesktopBridge["getDatabaseImportStatus"];
  importDatabase: DesktopBridge["importDatabase"];
  listAccountSettings: DesktopBridge["listAccountSettings"];
  onAccountSettingsChanged: DesktopBridge["onAccountSettingsChanged"];
  onDatabaseImportProgress: DesktopBridge["onDatabaseImportProgress"];
  restartForDatabaseImport: DesktopBridge["restartForDatabaseImport"];
  selectDatabaseImportFile: DesktopBridge["selectDatabaseImportFile"];
  updateAccountSettings: DesktopBridge["updateAccountSettings"];
}

export interface UpdateApi {
  check: DesktopBridge["checkForUpdates"];
  download: DesktopBridge["downloadUpdate"];
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
  accounts?: AccountsApi;
  ai?: AiApi;
  appSettings?: AppSettingsApi;
  isWeb: boolean;
  lifecycle?: AppLifecycleApi;
  loginItemSettings?: LoginItemSettingsApi;
  mail?: MailApi;
  scheduledMail?: ScheduledMailApi;
  settings?: SettingsApi;
  startup?: AppStartupApi;
  templates?: TemplateApi;
  updates?: UpdateApi;
  versions?: ElectronVersions;
  window?: WindowApi;
}

interface DesktopCapabilities {
  accounts: AccountsApi;
  ai: AiApi;
  appSettings: AppSettingsApi;
  lifecycle: AppLifecycleApi;
  loginItemSettings?: LoginItemSettingsApi;
  mail: MailApi;
  scheduledMail: ScheduledMailApi;
  settings: SettingsApi;
  startup: AppStartupApi;
  templates: TemplateApi;
  updates: UpdateApi;
  versions: ElectronVersions;
  window: WindowApi;
}

const capabilitiesByBridge = new WeakMap<DesktopBridge, DesktopCapabilities>();

const getRuntimeWindow = (): RuntimeWindow => window;

const getDesktopCapabilities = (bridge: DesktopBridge): DesktopCapabilities => {
  const cached = capabilitiesByBridge.get(bridge);

  if (cached !== undefined) {
    return cached;
  }

  const capabilities: DesktopCapabilities = {
    accounts: {
      disconnectAccount: bridge.disconnectAccount,
      listAccounts: bridge.listAccounts,
      onAccountsChanged: bridge.onAccountsChanged,
      openAccountSetup: bridge.openAccountSetup,
      openAccountSignIn: bridge.openAccountSignIn,
      reorderAccounts: bridge.reorderAccounts,
      updateAccountName: bridge.updateAccountName,
    },
    ai: {
      categorizeThread: bridge.categorizeThread,
      cleanupDraft: bridge.cleanupEmailDraft,
      generateReply: bridge.generateEmailReply,
      getSettings: bridge.getAiSettings,
      listProviders: bridge.listAiProviders,
      updateSettings: bridge.updateAiSettings,
    },
    appSettings: {
      set: bridge.setAppSettings,
    },
    lifecycle: { onClosing: bridge.onAppClosing },
    loginItemSettings: bridge.launchAtLoginSupported
      ? {
          get: bridge.getLoginItemSettings,
          set: bridge.setLoginItemSettings,
        }
      : undefined,
    mail: {
      authorizeOutgoingAttachments: bridge.authorizeOutgoingAttachments,
      bulkMutateThreads: bridge.bulkMutateThreads,
      createLabel: bridge.createLabel,
      deleteLabel: bridge.deleteLabel,
      deleteThreadForever: bridge.deleteThreadForever,
      discardDraft: bridge.discardMailDraft,
      getIndexProgress: bridge.getMailIndexProgress,
      getUnreadCounts: bridge.getUnreadCounts,
      getSyncStatus: bridge.getMailSyncStatus,
      getUnreadLabels: bridge.getUnreadLabels,
      listCachedThreadPage: bridge.listCachedThreadPage,
      listLabels: bridge.listLabels,
      listSenders: bridge.listSenders,
      listStashedDrafts: bridge.listStashedDrafts,
      listTrustedImageSenders: bridge.listTrustedImageSenders,
      loadOutgoingInlineImagePreview: bridge.loadOutgoingInlineImagePreview,
      loadThread: bridge.loadThread,
      loadThreadDraft: bridge.loadThreadDraft,
      markThreadNotSpam: bridge.markThreadNotSpam,
      reportThreadSpam: bridge.reportThreadSpam,
      onDraftChanged: bridge.onMailDraftChanged,
      onIndexProgressChanged: bridge.onMailIndexProgressChanged,
      onLabelCatalogChanged: bridge.onMailLabelCatalogChanged,
      onSyncStatusChanged: bridge.onMailSyncStatusChanged,
      onThreadListUpdated: bridge.onMailThreadListUpdated,
      onTrustedImageSendersChanged: bridge.onTrustedImageSendersChanged,
      openAttachmentPreview: bridge.openAttachmentPreview,
      prepareOutgoingAttachments: bridge.prepareOutgoingAttachments,
      reindex: bridge.reindexMail,
      saveAttachment: bridge.saveAttachment,
      saveDraft: bridge.saveMailDraft,
      search: bridge.searchMail,
      cancelSend: bridge.cancelSend,
      sendMessage: bridge.sendMessage,
      sendThreadMessage: bridge.sendThreadMessage,
      setThreadLabel: bridge.setThreadLabel,
      setThreadReadState: bridge.setThreadReadState,
      syncLabels: bridge.syncLabels,
      trashThread: bridge.trashThread,
      trustImageSender: bridge.trustImageSender,
      updateLabel: bridge.updateLabel,
    },
    scheduledMail: {
      beginEdit: bridge.beginScheduledMailEdit,
      cancelToStash: bridge.cancelScheduledMailToStash,
      discard: bridge.discardScheduledMail,
      finishEdit: bridge.finishScheduledMailEdit,
      getAttentionCount: bridge.getScheduledMailAttentionCount,
      listPage: bridge.listScheduledMailPage,
      onChanged: bridge.onScheduledMailChanged,
      onOutcome: bridge.onScheduledMailOutcome,
      schedule: bridge.scheduleMail,
      sendNow: bridge.sendScheduledMailNow,
    },
    settings: {
      beginDatabaseImport: bridge.beginDatabaseImport,
      cancelDatabaseImport: bridge.cancelDatabaseImport,
      discardDatabaseImport: bridge.discardDatabaseImport,
      dropDatabaseImportFile: bridge.dropDatabaseImportFile,
      exportDatabaseRecoveryKey: bridge.exportDatabaseRecoveryKey,
      getDatabaseImportStatus: bridge.getDatabaseImportStatus,
      importDatabase: bridge.importDatabase,
      listAccountSettings: bridge.listAccountSettings,
      onAccountSettingsChanged: bridge.onAccountSettingsChanged,
      onDatabaseImportProgress: bridge.onDatabaseImportProgress,
      restartForDatabaseImport: bridge.restartForDatabaseImport,
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
      download: bridge.downloadUpdate,
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
      accounts: undefined,
      ai: undefined,
      appSettings: undefined,
      isWeb: !isElectron,
      lifecycle: undefined,
      loginItemSettings: undefined,
      mail: undefined,
      scheduledMail: undefined,
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

export const getAppSettingsApi = (): AppSettingsApi | undefined =>
  getRuntimeCapabilities().appSettings;

export const getAppLifecycleApi = (): AppLifecycleApi | undefined =>
  getRuntimeCapabilities().lifecycle;

export const getAccountsApi = (): AccountsApi | undefined =>
  getRuntimeCapabilities().accounts;

export const getAiApi = (): AiApi | undefined => getRuntimeCapabilities().ai;

export const getMailApi = (): MailApi | undefined =>
  getRuntimeCapabilities().mail;

export const getScheduledMailApi = (): ScheduledMailApi | undefined =>
  getRuntimeCapabilities().scheduledMail;

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
