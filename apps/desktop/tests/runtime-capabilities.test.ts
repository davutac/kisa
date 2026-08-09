import { describe, expect, it } from "@effect/vitest";

import { getRuntimeCapabilities } from "../src/renderer/src/platform/desktop";
import type { DesktopBridge } from "../src/shared/ipc/bridge";

describe(getRuntimeCapabilities, () => {
  it("reports web mode when Electron is absent", () => {
    const capabilities = getRuntimeCapabilities({});

    expect(capabilities).toStrictEqual({
      auth: undefined,
      isWeb: true,
      lifecycle: undefined,
      mail: undefined,
      settings: undefined,
      startup: undefined,
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
      auth: undefined,
      isWeb: false,
      lifecycle: undefined,
      mail: undefined,
      settings: undefined,
      startup: undefined,
      updates: undefined,
      versions: undefined,
      window: undefined,
    });
  });

  const versions = { app: "0", chrome: "1", electron: "2", node: "3" };
  const createDesktopBridge = (): DesktopBridge => ({
    checkForUpdates: () => Promise.resolve({ state: "idle" as const }),
    disconnectGoogleAccount: () =>
      Promise.resolve({ data: [], ok: true as const }),
    getMailIndexProgress: () => Promise.resolve({ accounts: [] }),
    getMailSyncStatus: () => Promise.resolve({ accountIds: [] }),
    getPathForFile: () => "/tmp/attachment.txt",
    getUpdateStatus: () => Promise.resolve({ state: "idle" as const }),
    getVersions: () => versions,
    installUpdate: () => Promise.resolve(),
    listAccountSettings: () => Promise.resolve({ data: [], ok: true as const }),
    listCachedThreadPage: () =>
      Promise.resolve({ data: { threads: [] }, ok: true as const }),
    listGmailLabels: () =>
      Promise.resolve({ data: { labels: [] }, ok: true as const }),
    listGmailSenders: () =>
      Promise.resolve({ data: { senders: [] }, ok: true as const }),
    listGoogleAccounts: () => Promise.resolve({ data: [], ok: true as const }),
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
    onAccountSettingsChanged: () => () => {},
    onAppClosing: () => () => {},
    onGoogleAccountsChanged: () => () => {},
    onMailIndexProgressChanged: () => () => {},
    onMailSyncStatusChanged: () => () => {},
    onMailThreadListUpdated: () => () => {},
    onMailThreadUpdated: () => () => {},
    onTrustedImageSendersChanged: () => () => {},
    onUpdateStatus: () => () => {},
    openAttachmentPreview: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    openThreadWindow: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    reorderGoogleAccounts: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    saveAttachment: () =>
      Promise.resolve({ data: "saved" as const, ok: true as const }),
    searchMail: () =>
      Promise.resolve({
        data: { hasMore: false, threads: [] },
        ok: true as const,
      }),
    sendMessage: () => Promise.resolve({ data: undefined, ok: true as const }),
    sendThreadMessage: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    setThreadReadState: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    startApp: () => Promise.resolve({ ok: true as const }),
    startGoogleAuth: () =>
      Promise.resolve({ data: undefined, ok: true as const }),
    syncGmailLabels: () =>
      Promise.resolve({ data: { labels: [] }, ok: true as const }),
    trashThread: () => Promise.resolve({ data: undefined, ok: true as const }),
    trustImageSender: () => Promise.resolve({ data: [], ok: true as const }),
    updateAccountSettings: () =>
      Promise.resolve({ data: [], ok: true as const }),
  });

  it("returns capability values from the runtime window", () => {
    const desktopBridge = createDesktopBridge();
    const capabilities = getRuntimeCapabilities({ desktopBridge });

    expect(capabilities).toStrictEqual({
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
      mail: {
        getIndexProgress: desktopBridge.getMailIndexProgress,
        getSyncStatus: desktopBridge.getMailSyncStatus,
        listCachedThreadPage: desktopBridge.listCachedThreadPage,
        listLabels: desktopBridge.listGmailLabels,
        listSenders: desktopBridge.listGmailSenders,
        listTrustedImageSenders: desktopBridge.listTrustedImageSenders,
        loadThread: desktopBridge.loadThread,
        onIndexProgressChanged: desktopBridge.onMailIndexProgressChanged,
        onSyncStatusChanged: desktopBridge.onMailSyncStatusChanged,
        onThreadListUpdated: desktopBridge.onMailThreadListUpdated,
        onThreadUpdated: desktopBridge.onMailThreadUpdated,
        onTrustedImageSendersChanged:
          desktopBridge.onTrustedImageSendersChanged,
        openAttachmentPreview: desktopBridge.openAttachmentPreview,
        saveAttachment: desktopBridge.saveAttachment,
        search: desktopBridge.searchMail,
        sendMessage: desktopBridge.sendMessage,
        sendThreadMessage: desktopBridge.sendThreadMessage,
        setThreadReadState: desktopBridge.setThreadReadState,
        syncLabels: desktopBridge.syncGmailLabels,
        trashThread: desktopBridge.trashThread,
        trustImageSender: desktopBridge.trustImageSender,
      },
      settings: {
        listAccountSettings: desktopBridge.listAccountSettings,
        onAccountSettingsChanged: desktopBridge.onAccountSettingsChanged,
        updateAccountSettings: desktopBridge.updateAccountSettings,
      },
      startup: { start: desktopBridge.startApp },
      updates: {
        check: desktopBridge.checkForUpdates,
        getStatus: desktopBridge.getUpdateStatus,
        install: desktopBridge.installUpdate,
        onStatusChange: desktopBridge.onUpdateStatus,
      },
      versions,
      window: { openThread: desktopBridge.openThreadWindow },
    });
  });

  it("reuses the capabilities it built for a bridge", () => {
    const desktopBridge = createDesktopBridge();
    const capabilities = getRuntimeCapabilities({ desktopBridge });
    const nextCapabilities = getRuntimeCapabilities({ desktopBridge });

    expect([
      nextCapabilities.auth === capabilities.auth,
      nextCapabilities.lifecycle === capabilities.lifecycle,
      nextCapabilities.mail === capabilities.mail,
      nextCapabilities.settings === capabilities.settings,
      nextCapabilities.startup === capabilities.startup,
      nextCapabilities.updates === capabilities.updates,
      nextCapabilities.window === capabilities.window,
    ]).toStrictEqual([true, true, true, true, true, true, true]);
  });
});
