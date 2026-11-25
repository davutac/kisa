export const APP_START_CHANNEL = "desktop:app:start";
export const APP_CLOSING_CHANNEL = "desktop:app:closing";

export const APP_GET_LOGIN_ITEM_SETTINGS_CHANNEL =
  "desktop:app:get-login-item-settings";

export const APP_OPEN_THREAD_WINDOW_CHANNEL = "desktop:app:open-thread-window";

export const APP_SET_LOGIN_ITEM_SETTINGS_CHANNEL =
  "desktop:app:set-login-item-settings";

export const APP_UPDATE_SETTINGS_CHANNEL = "desktop:app:update-settings";

export const AI_CLEANUP_DRAFT_CHANNEL = "desktop:ai:cleanup-draft";
export const AI_CATEGORIZE_THREAD_CHANNEL = "desktop:ai:categorize-thread";
export const AI_GENERATE_REPLY_CHANNEL = "desktop:ai:generate-reply";
export const AI_GET_SETTINGS_CHANNEL = "desktop:ai:get-settings";
export const AI_LIST_PROVIDERS_CHANNEL = "desktop:ai:list-providers";
export const AI_UPDATE_SETTINGS_CHANNEL = "desktop:ai:update-settings";

export const ACCOUNTS_CHANGED_CHANNEL = "desktop:accounts:changed";
export const ACCOUNTS_DISCONNECT_CHANNEL = "desktop:accounts:disconnect";
export const ACCOUNTS_LIST_CHANNEL = "desktop:accounts:list";
export const ACCOUNTS_OPEN_SETUP_CHANNEL = "desktop:accounts:open-setup";
export const ACCOUNTS_OPEN_SIGN_IN_CHANNEL = "desktop:accounts:open-sign-in";
export const ACCOUNTS_REORDER_CHANNEL = "desktop:accounts:reorder";
export const ACCOUNTS_UPDATE_NAME_CHANNEL = "desktop:accounts:update-name";

// Only the Add account window's preload uses these, and it inlines them.
export const ACCOUNT_SETUP_CLOSE_CHANNEL = "desktop:account-setup:close";

export const ACCOUNT_SETUP_MICROSOFT_CANCEL_CHANNEL =
  "desktop:account-setup:microsoft-cancel";

export const ACCOUNT_SETUP_MICROSOFT_CHANNEL =
  "desktop:account-setup:microsoft";

export const ACCOUNT_SETUP_SUBMIT_CHANNEL = "desktop:account-setup:submit";

export const COMPOSER_TEMPLATE_CHANGED_CHANNEL =
  "desktop:composer-template:changed";

export const COMPOSER_TEMPLATE_DELETE_CHANNEL =
  "desktop:composer-template:delete";

export const COMPOSER_TEMPLATE_LIST_CHANNEL = "desktop:composer-template:list";
export const COMPOSER_TEMPLATE_SAVE_CHANNEL = "desktop:composer-template:save";

export const MAIL_INDEX_PROGRESS_CHANNEL = "desktop:mail:index-progress";
export const MAIL_REINDEX_CHANNEL = "desktop:mail:reindex";

export const MAIL_BULK_MUTATE_THREADS_CHANNEL =
  "desktop:mail:bulk-mutate-threads";

export const MAIL_DRAFT_CHANGED_CHANNEL = "desktop:mail:draft-changed";
export const MAIL_DISCARD_DRAFT_CHANNEL = "desktop:mail:discard-draft";

export const MAIL_DELETE_THREAD_FOREVER_CHANNEL =
  "desktop:mail:delete-thread-forever";

export const MAIL_LIST_STASHED_DRAFTS_CHANNEL =
  "desktop:mail:list-stashed-drafts";

export const MAIL_LOAD_OUTGOING_INLINE_IMAGE_PREVIEW_CHANNEL =
  "desktop:mail:load-outgoing-inline-image-preview";

export const MAIL_LOAD_THREAD_DRAFT_CHANNEL = "desktop:mail:load-thread-draft";

export const MAIL_OPEN_ATTACHMENT_PREVIEW_CHANNEL =
  "desktop:mail:open-attachment-preview";

export const MAIL_PREPARE_OUTGOING_ATTACHMENTS_CHANNEL =
  "desktop:mail:prepare-outgoing-attachments";

export const MAIL_SAVE_ATTACHMENT_CHANNEL = "desktop:mail:save-attachment";
export const MAIL_SAVE_DRAFT_CHANNEL = "desktop:mail:save-draft";

export const MAIL_LIST_CACHED_THREAD_PAGE_CHANNEL =
  "desktop:mail:list-cached-thread-page";

export const MAIL_CREATE_LABEL_CHANNEL = "desktop:mail:create-label";
export const MAIL_DELETE_LABEL_CHANNEL = "desktop:mail:delete-label";
export const MAIL_UPDATE_LABEL_CHANNEL = "desktop:mail:update-label";

export const MAIL_LABEL_CATALOG_CHANGED_CHANNEL =
  "desktop:mail:label-catalog-changed";

export const MAIL_LIST_LABELS_CHANNEL = "desktop:mail:list-labels";
export const MAIL_LIST_SENDERS_CHANNEL = "desktop:mail:list-senders";

export const MAIL_LIST_TRUSTED_IMAGE_SENDERS_CHANNEL =
  "desktop:mail:list-trusted-image-senders";

export const MAIL_LOAD_THREAD_CHANNEL = "desktop:mail:load-thread";
export const MAIL_GET_UNREAD_COUNTS_CHANNEL = "desktop:mail:get-unread-counts";
export const MAIL_GET_UNREAD_LABELS_CHANNEL = "desktop:mail:get-unread-labels";

export const MAIL_MARK_THREAD_NOT_SPAM_CHANNEL =
  "desktop:mail:mark-thread-not-spam";

export const MAIL_REPORT_THREAD_SPAM_CHANNEL =
  "desktop:mail:report-thread-spam";

export const MAIL_SEARCH_THREADS_CHANNEL = "desktop:mail:search-threads";

export const MAIL_AUTHORIZE_OUTGOING_ATTACHMENTS_CHANNEL =
  "desktop:mail:authorize-outgoing-attachments";

export const MAIL_SEND_MESSAGE_CHANNEL = "desktop:mail:send-message";
export const MAIL_CANCEL_SEND_CHANNEL = "desktop:mail:cancel-send";

export const MAIL_SEND_THREAD_MESSAGE_CHANNEL =
  "desktop:mail:send-thread-message";

export const MAIL_SET_THREAD_LABEL_CHANNEL = "desktop:mail:set-thread-label";
export const MAIL_SET_THREAD_READ_CHANNEL = "desktop:mail:set-thread-read";
export const MAIL_SYNC_LABELS_CHANNEL = "desktop:mail:sync-labels";
export const MAIL_SYNC_STATUS_CHANNEL = "desktop:mail:sync-status";

export const MAIL_THREAD_LIST_UPDATED_CHANNEL =
  "desktop:mail:thread-list-updated";

export const MAIL_TRASH_THREAD_CHANNEL = "desktop:mail:trash-thread";

export const MAIL_TRUST_IMAGE_SENDER_CHANNEL =
  "desktop:mail:trust-image-sender";

export const MAIL_TRUSTED_IMAGE_SENDERS_CHANGED_CHANNEL =
  "desktop:mail:trusted-image-senders-changed";

export const SCHEDULED_MAIL_ATTENTION_COUNT_CHANNEL =
  "desktop:scheduled-mail:attention-count";

export const SCHEDULED_MAIL_BEGIN_EDIT_CHANNEL =
  "desktop:scheduled-mail:begin-edit";

export const SCHEDULED_MAIL_CANCEL_TO_STASH_CHANNEL =
  "desktop:scheduled-mail:cancel-to-stash";

export const SCHEDULED_MAIL_CHANGED_CHANNEL = "desktop:scheduled-mail:changed";
export const SCHEDULED_MAIL_DISCARD_CHANNEL = "desktop:scheduled-mail:discard";

export const SCHEDULED_MAIL_FINISH_EDIT_CHANNEL =
  "desktop:scheduled-mail:finish-edit";

export const SCHEDULED_MAIL_LIST_PAGE_CHANNEL =
  "desktop:scheduled-mail:list-page";

export const SCHEDULED_MAIL_OUTCOME_CHANNEL = "desktop:scheduled-mail:outcome";

export const SCHEDULED_MAIL_OUTCOME_READINESS_CHANNEL =
  "desktop:scheduled-mail:outcome-readiness";

export const SCHEDULED_MAIL_SCHEDULE_CHANNEL =
  "desktop:scheduled-mail:schedule";

export const SCHEDULED_MAIL_SEND_NOW_CHANNEL =
  "desktop:scheduled-mail:send-now";

export const ATTACHMENT_PREVIEW_LOAD_CHANNEL =
  "desktop:attachment-preview:load";

export const ATTACHMENT_PREVIEW_SAVE_CHANNEL =
  "desktop:attachment-preview:save";

export const SETTINGS_ACCOUNT_SETTINGS_CHANGED_CHANNEL =
  "desktop:settings:account-settings-changed";

export const SETTINGS_BEGIN_DATABASE_IMPORT_CHANNEL =
  "desktop:settings:begin-database-import";

export const SETTINGS_CANCEL_DATABASE_IMPORT_CHANNEL =
  "desktop:settings:cancel-database-import";

export const SETTINGS_EXPORT_DATABASE_RECOVERY_KEY_CHANNEL =
  "desktop:settings:export-database-recovery-key";

export const SETTINGS_IMPORT_DATABASE_CHANNEL =
  "desktop:settings:import-database";

export const SETTINGS_DATABASE_IMPORT_STATUS_CHANNEL =
  "desktop:settings:database-import-status";

export const SETTINGS_DISCARD_DATABASE_IMPORT_CHANNEL =
  "desktop:settings:discard-database-import";

export const SETTINGS_RESTART_FOR_DATABASE_IMPORT_CHANNEL =
  "desktop:settings:restart-for-database-import";

export const SETTINGS_DATABASE_IMPORT_PROGRESS_CHANNEL =
  "desktop:settings:database-import-progress";

export const SETTINGS_DROP_DATABASE_IMPORT_FILE_CHANNEL =
  "desktop:settings:drop-database-import-file";

export const SETTINGS_SELECT_DATABASE_IMPORT_FILE_CHANNEL =
  "desktop:settings:select-database-import-file";

export const SETTINGS_LIST_ACCOUNT_SETTINGS_CHANNEL =
  "desktop:settings:list-account-settings";

export const SETTINGS_UPDATE_ACCOUNT_SETTINGS_CHANNEL =
  "desktop:settings:update-account-settings";

export const UPDATES_CHECK_CHANNEL = "desktop:updates:check";
export const UPDATES_DOWNLOAD_CHANNEL = "desktop:updates:download";
export const UPDATES_GET_STATUS_CHANNEL = "desktop:updates:get-status";
export const UPDATES_INSTALL_CHANNEL = "desktop:updates:install";
export const UPDATES_STATUS_CHANNEL = "desktop:updates:status";
