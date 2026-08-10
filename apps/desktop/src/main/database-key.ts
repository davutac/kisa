import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const DATABASE_KEY_BYTES = 32;

export interface DatabaseKeyEncryptor {
  readonly encrypt: (plaintext: string) => Promise<Buffer>;
}

export interface DatabaseKeyProtector extends DatabaseKeyEncryptor {
  readonly decrypt: (encrypted: Buffer) => Promise<string>;
}

export const decodeDatabaseKey = (encoded: string): Buffer => {
  const key = Buffer.from(encoded, "base64");

  if (
    key.byteLength !== DATABASE_KEY_BYTES ||
    key.toString("base64") !== encoded
  ) {
    throw new Error("Database key is invalid");
  }

  return key;
};

export const encodeDatabaseKey = (key: Uint8Array): string => {
  if (key.byteLength !== DATABASE_KEY_BYTES) {
    throw new Error("Database key is invalid");
  }

  return Buffer.from(key).toString("base64");
};

const writeDatabaseKey = async (
  keyPath: string,
  encryptedKey: Buffer
): Promise<void> => {
  await mkdir(path.dirname(keyPath), { recursive: true });
  const temporaryPath = `${keyPath}.${randomUUID()}.tmp`;
  const temporaryFile = await open(temporaryPath, "wx", 0o600);

  try {
    try {
      await temporaryFile.writeFile(encryptedKey);
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }
    await rename(temporaryPath, keyPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

export const sealDatabaseKey = async (
  keyPath: string,
  key: Uint8Array,
  encryptor: DatabaseKeyEncryptor
): Promise<void> => {
  const encryptedKey = await encryptor.encrypt(encodeDatabaseKey(key));
  await writeDatabaseKey(keyPath, encryptedKey);
};

export const loadOrCreateDatabaseKey = async (
  keyPath: string,
  protector: DatabaseKeyProtector
): Promise<Buffer> => {
  let encryptedKey: Buffer;

  try {
    encryptedKey = await readFile(keyPath);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }

    const key = randomBytes(DATABASE_KEY_BYTES);
    try {
      await sealDatabaseKey(keyPath, key, protector);
      return key;
    } catch (sealError) {
      key.fill(0);
      throw sealError;
    }
  }

  return decodeDatabaseKey(await protector.decrypt(encryptedKey));
};
