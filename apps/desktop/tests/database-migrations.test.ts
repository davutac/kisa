import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "../../../packages/database/src/client";

const migrationsFolder = fileURLToPath(
  new URL("../../../packages/database/drizzle", import.meta.url)
);
const temporaryDirectories: string[] = [];

const createLegacySenderBrandDatabase = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "kisa-migration-"));
  const connection = openDatabaseConnection(path.join(directory, "app.sqlite"));

  temporaryDirectories.push(directory);
  connection.exec(`
    CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
    INSERT INTO "__drizzle_migrations" (hash, created_at)
    VALUES (
      '5c8cd5c74db86c458eca444811b90c2c38e551b9727a9586e20709982ccc4860',
      1786053026919
    );
    CREATE TABLE google_accounts (
      avatar_url text,
      created_at integer NOT NULL,
      credentials blob NOT NULL,
      display_name text,
      email text PRIMARY KEY NOT NULL,
      scopes text NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE TABLE gmail_sender_brands (
      authority_url text,
      domain text PRIMARY KEY NOT NULL,
      expires_at integer NOT NULL,
      logo_data blob,
      logo_url text,
      status text NOT NULL,
      updated_at integer NOT NULL
    );
    INSERT INTO gmail_sender_brands (
      authority_url,
      domain,
      expires_at,
      logo_data,
      logo_url,
      status,
      updated_at
    ) VALUES (
      NULL,
      'example.com',
      1,
      NULL,
      'https://example.com/logo.svg',
      'available',
      1
    );
  `);

  return connection;
};

describe("database migrations", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("upgrades the original sender-brand table without losing cached brands", () => {
    const connection = createLegacySenderBrandDatabase();

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );

      expect(
        connection
          .prepare("SELECT domain, selector, status FROM gmail_sender_brands")
          .all()
      ).toStrictEqual([
        {
          domain: "example.com",
          selector: "default",
          status: "available",
        },
      ]);
    } finally {
      connection.close();
    }
  });
});
