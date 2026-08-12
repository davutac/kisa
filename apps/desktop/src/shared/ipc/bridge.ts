import type { UpdateStatus } from "../update-status";
import type {
  AppStartupReply,
  ThreadWindowOpenReply,
  ThreadWindowOpenRequest,
} from "./app";
import type {
  GoogleAccount,
  GoogleAccountDisconnectRequest,
  GoogleAccountReorderReply,
  GoogleAccountReorderRequest,
  GoogleAccountsReply,
  GoogleAuthStartReply,
} from "./auth";
import type {
  GmailAttachmentActionReply,
  GmailAttachmentRequest,
  GmailAttachmentSaveReply,
  GmailCachedThreadPageReply,
  GmailCachedThreadPageRequest,
  GmailLabelCatalogReply,
  GmailLabelCatalogRequest,
  GmailIndexProgressList,
  MailDraftChanged,
  MailDraftDiscardReply,
  MailDraftDiscardRequest,
  MailDraftInput,
  MailDraftListReply,
  MailDraftListRequest,
  MailDraftLoadReply,
  MailDraftReply,
  GmailMessageSendReply,
  GmailMessageSendRequest,
  GmailOutgoingAttachmentPrepareReply,
  GmailOutgoingAttachmentPrepareRequest,
  GmailOutgoingAttachmentSelectionReply,
  GmailSearchRequest,
  GmailSearchResultsReply,
  GmailSenderSuggestionRequest,
  GmailSenderSuggestionsReply,
  GmailSpamStatusReply,
  GmailSpamStatusRequest,
  GmailSyncStatus,
  GmailThreadMutationReply,
  GmailThreadMessageSendReply,
  GmailThreadMessageSendRequest,
  GmailThreadLabelRequest,
  GmailThreadListUpdated,
  GmailThreadReply,
  GmailThreadReadStateRequest,
  GmailThreadRequest,
  GmailThreadUpdated,
  GmailTrustedImageSenderRequest,
  GmailTrustedImageSendersReply,
} from "./mail";
import type {
  AccountSettingsReply,
  AccountSettingsUpdateRequest,
  DatabaseImportCancelReply,
  DatabaseImportFileSelectionReply,
  DatabaseImportFileSelectionRequest,
  DatabaseImportFileKind,
  DatabaseImportReply,
  DatabaseImportProgress,
  DatabaseImportSession,
  DatabaseImportSessionReply,
  DatabaseRecoveryKeyExportReply,
} from "./settings";
import type {
  ComposerTemplateChanged,
  ComposerTemplateDeleteReply,
  ComposerTemplateDeleteRequest,
  ComposerTemplateInput,
  ComposerTemplateListReply,
  ComposerTemplateSaveReply,
} from "./templates";

export interface ElectronVersions {
  app: string;
  chrome: string;
  electron: string;
  node: string;
}

export interface DesktopBridge {
  authorizeOutgoingAttachments: (
    files: readonly File[]
  ) => Promise<GmailOutgoingAttachmentSelectionReply>;
  beginDatabaseImport: () => Promise<DatabaseImportSessionReply>;
  cancelDatabaseImport: (
    request: DatabaseImportSession
  ) => Promise<DatabaseImportCancelReply>;
  checkForUpdates: () => Promise<UpdateStatus>;
  deleteComposerTemplate: (
    request: ComposerTemplateDeleteRequest
  ) => Promise<ComposerTemplateDeleteReply>;
  deleteSpamThread: (
    request: GmailThreadRequest
  ) => Promise<GmailThreadMutationReply>;
  discardMailDraft: (
    request: MailDraftDiscardRequest
  ) => Promise<MailDraftDiscardReply>;
  disconnectGoogleAccount: (
    request: GoogleAccountDisconnectRequest
  ) => Promise<GoogleAccountsReply>;
  dropDatabaseImportFile: (request: {
    readonly file: File;
    readonly kind: DatabaseImportFileKind;
    readonly sessionId: string;
  }) => Promise<DatabaseImportFileSelectionReply>;
  exportDatabaseRecoveryKey: () => Promise<DatabaseRecoveryKeyExportReply>;
  getMailIndexProgress: () => Promise<GmailIndexProgressList>;
  getMailSyncStatus: () => Promise<GmailSyncStatus>;
  getSpamStatus: (
    request: GmailSpamStatusRequest
  ) => Promise<GmailSpamStatusReply>;
  getUpdateStatus: () => Promise<UpdateStatus>;
  getVersions: () => ElectronVersions;
  installUpdate: () => Promise<void>;
  importDatabase: (
    request: DatabaseImportSession
  ) => Promise<DatabaseImportReply>;
  listAccountSettings: () => Promise<AccountSettingsReply>;
  listComposerTemplates: () => Promise<ComposerTemplateListReply>;
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
  listStashedDrafts: (
    request: MailDraftListRequest
  ) => Promise<MailDraftListReply>;
  listTrustedImageSenders: () => Promise<GmailTrustedImageSendersReply>;
  loadThread: (request: GmailThreadRequest) => Promise<GmailThreadReply>;
  loadThreadDraft: (request: GmailThreadRequest) => Promise<MailDraftLoadReply>;
  markSpamSeen: (
    request: GmailSpamStatusRequest
  ) => Promise<GmailSpamStatusReply>;
  markThreadNotSpam: (
    request: GmailThreadRequest
  ) => Promise<GmailThreadMutationReply>;
  openAttachmentPreview: (
    request: GmailAttachmentRequest
  ) => Promise<GmailAttachmentActionReply>;
  onAccountSettingsChanged: (
    listener: (reply: AccountSettingsReply) => void
  ) => () => void;
  onComposerTemplateChanged: (
    listener: (change: ComposerTemplateChanged) => void
  ) => () => void;
  onDatabaseImportProgress: (
    listener: (progress: DatabaseImportProgress) => void
  ) => () => void;
  onAppClosing: (listener: () => void) => () => void;
  onGoogleAccountsChanged: (
    listener: (reply: GoogleAccountsReply) => void
  ) => () => void;
  onMailDraftChanged: (
    listener: (change: MailDraftChanged) => void
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
  openThreadWindow: (
    request: ThreadWindowOpenRequest
  ) => Promise<ThreadWindowOpenReply>;
  prepareOutgoingAttachments: (
    request: GmailOutgoingAttachmentPrepareRequest
  ) => Promise<GmailOutgoingAttachmentPrepareReply>;
  reorderGoogleAccounts: (
    request: GoogleAccountReorderRequest
  ) => Promise<GoogleAccountReorderReply>;
  searchMail: (request: GmailSearchRequest) => Promise<GmailSearchResultsReply>;
  saveAttachment: (
    request: GmailAttachmentRequest
  ) => Promise<GmailAttachmentSaveReply>;
  saveMailDraft: (request: MailDraftInput) => Promise<MailDraftReply>;
  saveComposerTemplate: (
    request: ComposerTemplateInput
  ) => Promise<ComposerTemplateSaveReply>;
  selectDatabaseImportFile: (
    request: DatabaseImportFileSelectionRequest
  ) => Promise<DatabaseImportFileSelectionReply>;
  sendMessage: (
    request: GmailMessageSendRequest
  ) => Promise<GmailMessageSendReply>;
  sendThreadMessage: (
    request: GmailThreadMessageSendRequest
  ) => Promise<GmailThreadMessageSendReply>;
  setThreadLabel: (
    request: GmailThreadLabelRequest
  ) => Promise<GmailThreadMutationReply>;
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
