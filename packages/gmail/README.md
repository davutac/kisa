# @repo/gmail

Account-scoped Gmail business logic for the desktop main process. The package owns authorization handoff validation, granted capabilities, pagination, synchronization, credential refresh persistence, and orchestration. It does not depend on Electron or a particular database.

```ts
const program = Effect.gen(function* () {
  const gmail = yield* Gmail;

  const accounts = yield* gmail.listAccounts;
  const firstPage = yield* gmail.listThreads({
    accountId: accounts[0].id,
    labelIds: [LabelId.make("INBOX")],
    pageSize: 50,
  });

  if (firstPage.nextCursor !== undefined) {
    const nextPage = yield* gmail.listThreads({
      accountId: accounts[0].id,
      cursor: firstPage.nextCursor,
    });
  }
});
```

Each operation requires an `accountId`. A page cursor is opaque and contains the account and filters from the first request, so loading another page only requires the account and cursor.

Authentication callbacks are untrusted boundaries:

```ts
const account =
  yield *
  gmail.authorizeAccount({
    accessToken,
    expiresAt,
    refreshToken,
    scopes,
  });
```

`authorizeAccount` validates the payload, discovers the Google identity through `GmailGateway`, redacts credentials, derives capabilities from granted scopes, and persists the authorization through `GmailStore`. Reauthorization does not erase a stored refresh token when the new response omits one.

Mailbox mutations require full Gmail access and operate on complete conversations:

```ts
yield * gmail.markThreadRead({ accountId, threadId });
yield * gmail.markThreadUnread({ accountId, threadId });
yield * gmail.trashThread({ accountId, threadId });
yield * gmail.deleteThread({ accountId, threadId });
```

`trashThread` moves mail to Gmail Trash. `deleteThread` permanently deletes a conversation.

Provide these services to `Gmail.layerWithoutDependencies`:

- `GmailGateway`: Google API calls, token refresh, retry classification, and uncertain-send detection.
- `GmailMime`: inbound MIME parsing/sanitization and outbound MIME composition.
- `GmailStore`: accounts, credentials, labels, thread cache, summaries, and history cursors.
