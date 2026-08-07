import { accountSettings } from "@repo/database/schemas";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { SETTINGS_ACCOUNT_SETTINGS_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import type {
  AccountSettings,
  AccountSettingsReply,
  AccountSettingsUpdateRequest,
} from "../../shared/ipc/settings";
import { AccountSettingsReply as AccountSettingsReplySchema } from "../../shared/ipc/settings";
import { getDatabaseClient } from "../database";
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
    const database = yield* getDatabaseClient().pipe(
      Effect.mapError(
        (error) => new AccountSettingsError({ message: error.message })
      )
    );
    const rows = yield* Effect.try({
      catch: () =>
        new AccountSettingsError({
          message: "Could not load account settings",
        }),
      try: () => database.query.accountSettings.findMany().sync(),
    });

    return rows.map(
      (row) =>
        ({
          accountId: row.accountEmail,
          showSystemLabels: row.showSystemLabels,
        }) satisfies AccountSettings
    );
  }
);

export const updateAccountSettings = Effect.fn("updateAccountSettings")(
  function* updateAccountSettings(request: AccountSettingsUpdateRequest) {
    const database = yield* getDatabaseClient().pipe(
      Effect.mapError(
        (error) => new AccountSettingsError({ message: error.message })
      )
    );
    const now = Date.now();

    yield* Effect.try({
      catch: () =>
        new AccountSettingsError({
          message: "Could not save account settings",
        }),
      try: () =>
        database
          .insert(accountSettings)
          .values({
            accountEmail: request.accountId,
            showSystemLabels: request.showSystemLabels,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            set: {
              showSystemLabels: request.showSystemLabels,
              updatedAt: now,
            },
            target: accountSettings.accountEmail,
          })
          .run(),
    });

    const settings = yield* listAccountSettings();

    notifyAccountSettingsChanged({ data: settings, ok: true });

    return settings;
  }
);

export const forgetAccountSettings = Effect.fn("forgetAccountSettings")(
  function* forgetAccountSettings(accountId: string) {
    const database = yield* getDatabaseClient().pipe(
      Effect.mapError(
        (error) => new AccountSettingsError({ message: error.message })
      )
    );

    yield* Effect.try({
      catch: () =>
        new AccountSettingsError({
          message: "Could not delete account settings",
        }),
      try: () =>
        database
          .delete(accountSettings)
          .where(eq(accountSettings.accountEmail, accountId))
          .run(),
    });
  }
);
