# AI writing

Kisa exposes an AI writing capability for generating a reply from cached thread context and cleaning up the subject and body of a new email. The settings screen lets the user save a model for each provider, choose one active provider for generation, inspect provider availability, and customize separate reply and draft cleanup instructions in dialogs. Compose and thread writing controls are not implemented yet.

Settings changes save automatically. Codex starts with `gpt-5.6-luna`, Claude starts with `claude-sonnet-5`, and OpenCode has no preset model.

## Provider ownership

Kisa uses the user's existing command-line subscriptions and credentials. It does not collect provider API keys or copy provider credentials into Kisa:

- Codex runs through `codex exec`; authentication and model inventory come from `codex app-server`.
- Claude runs through `claude --print`; account state comes from a no-prompt Agent SDK initialization and the supported model catalog is versioned with Kisa.
- OpenCode runs a loopback-only `opencode serve` process for the request and talks to it with the OpenCode SDK. Model inventory comes from `opencode models --verbose`.

The process environment includes the interactive login shell's `PATH` so a packaged desktop app can locate user-installed CLIs. Provider stderr and raw failures never cross IPC. Generation has bounded output, startup, and request timeouts, and interruption terminates child processes.

This provider design is adapted from [T3 Code](https://github.com/pingdotgg/t3code), pinned during implementation at commit `97db94c9bf6fa5d83f94c8fff85566d7fc96276e`. See the root third-party notice for its license.

## IPC API

The typed `desktopBridge` exposes five methods:

- `listAiProviders()` reports installation, authentication state, and models for Codex, Claude, and OpenCode.
- `getAiSettings()` returns the reply and cleanup instructions, active provider, and saved model for each provider.
- `updateAiSettings(request)` persists both instruction templates, the active provider, and all provider model selections.
- `generateEmailReply(request)` generates a body from an account-scoped cached thread plus optional request-specific instructions.
- `cleanupEmailDraft(request)` rewrites a supplied subject/body pair plus optional request-specific instructions.

Every IPC input is decoded in main and every result is encoded before it is returned. A generation request may select a provider/model directly or use the saved model for the active provider. There is intentionally no arbitrary prompt, command, filesystem, or provider-configuration capability.

## Prompt and mail boundaries

The application-owned safety instructions are compiled into Kisa. The two operation-specific instruction templates have application defaults, are editable in settings, and are persisted independently. Dynamic thread and draft data never becomes part of the editable templates. Optional instructions supplied for a single generation request are separate and are not persisted.

Reply context is loaded only from Kisa's local cache using the composite account and Gmail thread identity. It is bounded to the latest 50 messages, 12,000 body characters per message, and 60,000 body characters overall. Sender-controlled headers and plain-text bodies are serialized inside an explicitly untrusted data section. Loading context never calls Gmail and never marks, drafts, sends, or otherwise mutates mail.

Generation necessarily transmits the supplied draft or bounded thread context to the provider selected by the user, under that provider's subscription and data terms. Kisa runs each provider from an empty temporary directory and deletes temporary output afterward. Claude tools are disabled, and OpenCode sessions deny every permission. Codex is restricted to a read-only sandbox in the empty directory; the Codex CLI does not currently offer Kisa a complete switch for removing every built-in read capability.

AI settings live in the encrypted application database. The safety instructions are not persisted, so application updates can improve the safety baseline without overwriting the user's reply or cleanup instructions.

## Lifecycle

Provider inventory is probed on demand rather than cached in renderer state. OpenCode's loopback server and session are scoped to one request. Codex and Claude use non-persistent/ephemeral invocations. Provider output is decoded against the exact reply or cleaned-draft schema before it can cross IPC.
