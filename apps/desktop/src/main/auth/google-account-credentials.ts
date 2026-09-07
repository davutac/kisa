import { Schema } from "effect";
import { safeStorage } from "electron";

export const StoredCredentials = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  clientId: Schema.optional(Schema.NonEmptyString),
  clientSecret: Schema.optional(Schema.NonEmptyString),
  expiresAt: Schema.optional(Schema.Finite),
  oauthClient: Schema.optional(Schema.Literal("user-owned")),
  refreshToken: Schema.optional(Schema.NonEmptyString),
});

const decodeStoredCredentials = Schema.decodeUnknownSync(StoredCredentials);

export const decryptStoredCredentials = (credentials: Buffer) =>
  decodeStoredCredentials(JSON.parse(safeStorage.decryptString(credentials)));

export const isUserOwnedOAuthClient = (credentials: Buffer): boolean => {
  try {
    return decryptStoredCredentials(credentials).oauthClient === "user-owned";
  } catch {
    return false;
  }
};
