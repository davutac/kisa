import * as Schema from "effect/Schema";

import {
  isMailAddress,
  isMailHost,
  isMailPort,
  MAX_PASSWORD_LENGTH,
} from "../mail-account-presets";
import { IpcReply } from "./reply";

const MailAddress = Schema.String.check(
  Schema.makeFilter<string>(isMailAddress, { expected: "an email address" })
);

/**
 * The password stays a plain string only until main decodes it: decoding
 * wraps it in `Redacted`, and it can never be encoded back.
 */
const AppPassword = Schema.RedactedFromValue(
  Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(MAX_PASSWORD_LENGTH),
    // Line breaks and NUL would end an IMAP or SMTP command early.
    Schema.isPattern(/^[^\0\r\n]+$/u)
  ),
  { disallowEncode: true, label: "app password" }
);

const MailServer = Schema.Struct({
  host: Schema.String.check(
    Schema.makeFilter<string>(isMailHost, { expected: "a host name" })
  ),
  port: Schema.Finite.check(
    Schema.makeFilter<number>(isMailPort, { expected: "a port number" })
  ),
  security: Schema.Literals(["starttls", "tls"]),
});

/**
 * What the Add account window sends, once, when the user signs in. Servers
 * are required for an address without a preset and ignored for one with a
 * preset, whose settings main applies itself.
 */
export const PasswordAccountSetupRequest = Schema.Struct({
  email: MailAddress,
  password: AppPassword,
  servers: Schema.optional(
    Schema.Struct({ imap: MailServer, smtp: MailServer })
  ),
});
export type PasswordAccountSetupRequest =
  typeof PasswordAccountSetupRequest.Type;
/** The request as the setup window writes it, before main decodes it. */
export type PasswordAccountSetupInput =
  typeof PasswordAccountSetupRequest.Encoded;

export const PasswordAccountSetupReply = IpcReply(Schema.Void);
export type PasswordAccountSetupReply = typeof PasswordAccountSetupReply.Type;

export const AccountSetupOpenReply = IpcReply(Schema.Void);
export type AccountSetupOpenReply = typeof AccountSetupOpenReply.Type;

/** The only capabilities the Add account window's preload exposes. */
export interface AccountSetupBridge {
  close: () => Promise<void>;
  submit: (
    request: PasswordAccountSetupInput
  ) => Promise<PasswordAccountSetupReply>;
}
