import type { DatabaseConnection } from "@repo/database/client";

/** Seeds a Gmail account the way the Add account window stores one. */
export const insertGmailAccount = (
  connection: DatabaseConnection,
  email: string,
  options: { readonly credentials?: Buffer; readonly sortOrder?: number } = {}
): void => {
  connection
    .prepare(
      `INSERT INTO mail_accounts (
        account_id, created_at, credentials, dialect, email,
        imap_host, imap_port, imap_security, provider, smtp_host, smtp_port,
        smtp_security, sort_order, updated_at, username
      ) VALUES (?, 1, ?, 'gmail', ?, 'imap.gmail.com', 993,
        'tls', 'gmail', 'smtp.gmail.com', 465, 'tls', ?, 1, ?)`
    )
    .run(
      email.toLowerCase(),
      options.credentials ?? Buffer.from([1]),
      email,
      options.sortOrder ?? 1,
      email
    );
};
