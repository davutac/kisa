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

export const decryptStoredCredentials = async (credentials: Buffer) => {
  const { result } = await safeStorage.decryptStringAsync(credentials);
  return decodeStoredCredentials(JSON.parse(result));
};

export const isUserOwnedOAuthClient = async (
  credentials: Buffer
): Promise<boolean> => {
  try {
    const stored = await decryptStoredCredentials(credentials);
    return stored.oauthClient === "user-owned";
  } catch {
    return false;
  }
};
