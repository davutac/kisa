# Attachment handling

Kisa treats attachment bytes as hostile, on-demand content. Metadata belongs to the account-scoped mail cache; bytes are not indexed or persisted as part of the mailbox cache.

## User interaction

- Image and PDF attachments always open a new Kisa preview window.
- Every other attachment opens the operating system's Save As dialog.
- Attachment pills keep an explicit file-type label visible when their filename truncates.
- Cancelling Save As performs no Gmail attachment request and writes nothing.
- The Download button in a preview opens Save As and writes the bytes already held by that preview session.

Mailbox and message metadata may be available offline, but attachment bytes are not. Opening a preview therefore requires Gmail access unless its preview window has already loaded the bytes.

## Runtime ownership

The normal renderer sends only `accountId`, `messageId`, and `attachmentId`. Main resolves the authoritative filename, media type, and declared size from the cached message using the composite account/message key. Renderer-supplied paths, filenames, media types, or bytes are never accepted.

Main owns four narrow capabilities:

1. Open an image/PDF preview session.
2. Save a non-preview attachment after a destination is selected.
3. Load the attachment associated with the calling preview window.
4. Save the attachment associated with the calling preview window.

Each preview uses a dedicated sandboxed `BrowserWindow`, HTML entry, and preload. Its preload exposes only load and save. It does not expose `DesktopBridge`, local paths, account management, mail mutations, or navigation. Preview sessions are keyed by `webContents.id`; closing the window discards and overwrites the main-process byte buffer.

Images are displayed through an in-memory Blob URL. PDFs are parsed by the locally bundled PDF.js worker and rendered to canvases. Only nearby PDF pages are rendered, and both image and PDF previews track the window width without adding document padding. The preview document blocks external network access and denies navigation and new windows.

## Disk and failure behavior

Previewing never creates a temporary file. Download-only attachments are not requested from Gmail until Save As returns a destination. Attachment writes use the sanitized cached filename as the dialog default, enforce a bounded in-memory size, and never return the destination path to a renderer.

Account disconnect and application restart require no attachment-cache cleanup because preview bytes exist only in live window sessions. Closing a preview or quitting Electron destroys those sessions.
