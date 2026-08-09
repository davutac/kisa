import { accountSettings } from "@repo/database/schemas";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { SETTINGS_ACCOUNT_SETTINGS_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import type {
  AccountSettings,
  AccountSettingsReply,
  AccountSettingsUpdateRequest,
} from "../../shared/ipc/settings";
import {
  AccountSettingsReply as AccountSettingsReplySchema,
  DEFAULT_ACCOUNT_SETTINGS,
} from "../../shared/ipc/settings";
import { withDatabaseClient } from "../database";
import { sendRendererEvent } from "../electron/renderer-events";

// oxlint-disable-next-line unicorn/throw-new-error
class AccountSettingsError extends Schema.TaggedErrorClass<AccountSettingsError>()(
  "AccountSettingsError",
  { message: Schema.String }
) {}

export const notifyAccountSettingsChanged = (
  reply: AccountSettingsReply
): void => {
  sendRendererEvent(
    SETTINGS_ACCOUNT_SETTINGS_CHANGED_CHANNEL,
    AccountSettingsReplySchema,
    reply
  );
};

// Only accounts that changed a default have a row, so the renderer fills in the
// defaults for everything this list leaves out.
export const listAccountSettings = Effect.fn("listAccountSettings")(
  function* listAccountSettings() {
    const rows = yield* withDatabaseClient((database) =>
      database.query.accountSettings.findMany()
    ).pipe(
      Effect.mapError(
        () =>
          new AccountSettingsError({
            message: "Could not load account settings",
          })
      )
    );

    return rows.map(
      (row) =>
        ({
          accountId: row.accountEmail,
          notificationsEnabled: row.notificationsEnabled,
          showSystemLabels: row.showSystemLabels,
        }) satisfies AccountSettings
    );
  }
);

export const updateAccountSettings = Effect.fn("updateAccountSettings")(
  function* updateAccountSettings(request: AccountSettingsUpdateRequest) {
    const now = Date.now();
    const setting =
      "notificationsEnabled" in request
        ? { notificationsEnabled: request.notificationsEnabled }
        : { showSystemLabels: request.showSystemLabels };

    yield* withDatabaseClient((database) =>
      database
        .insert(accountSettings)
        .values({
          accountEmail: request.accountId,
          ...DEFAULT_ACCOUNT_SETTINGS,
          ...setting,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: {
            ...setting,
            updatedAt: now,
          },
          target: accountSettings.accountEmail,
        })
        .run()
    ).pipe(
      Effect.mapError(
        () =>
          new AccountSettingsError({
            message: "Could not save account settings",
          })
      )
    );

    const settings = yield* listAccountSettings();

    notifyAccountSettingsChanged({ data: settings, ok: true });

    return settings;
  }
);

export const forgetAccountSettings = Effect.fn("forgetAccountSettings")(
  function* forgetAccountSettings(accountId: string) {
    yield* withDatabaseClient((database) =>
      database
        .delete(accountSettings)
        .where(eq(accountSettings.accountEmail, accountId))
        .run()
    ).pipe(
      Effect.mapError(
        () =>
          new AccountSettingsError({
            message: "Could not delete account settings",
          })
      )
    );
  }
);
