import type { UpdateStatus } from "../update-status";
import type { AppStartupReply } from "./app";
import type {
  GoogleAccount,
  GoogleAccountDisconnectRequest,
  GoogleAccountReorderReply,
  GoogleAccountReorderRequest,
  GoogleAccountsReply,
  GoogleAuthStartReply,
} from "./auth";
import type {
  GmailCachedThreadPageReply,
  GmailCachedThreadPageRequest,
  GmailLabelCatalogReply,
  GmailLabelCatalogRequest,
  GmailIndexProgressList,
  GmailMessageSendReply,
  GmailMessageSendRequest,
  GmailSearchRequest,
  GmailSearchResultsReply,
  GmailSenderSuggestionRequest,
  GmailSenderSuggestionsReply,
  GmailSyncStatus,
  GmailThreadMutationReply,
  GmailThreadMessageSendReply,
  GmailThreadMessageSendRequest,
  GmailThreadReadStateRequest,
  GmailThreadListUpdated,
  GmailThreadReply,
  GmailThreadRequest,
  GmailThreadUpdated,
  GmailTrustedImageSenderRequest,
  GmailTrustedImageSendersReply,
} from "./mail";
import type {
  AccountSettingsReply,
  AccountSettingsUpdateRequest,
} from "./settings";

export interface ElectronVersions {
  chrome: string;
  electron: string;
  node: string;
}

export interface DesktopBridge {
  checkForUpdates: () => Promise<UpdateStatus>;
  disconnectGoogleAccount: (
    request: GoogleAccountDisconnectRequest
  ) => Promise<GoogleAccountsReply>;
  getMailIndexProgress: () => Promise<GmailIndexProgressList>;
  getMailSyncStatus: () => Promise<GmailSyncStatus>;
  getPathForFile: (file: File) => string;
  getUpdateStatus: () => Promise<UpdateStatus>;
  getVersions: () => ElectronVersions;
  installUpdate: () => Promise<void>;
  listAccountSettings: () => Promise<AccountSettingsReply>;
  listCachedThreadPage: (
    request: GmailCachedThreadPageRequest
  ) => Promise<GmailCachedThreadPageReply>;
  listGmailLabels: (
    request: GmailLabelCatalogRequest
  ) => Promise<GmailLabelCatalogReply>;
  listGmailSenders: (
    request: GmailSenderSuggestionRequest
  ) => Promise<GmailSenderSuggestionsReply>;
  listGoogleAccounts: () => Promise<GoogleAccountsReply>;
  listTrustedImageSenders: () => Promise<GmailTrustedImageSendersReply>;
  loadThread: (request: GmailThreadRequest) => Promise<GmailThreadReply>;
  onAccountSettingsChanged: (
    listener: (reply: AccountSettingsReply) => void
  ) => () => void;
  onGoogleAccountsChanged: (
    listener: (reply: GoogleAccountsReply) => void
  ) => () => void;
  onMailIndexProgressChanged: (
    listener: (progress: GmailIndexProgressList) => void
  ) => () => void;
  onMailSyncStatusChanged: (
    listener: (status: GmailSyncStatus) => void
  ) => () => void;
  onMailThreadUpdated: (
    listener: (payload: GmailThreadUpdated) => void
  ) => () => void;
  onMailThreadListUpdated: (
    listener: (payload: GmailThreadListUpdated) => void
  ) => () => void;
  onTrustedImageSendersChanged: (
    listener: (reply: GmailTrustedImageSendersReply) => void
  ) => () => void;
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
  reorderGoogleAccounts: (
    request: GoogleAccountReorderRequest
  ) => Promise<GoogleAccountReorderReply>;
  searchMail: (request: GmailSearchRequest) => Promise<GmailSearchResultsReply>;
  sendMessage: (
    request: GmailMessageSendRequest
  ) => Promise<GmailMessageSendReply>;
  sendThreadMessage: (
    request: GmailThreadMessageSendRequest
  ) => Promise<GmailThreadMessageSendReply>;
  setThreadReadState: (
    request: GmailThreadReadStateRequest
  ) => Promise<GmailThreadMutationReply>;
  startApp: () => Promise<AppStartupReply>;
  syncGmailLabels: (
    request: GmailLabelCatalogRequest
  ) => Promise<GmailLabelCatalogReply>;
  startGoogleAuth: () => Promise<GoogleAuthStartReply>;
  trashThread: (
    request: GmailThreadRequest
  ) => Promise<GmailThreadMutationReply>;
  trustImageSender: (
    request: GmailTrustedImageSenderRequest
  ) => Promise<GmailTrustedImageSendersReply>;
  updateAccountSettings: (
    request: AccountSettingsUpdateRequest
  ) => Promise<AccountSettingsReply>;
}

export type GoogleAccountsChangedListener = (
  accounts: readonly GoogleAccount[]
) => void;
