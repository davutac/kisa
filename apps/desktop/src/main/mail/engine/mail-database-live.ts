import { MailStoreError } from "@repo/mail/errors";
import { Effect, Layer } from "effect";

import { withDatabaseClient } from "../../database";
import { MailDatabase } from "./mail-database";

export const MailDatabaseLive = Layer.succeed(
  MailDatabase,
  MailDatabase.of({
    use: (message, run) =>
      withDatabaseClient(run).pipe(
        Effect.mapError((cause) => new MailStoreError({ cause, message }))
      ),
  })
);
