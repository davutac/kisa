import type { UpdateStatus } from "../update-status";
import type { AccountSetupOpenReply } from "./account-setup";
import type {
  AccountDisconnectRequest,
  AccountNameUpdateRequest,
  AccountReorderReply,
  AccountReorderRequest,
  AccountSignInRequest,
  AccountsReply,
} from "./accounts";
import type {
  AiCleanupDraftReply,
  AiCleanupDraftRequest,
  AiProviderStatusListReply,
  AiReplyGenerationReply,
  AiReplyRequest,
  AiSettingsReply,
  AiSettingsUpdateRequest,
  AiThreadCategorizationReply,
  AiThreadCategorizationRequest,
} from "./ai";
import type {
  AppSettingsReply,
  AppSettingsUpdateRequest,
  AppStartupReply,
  LoginItemSettingsReply,
  LoginItemSettingsUpdateRequest,
  ThreadWindowOpenReply,
  ThreadWindowOpenRequest,
} from "./app";
import type {
  MailAttachmentActionReply,
  MailAttachmentRequest,
  MailAttachmentSaveReply,
  MailBulkThreadMutationReply,
  MailBulkThreadMutationRequest,
  MailCachedThreadPageReply,
  MailCachedThreadPageRequest,
  MailLabelCatalogReply,
  MailLabelCatalogChanged,
  MailLabelCatalogRequest,
  MailLabelCreateReply,
  MailLabelCreateRequest,
  MailLabelDeleteReply,
  MailLabelDeleteRequest,
  MailLabelUpdateReply,
  MailLabelUpdateRequest,
  MailIndexProgressList,
  MailDraftChanged,
  MailDraftDiscardReply,
  MailDraftDiscardRequest,
  MailDraftInput,
  MailDraftListReply,
  MailDraftListRequest,
  MailDraftLoadReply,
  MailDraftReply,
  MailMessageSendReply,
  MailMessageSendRequest,
  MailSendCancelReply,
  MailSendCancelRequest,
  MailOutgoingAttachmentPrepareReply,
  MailOutgoingAttachmentPrepareRequest,
  MailOutgoingAttachmentSelectionReply,
  MailOutgoingInlineImagePreviewReply,
  MailOutgoingInlineImagePreviewRequest,
  MailReindexReply,
  MailReindexRequest,
  MailSearchRequest,
  MailSearchResultsReply,
  MailSenderSuggestionRequest,
  MailSenderSuggestionsReply,
  MailSpamStatusReply,
  MailSpamStatusRequest,
  MailSyncStatus,
  MailUnreadLabelsReply,
  MailUnreadLabelsRequest,
  MailThreadMutationReply,
  MailThreadMessageSendReply,
  MailThreadMessageSendRequest,
  MailThreadLabelRequest,
  MailThreadListUpdated,
  MailThreadReply,
  MailThreadReadStateRequest,
  MailThreadLoadRequest,
  MailThreadRequest,
  MailTrustedImageSenderRequest,
  MailTrustedImageSendersReply,
} from "./mail";
import type {
  ScheduledMailActionReply,
  ScheduledMailAttentionCountReply,
  ScheduledMailChanged,
  ScheduledMailEditSessionReply,
  ScheduledMailFinishEditReply,
  ScheduledMailFinishEditRequest,
  ScheduledMailKey,
  ScheduledMailOutcome,
  ScheduledMailPageReply,
  ScheduledMailPageRequest,
  ScheduledMailScheduleRequest,
  ScheduledMailScope,
  ScheduledMailSendNowRequest,
  ScheduledMailSummaryReply,
} from "./scheduled-mail";
import type {
  AccountSettingsReply,
  AccountSettingsUpdateRequest,
  DatabaseImportCancelReply,
  DatabaseImportDiscardReply,
  DatabaseImportFileSelectionReply,
  DatabaseImportFileSelectionRequest,
  DatabaseImportFileKind,
  DatabaseImportReply,
  DatabaseImportProgress,
  DatabaseImportRestartReply,
  DatabaseImportSession,
  DatabaseImportSessionReply,
  DatabaseImportStatusReply,
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
  categorizeThread: (
    request: AiThreadCategorizationRequest
  ) => Promise<AiThreadCategorizationReply>;
  cleanupEmailDraft: (
    request: AiCleanupDraftRequest
  ) => Promise<AiCleanupDraftReply>;
  authorizeOutgoingAttachments: (
    files: readonly File[]
  ) => Promise<MailOutgoingAttachmentSelectionReply>;
  beginScheduledMailEdit: (
    request: ScheduledMailKey
  ) => Promise<ScheduledMailEditSessionReply>;
  beginDatabaseImport: () => Promise<DatabaseImportSessionReply>;
  bulkMutateThreads: (
    request: MailBulkThreadMutationRequest
  ) => Promise<MailBulkThreadMutationReply>;
  cancelDatabaseImport: (
    request: DatabaseImportSession
  ) => Promise<DatabaseImportCancelReply>;
  checkForUpdates: () => Promise<UpdateStatus>;
  createLabel: (
    request: MailLabelCreateRequest
  ) => Promise<MailLabelCreateReply>;
  deleteComposerTemplate: (
    request: ComposerTemplateDeleteRequest
  ) => Promise<ComposerTemplateDeleteReply>;
  deleteThreadForever: (
    request: MailThreadRequest
  ) => Promise<MailThreadMutationReply>;
  deleteLabel: (
    request: MailLabelDeleteRequest
  ) => Promise<MailLabelDeleteReply>;
  updateLabel: (
    request: MailLabelUpdateRequest
  ) => Promise<MailLabelUpdateReply>;
  discardMailDraft: (
    request: MailDraftDiscardRequest
  ) => Promise<MailDraftDiscardReply>;
  cancelScheduledMailToStash: (
    request: ScheduledMailKey
  ) => Promise<ScheduledMailActionReply>;
  discardScheduledMail: (
    request: ScheduledMailKey
  ) => Promise<ScheduledMailActionReply>;
  disconnectAccount: (
    request: AccountDisconnectRequest
  ) => Promise<AccountsReply>;
  /** Drops an import that is waiting for a restart. */
  discardDatabaseImport: () => Promise<DatabaseImportDiscardReply>;
  downloadUpdate: () => Promise<UpdateStatus>;
  dropDatabaseImportFile: (request: {
    readonly file: File;
    readonly kind: DatabaseImportFileKind;
    readonly sessionId: string;
  }) => Promise<DatabaseImportFileSelectionReply>;
  exportDatabaseRecoveryKey: () => Promise<DatabaseRecoveryKeyExportReply>;
  getDatabaseImportStatus: () => Promise<DatabaseImportStatusReply>;
  getMailIndexProgress: () => Promise<MailIndexProgressList>;
  getScheduledMailAttentionCount: (
    request: ScheduledMailScope
  ) => Promise<ScheduledMailAttentionCountReply>;
  getLoginItemSettings: () => Promise<LoginItemSettingsReply>;
  getAiSettings: () => Promise<AiSettingsReply>;
  getMailSyncStatus: () => Promise<MailSyncStatus>;
  getSpamStatus: (
    request: MailSpamStatusRequest
  ) => Promise<MailSpamStatusReply>;
  getUnreadLabels: (
    request: MailUnreadLabelsRequest
  ) => Promise<MailUnreadLabelsReply>;
  getUpdateStatus: () => Promise<UpdateStatus>;
  getVersions: () => ElectronVersions;
  installUpdate: () => Promise<void>;
  launchAtLoginSupported: boolean;
  importDatabase: (
    request: DatabaseImportSession
  ) => Promise<DatabaseImportReply>;
  listAccountSettings: () => Promise<AccountSettingsReply>;
  listAiProviders: () => Promise<AiProviderStatusListReply>;
  listComposerTemplates: () => Promise<ComposerTemplateListReply>;
  listCachedThreadPage: (
    request: MailCachedThreadPageRequest
  ) => Promise<MailCachedThreadPageReply>;
  listLabels: (
    request: MailLabelCatalogRequest
  ) => Promise<MailLabelCatalogReply>;
  listSenders: (
    request: MailSenderSuggestionRequest
  ) => Promise<MailSenderSuggestionsReply>;
  listAccounts: () => Promise<AccountsReply>;
  listStashedDrafts: (
    request: MailDraftListRequest
  ) => Promise<MailDraftListReply>;
  listScheduledMailPage: (
    request: ScheduledMailPageRequest
  ) => Promise<ScheduledMailPageReply>;
  listTrustedImageSenders: () => Promise<MailTrustedImageSendersReply>;
  loadOutgoingInlineImagePreview: (
    request: MailOutgoingInlineImagePreviewRequest
  ) => Promise<MailOutgoingInlineImagePreviewReply>;
  loadThread: (request: MailThreadLoadRequest) => Promise<MailThreadReply>;
  loadThreadDraft: (request: MailThreadRequest) => Promise<MailDraftLoadReply>;
  markThreadNotSpam: (
    request: MailThreadRequest
  ) => Promise<MailThreadMutationReply>;
  reportThreadSpam: (
    request: MailThreadRequest
  ) => Promise<MailThreadMutationReply>;
  /** Opens the Add account window, or focuses it. */
  openAccountSetup: () => Promise<AccountSetupOpenReply>;
  /** Opens the setup window to sign a connected account in again. */
  openAccountSignIn: (
    request: AccountSignInRequest
  ) => Promise<AccountSetupOpenReply>;
  openAttachmentPreview: (
    request: MailAttachmentRequest
  ) => Promise<MailAttachmentActionReply>;
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
  onAccountsChanged: (listener: (reply: AccountsReply) => void) => () => void;
  onMailDraftChanged: (
    listener: (change: MailDraftChanged) => void
  ) => () => void;
  onMailIndexProgressChanged: (
    listener: (progress: MailIndexProgressList) => void
  ) => () => void;
  onMailLabelCatalogChanged: (
    listener: (change: MailLabelCatalogChanged) => void
  ) => () => void;
  onMailSyncStatusChanged: (
    listener: (status: MailSyncStatus) => void
  ) => () => void;
  onMailThreadListUpdated: (
    listener: (payload: MailThreadListUpdated) => void
  ) => () => void;
  onScheduledMailChanged: (
    listener: (change: ScheduledMailChanged) => void
  ) => () => void;
  onScheduledMailOutcome: (
    listener: (outcome: ScheduledMailOutcome) => void
  ) => () => void;
  onTrustedImageSendersChanged: (
    listener: (reply: MailTrustedImageSendersReply) => void
  ) => () => void;
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
  openThreadWindow: (
    request: ThreadWindowOpenRequest
  ) => Promise<ThreadWindowOpenReply>;
  prepareOutgoingAttachments: (
    request: MailOutgoingAttachmentPrepareRequest
  ) => Promise<MailOutgoingAttachmentPrepareReply>;
  reindexMail: (request: MailReindexRequest) => Promise<MailReindexReply>;
  /** Restarts to activate a waiting import, or quits in development. */
  restartForDatabaseImport: () => Promise<DatabaseImportRestartReply>;
  reorderAccounts: (
    request: AccountReorderRequest
  ) => Promise<AccountReorderReply>;
  generateEmailReply: (
    request: AiReplyRequest
  ) => Promise<AiReplyGenerationReply>;
  searchMail: (request: MailSearchRequest) => Promise<MailSearchResultsReply>;
  saveAttachment: (
    request: MailAttachmentRequest
  ) => Promise<MailAttachmentSaveReply>;
  saveMailDraft: (request: MailDraftInput) => Promise<MailDraftReply>;
  scheduleMail: (
    request: ScheduledMailScheduleRequest
  ) => Promise<ScheduledMailSummaryReply>;
  saveComposerTemplate: (
    request: ComposerTemplateInput
  ) => Promise<ComposerTemplateSaveReply>;
  selectDatabaseImportFile: (
    request: DatabaseImportFileSelectionRequest
  ) => Promise<DatabaseImportFileSelectionReply>;
  /** Undo for a message waiting out the Undo send delay. */
  cancelSend: (request: MailSendCancelRequest) => Promise<MailSendCancelReply>;
  sendMessage: (
    request: MailMessageSendRequest
  ) => Promise<MailMessageSendReply>;
  sendScheduledMailNow: (
    request: ScheduledMailSendNowRequest
  ) => Promise<ScheduledMailActionReply>;
  sendThreadMessage: (
    request: MailThreadMessageSendRequest
  ) => Promise<MailThreadMessageSendReply>;
  setThreadLabel: (
    request: MailThreadLabelRequest
  ) => Promise<MailThreadMutationReply>;
  setThreadReadState: (
    request: MailThreadReadStateRequest
  ) => Promise<MailThreadMutationReply>;
  startApp: () => Promise<AppStartupReply>;
  syncLabels: (
    request: MailLabelCatalogRequest
  ) => Promise<MailLabelCatalogReply>;
  trashThread: (request: MailThreadRequest) => Promise<MailThreadMutationReply>;
  trustImageSender: (
    request: MailTrustedImageSenderRequest
  ) => Promise<MailTrustedImageSendersReply>;
  /** Sets an account's sender name and replies with every account. */
  updateAccountName: (
    request: AccountNameUpdateRequest
  ) => Promise<AccountsReply>;
  updateAccountSettings: (
    request: AccountSettingsUpdateRequest
  ) => Promise<AccountSettingsReply>;
  finishScheduledMailEdit: (
    request: ScheduledMailFinishEditRequest
  ) => Promise<ScheduledMailFinishEditReply>;
  setAppSettings: (
    request: AppSettingsUpdateRequest
  ) => Promise<AppSettingsReply>;
  setLoginItemSettings: (
    request: LoginItemSettingsUpdateRequest
  ) => Promise<LoginItemSettingsReply>;
  updateAiSettings: (
    request: AiSettingsUpdateRequest
  ) => Promise<AiSettingsReply>;
}
