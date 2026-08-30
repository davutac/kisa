import { describe, expect, it } from "@effect/vitest";

import { getRuntimeCapabilities } from "../src/renderer/src/platform/desktop";
import { DEFAULT_APP_SETTINGS } from "../src/shared/ipc/app";
import type { DesktopBridge } from "../src/shared/ipc/bridge";

describe(getRuntimeCapabilities, () => {
  it("reports web mode when Electron is absent", () => {
    const capabilities = getRuntimeCapabilities({});

    expect(capabilities).toStrictEqual({
      ai: undefined,
      appSettings: undefined,
      auth: undefined,
      isWeb: true,
      lifecycle: undefined,
      loginItemSettings: undefined,
      mail: undefined,
      settings: undefined,
      startup: undefined,
      templates: undefined,
      updates: undefined,
      versions: undefined,
      window: undefined,
    });
  });

  it("does not mistake Electron with a missing bridge for the web app", () => {
    const capabilities = getRuntimeCapabilities({
      navigator: { userAgent: "Mozilla/5.0 Electron/43.3.0" },
    });

    expect(capabilities).toStrictEqual({
      ai: undefined,
      appSettings: undefined,
      auth: undefined,
      isWeb: false,
      lifecycle: undefined,
      loginItemSettings: undefined,
      mail: undefined,
      settings: undefined,
      startup: undefined,
      templates: undefined,
      updates: undefined,
      versions: undefined,
      window: undefined,
    });
  });

  const versions = { app: "0", chrome: "1", electron: "2", node: "3" };
  const aiSettings = {
    activeProvider: null,
    cleanupUserInstructions: "Cleanup",
    providerModels: {
      claude: "claude-sonnet-5",
      codex: "gpt-5.6-luna",
      opencode: null,
    },
    providerReasoning: { claude: null, codex: "low", opencode: null },
    replyUserInstructions: "Reply",
  } as const;
  const createDesktopBridge = (): DesktopBridge => ({
    authorizeOutgoingAttachments: () =>
      Promise.resolve({ data: [], ok: true as const }),
    beginDatabaseImport: () =>
      Promise.resolve({ data: { sessionId: "import-1" }, ok: true as const }),
    bulkMutateThreads: () =>
      Promise.resolve({
        data: { failed: [], succeeded: [] },
        ok: true as const,
      }),
    cancelDatabaseImport: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    categorizeThread: () =>
      Promise.resolve({ data: { labelIds: [] }, ok: true as const }),
    checkForUpdates: () => Promise.resolve({ state: "idle" as const }),
    cleanupEmailDraft: () =>
      Promise.resolve({ data: { body: "Body", subject: "Subject" }, ok: true }),
    createGmailLabel: (request) =>
      Promise.resolve({
        data: { id: "Label_1", name: request.name, type: "user" },
        ok: true as const,
      }),
    deleteComposerTemplate: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    deleteGmailLabel: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    deleteThreadForever: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    discardMailDraft: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    disconnectGoogleAccount: () =>
      Promise.resolve({ data: [], ok: true as const }),
    downloadUpdate: () => Promise.resolve({ state: "idle" as const }),
    dropDatabaseImportFile: () =>
      Promise.resolve({ data: { fileName: "app.sqlite" }, ok: true as const }),
    exportDatabaseRecoveryKey: () =>
      Promise.resolve({ data: "saved" as const, ok: true as const }),
    generateEmailReply: () =>
      Promise.resolve({ data: { body: "Reply" }, ok: true }),
    getAiSettings: () =>
      Promise.resolve({
        data: aiSettings,
        ok: true,
      }),
    getLoginItemSettings: () =>
      Promise.resolve({
        data: { openAtLogin: false, requiresApproval: false },
        ok: true as const,
      }),
    getMailIndexProgress: () => Promise.resolve({ accounts: [] }),
    getMailSyncStatus: () => Promise.resolve({ accountIds: [] }),
    getSpamStatus: () =>
      Promise.resolve({ data: { hasUnreadSpam: false }, ok: true as const }),
    getUpdateStatus: () => Promise.resolve({ state: "idle" as const }),
    getVersions: () => versions,
    importDatabase: () =>
      Promise.resolve({ data: "restart-pending" as const, ok: true as const }),
    installUpdate: () => Promise.resolve(),
    launchAtLoginSupported: true,
    listAccountSettings: () => Promise.resolve({ data: [], ok: true as const }),
    listAiProviders: () => Promise.resolve({ data: [], ok: true }),
    listCachedThreadPage: () =>
      Promise.resolve({ data: { threads: [] }, ok: true as const }),
    listComposerTemplates: () =>
      Promise.resolve({ data: [], ok: true as const }),
    listGmailLabels: () =>
      Promise.resolve({ data: { labels: [] }, ok: true as const }),
    listGmailSenders: () =>
      Promise.resolve({ data: { senders: [] }, ok: true as const }),
    listGoogleAccounts: () => Promise.resolve({ data: [], ok: true as const }),
    listStashedDrafts: () => Promise.resolve({ data: [], ok: true as const }),
    listTrustedImageSenders: () =>
      Promise.resolve({ data: [], ok: true as const }),
    loadThread: () =>
      Promise.resolve({
        data: {
          accountId: "person@example.com",
          labels: [],
          messages: [],
          subject: "Subject",
          threadId: "thread-id",
        },
        ok: true as const,
      }),
    loadThreadDraft: () => Promise.resolve({ data: null, ok: true as const }),
    markThreadNotSpam: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    onAccountSettingsChanged: () => () => {},
    onAppClosing: () => () => {},
    onComposerTemplateChanged: () => () => {},
    onDatabaseImportProgress: () => () => {},
    onGoogleAccountsChanged: () => () => {},
    onMailDraftChanged: () => () => {},
    onMailIndexProgressChanged: () => () => {},
    onMailLabelCatalogChanged: () => () => {},
    onMailSyncStatusChanged: () => () => {},
    onMailThreadListUpdated: () => () => {},
    onMailThreadUpdated: () => () => {},
    onTrustedImageSendersChanged: () => () => {},
    onUpdateStatus: () => () => {},
    openAttachmentPreview: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    openThreadWindow: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    prepareOutgoingAttachments: () =>
      Promise.resolve({ data: [], ok: true as const }),
    reindexMail: () => Promise.resolve({ data: undefined, ok: true as const }),
    reorderGoogleAccounts: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    saveAttachment: () =>
      Promise.resolve({ data: "saved" as const, ok: true as const }),
    saveComposerTemplate: (request) =>
      Promise.resolve({
        data: { ...request, createdAt: 1, updatedAt: 1 },
        ok: true as const,
      }),
    saveMailDraft: (request) =>
      Promise.resolve({
        data: { ...request, createdAt: 1, updatedAt: 1 },
        ok: true as const,
      }),
    searchMail: () =>
      Promise.resolve({
        data: { hasMore: false, threads: [] },
        ok: true as const,
      }),
    selectDatabaseImportFile: () =>
      Promise.resolve({ data: { fileName: "app.sqlite" }, ok: true as const }),
    sendMessage: () => Promise.resolve({ data: undefined, ok: true as const }),
    sendThreadMessage: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    setAppSettings: (request) =>
      Promise.resolve({
        data: request,
        ok: true as const,
      }),
    setLoginItemSettings: (request) =>
      Promise.resolve({
        data: { ...request, requiresApproval: false },
        ok: true as const,
      }),
    setThreadLabel: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    setThreadReadState: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    startApp: () =>
      Promise.resolve({
        appSettings: { ...DEFAULT_APP_SETTINGS, runInBackground: false },
        ok: true as const,
      }),
    startGoogleAuth: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    syncGmailLabels: () =>
      Promise.resolve({ data: { labels: [] }, ok: true as const }),
    trashThread: () => Promise.resolve({ data: undefined, ok: true as const }),
    trustImageSender: () => Promise.resolve({ data: [], ok: true as const }),
    updateAccountSettings: () =>
      Promise.resolve({ data: [], ok: true as const }),
    updateAiSettings: () =>
      Promise.resolve({
        data: aiSettings,
        ok: true,
      }),
    updateGmailLabel: (request) =>
      Promise.resolve({
        data: {
          color: request.color,
          id: request.labelId,
          name: request.name,
          type: "user",
        },
        ok: true as const,
      }),
  });

  it("returns capability values from the runtime window", () => {
    const desktopBridge = createDesktopBridge();
    const capabilities = getRuntimeCapabilities({ desktopBridge });

    expect(capabilities).toStrictEqual({
      ai: {
        categorizeThread: desktopBridge.categorizeThread,
        cleanupDraft: desktopBridge.cleanupEmailDraft,
        generateReply: desktopBridge.generateEmailReply,
        getSettings: desktopBridge.getAiSettings,
        listProviders: desktopBridge.listAiProviders,
        updateSettings: desktopBridge.updateAiSettings,
      },
      appSettings: {
        set: desktopBridge.setAppSettings,
      },
      auth: {
        disconnectGoogleAccount: desktopBridge.disconnectGoogleAccount,
        listGoogleAccounts: desktopBridge.listGoogleAccounts,
        onGoogleAccountsChanged: desktopBridge.onGoogleAccountsChanged,
        reorderGoogleAccounts: desktopBridge.reorderGoogleAccounts,
        startGoogle: desktopBridge.startGoogleAuth,
      },
      isWeb: false,
      lifecycle: {
        onClosing: desktopBridge.onAppClosing,
      },
      loginItemSettings: {
        get: desktopBridge.getLoginItemSettings,
        set: desktopBridge.setLoginItemSettings,
      },
      mail: {
        authorizeOutgoingAttachments:
          desktopBridge.authorizeOutgoingAttachments,
        bulkMutateThreads: desktopBridge.bulkMutateThreads,
        createLabel: desktopBridge.createGmailLabel,
        deleteLabel: desktopBridge.deleteGmailLabel,
        deleteThreadForever: desktopBridge.deleteThreadForever,
        discardDraft: desktopBridge.discardMailDraft,
        getIndexProgress: desktopBridge.getMailIndexProgress,
        getSpamStatus: desktopBridge.getSpamStatus,
        getSyncStatus: desktopBridge.getMailSyncStatus,
        listCachedThreadPage: desktopBridge.listCachedThreadPage,
        listLabels: desktopBridge.listGmailLabels,
        listSenders: desktopBridge.listGmailSenders,
        listStashedDrafts: desktopBridge.listStashedDrafts,
        listTrustedImageSenders: desktopBridge.listTrustedImageSenders,
        loadThread: desktopBridge.loadThread,
        loadThreadDraft: desktopBridge.loadThreadDraft,
        markThreadNotSpam: desktopBridge.markThreadNotSpam,
        onDraftChanged: desktopBridge.onMailDraftChanged,
        onIndexProgressChanged: desktopBridge.onMailIndexProgressChanged,
        onLabelCatalogChanged: desktopBridge.onMailLabelCatalogChanged,
        onSyncStatusChanged: desktopBridge.onMailSyncStatusChanged,
        onThreadListUpdated: desktopBridge.onMailThreadListUpdated,
        onThreadUpdated: desktopBridge.onMailThreadUpdated,
        onTrustedImageSendersChanged:
          desktopBridge.onTrustedImageSendersChanged,
        openAttachmentPreview: desktopBridge.openAttachmentPreview,
        prepareOutgoingAttachments: desktopBridge.prepareOutgoingAttachments,
        reindex: desktopBridge.reindexMail,
        saveAttachment: desktopBridge.saveAttachment,
        saveDraft: desktopBridge.saveMailDraft,
        search: desktopBridge.searchMail,
        sendMessage: desktopBridge.sendMessage,
        sendThreadMessage: desktopBridge.sendThreadMessage,
        setThreadLabel: desktopBridge.setThreadLabel,
        setThreadReadState: desktopBridge.setThreadReadState,
        syncLabels: desktopBridge.syncGmailLabels,
        trashThread: desktopBridge.trashThread,
        trustImageSender: desktopBridge.trustImageSender,
        updateLabel: desktopBridge.updateGmailLabel,
      },
      settings: {
        beginDatabaseImport: desktopBridge.beginDatabaseImport,
        cancelDatabaseImport: desktopBridge.cancelDatabaseImport,
        dropDatabaseImportFile: desktopBridge.dropDatabaseImportFile,
        exportDatabaseRecoveryKey: desktopBridge.exportDatabaseRecoveryKey,
        importDatabase: desktopBridge.importDatabase,
        listAccountSettings: desktopBridge.listAccountSettings,
        onAccountSettingsChanged: desktopBridge.onAccountSettingsChanged,
        onDatabaseImportProgress: desktopBridge.onDatabaseImportProgress,
        selectDatabaseImportFile: desktopBridge.selectDatabaseImportFile,
        updateAccountSettings: desktopBridge.updateAccountSettings,
      },
      startup: { start: desktopBridge.startApp },
      templates: {
        delete: desktopBridge.deleteComposerTemplate,
        list: desktopBridge.listComposerTemplates,
        onChanged: desktopBridge.onComposerTemplateChanged,
        save: desktopBridge.saveComposerTemplate,
      },
      updates: {
        check: desktopBridge.checkForUpdates,
        download: desktopBridge.downloadUpdate,
        getStatus: desktopBridge.getUpdateStatus,
        install: desktopBridge.installUpdate,
        onStatusChange: desktopBridge.onUpdateStatus,
      },
      versions,
      window: { openThread: desktopBridge.openThreadWindow },
    });
  });

  it("omits login item settings on unsupported platforms", () => {
    const desktopBridge = createDesktopBridge();
    desktopBridge.launchAtLoginSupported = false;

    expect(
      getRuntimeCapabilities({ desktopBridge }).loginItemSettings
    ).toBeUndefined();
  });

  it("reuses the capabilities it built for a bridge", () => {
    const desktopBridge = createDesktopBridge();
    const capabilities = getRuntimeCapabilities({ desktopBridge });
    const nextCapabilities = getRuntimeCapabilities({ desktopBridge });

    expect([
      nextCapabilities.ai === capabilities.ai,
      nextCapabilities.appSettings === capabilities.appSettings,
      nextCapabilities.auth === capabilities.auth,
      nextCapabilities.lifecycle === capabilities.lifecycle,
      nextCapabilities.loginItemSettings === capabilities.loginItemSettings,
      nextCapabilities.mail === capabilities.mail,
      nextCapabilities.settings === capabilities.settings,
      nextCapabilities.startup === capabilities.startup,
      nextCapabilities.templates === capabilities.templates,
      nextCapabilities.updates === capabilities.updates,
      nextCapabilities.window === capabilities.window,
    ]).toStrictEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});
