import * as Schema from "effect/Schema";

import {
  isMailAddress,
  isMailHost,
  isMailPort,
  MAX_DISPLAY_NAME_LENGTH,
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

/** The sender name outgoing mail carries; control characters would break the header. */
const DisplayName = Schema.String.check(
  Schema.isMaxLength(MAX_DISPLAY_NAME_LENGTH),
  // oxlint-disable-next-line no-control-regex -- Control characters are what this rejects.
  Schema.isPattern(/^[^\p{Cc}]*$/u)
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
  /** Optional; blank means mail goes out with the bare address. */
  name: Schema.optional(DisplayName),
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

/**
 * What the Add account window sends to start Microsoft sign-in. It carries
 * no credential: the sign-in happens in the system browser, and the tokens
 * it yields never leave main.
 */
export const MicrosoftAccountSetupRequest = Schema.Struct({
  email: MailAddress,
  /** Optional; blank means mail goes out with the bare address. */
  name: Schema.optional(DisplayName),
});
export type MicrosoftAccountSetupRequest =
  typeof MicrosoftAccountSetupRequest.Type;

export const MicrosoftAccountSetupReply = IpcReply(Schema.Void);
export type MicrosoftAccountSetupReply = typeof MicrosoftAccountSetupReply.Type;

export const AccountSetupOpenReply = IpcReply(Schema.Void);
export type AccountSetupOpenReply = typeof AccountSetupOpenReply.Type;

/** The only capabilities the Add account window's preload exposes. */
export interface AccountSetupBridge {
  /** Stops a Microsoft sign-in that is waiting for the browser. */
  cancelMicrosoftSignIn: () => Promise<void>;
  close: () => Promise<void>;
  /**
   * Opens Microsoft's sign-in page in the system browser and settles once the
   * account is added, the sign-in fails, or it is cancelled.
   */
  signInWithMicrosoft: (
    request: MicrosoftAccountSetupRequest
  ) => Promise<MicrosoftAccountSetupReply>;
  submit: (
    request: PasswordAccountSetupInput
  ) => Promise<PasswordAccountSetupReply>;
}
