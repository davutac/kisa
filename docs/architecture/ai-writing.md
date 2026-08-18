# AI writing

Kisa generates replies from cached thread context and cleans up draft text. Settings store an active provider plus a model and optional model-specific reasoning value for each provider. AI action tooltips show the resolved provider, model, and reasoning value. New-message, reply, and reply-all composers support cleanup; reply and reply-all also support reply generation.

Settings changes save automatically. Codex starts with `gpt-5.6-luna` at `low` reasoning, Claude starts with `claude-sonnet-5` and its provider-default reasoning, and OpenCode has no preset model or reasoning variant.

## Provider ownership

Kisa uses the user's existing command-line subscriptions and credentials. It does not collect provider API keys or copy provider credentials into Kisa:

- Codex runs through `codex exec`; authentication, model inventory, supported reasoning efforts, and each model's default effort come from `codex app-server`.
- Claude runs through `claude --print`; account state comes from a no-prompt Agent SDK initialization. Kisa keeps an explicit Claude model catalog because Claude Code's discovered list contains moving aliases. The catalog records each model's effort choices and default.
- OpenCode runs a loopback-only `opencode serve` process and uses the OpenCode SDK. Model inventory and model variants come from `opencode models --verbose`. The settings reasoning control passes the selected variant through unchanged.

The OpenCode model picker groups models into submenus by their upstream provider while preserving the explicit `provider/model` value for selection and generation.

The process environment includes the interactive login shell's `PATH` so a packaged desktop app can locate user-installed CLIs. Provider stderr and raw failures never cross IPC. Generation has bounded output, startup, and request timeouts, and interruption terminates child processes.

This provider design is adapted from [T3 Code](https://github.com/pingdotgg/t3code), pinned during implementation at commit `97db94c9bf6fa5d83f94c8fff85566d7fc96276e`. See the root third-party notice for its license.

## IPC API

The typed `desktopBridge` exposes five methods:

- `listAiProviders()` reports installation, authentication state, models, and model-specific reasoning choices for Codex, Claude, and OpenCode.
- `getAiSettings()` returns the reply and cleanup user instructions, active provider, and saved model and reasoning choice for each provider.
- `updateAiSettings(request)` persists both user-instruction fields, the active provider, and all provider model and reasoning selections.
- `generateEmailReply(request)` generates a body from an account-scoped cached thread plus optional request-specific instructions.
- `cleanupEmailDraft(request)` rewrites a supplied subject/body pair plus optional request-specific instructions.

Main decodes every IPC input and encodes every result. A generation request may supply a provider, model, and reasoning value or use the saved active selection. Provider adapters translate reasoning to Codex's `model_reasoning_effort`, Claude's `--effort`, or OpenCode's `variant`. IPC does not expose arbitrary prompts, commands, filesystem access, or provider configuration.

## Prompt and mail boundaries

Reply generation and draft cleanup each receive a complete, independently hardcoded system prompt that cannot be changed in settings. These prompts own the safety boundary, operation contract, and required output format. The body contract requires HTML limited to the elements supported by the configured Tiptap composer; it excludes Markdown, headings, images, tables, inline styles, and unsupported elements. Claude receives the prompt through its `--system-prompt` option and OpenCode through the SDK system field. Codex CLI does not expose a separate system-prompt option on this generation path, so Kisa places the selected hardcoded system prompt and user prompt in explicit labeled sections of one prompt.

The editable reply and cleanup fields contain instructions about how the result should be written, including tone, style, perspective, preservation, concision, grammar, and formatting preferences within the fixed body contract. Each operation's default user instructions appear as textarea placeholder text rather than stored values; an empty field applies those defaults. The system prompts contain only provider identity, the operation, the instruction hierarchy, the untrusted-data boundary, and the required return shape and Tiptap-compatible HTML format. Kisa places effective standing instructions (saved preferences or the defaults) and optional request-specific instructions in separately marked sections before the explicitly untrusted mail-data section. Request-specific instructions take precedence over standing preferences when they conflict; neither can replace the hardcoded system task or output contract. Request-specific instructions are not persisted.

Create reply opens a focused steering popover before generation. The user can provide one-off instructions for that reply, or submit the textarea blank to generate from the cached conversation context and standing reply preferences. The Create reply hotkey opens the same popover as the mouse action.

Each generation also receives a trusted runtime-context section containing the current date in the device's time zone and that IANA time-zone identifier. Kisa obtains the instant from Effect's clock, which keeps time deterministic under a test clock, and derives the calendar date through Effect's local-zone service. The context intentionally omits the wall-clock time and only helps interpret relative dates; it does not imply user availability or authorize commitments.

Reply context is loaded only from Kisa's local cache using the composite account and Gmail thread identity. It is bounded to the latest 50 messages, 12,000 body characters per message, and 60,000 body characters overall. Sender-controlled headers and plain-text bodies are serialized inside an explicitly untrusted data section. Loading context never calls Gmail and never marks, drafts, sends, or otherwise mutates mail.

Generation necessarily transmits the supplied draft or bounded thread context to the provider selected by the user, under that provider's subscription and data terms. Kisa runs each provider from an empty temporary directory and deletes temporary output afterward. Claude tools are disabled, and OpenCode sessions deny every permission. Codex is restricted to a read-only sandbox in the empty directory; the Codex CLI does not currently offer Kisa a complete switch for removing every built-in read capability. Provider-facing cleanup schemas use plain strings for compatibility with restricted structured-output schema subsets; Kisa sanitizes and truncates the subject before encoding the constrained IPC result.

AI settings live in the encrypted application database. System instructions are not persisted, so application updates can improve the safety and output-format contract without overwriting the user's reply or cleanup preferences.

## Lifecycle

The authenticated renderer mounts one `AiProviderStateProvider` for the application session. It loads settings and provider inventory concurrently and keeps the last successful inventory when refresh fails. Composer mounts do not probe providers. Settings changes update the shared state, and refresh runs one inventory request at a time.

Changing models keeps the current reasoning value only when the new model supports it. Otherwise Settings selects the new model's reported default. The menu marks that concrete option as `Default`; it does not add a second default row. Models with no reasoning options have no reasoning control.

Provider inventory is not persisted across application restarts. OpenCode's loopback server and session remain scoped to one generation request, while Codex and Claude continue to use non-persistent/ephemeral invocations. Provider output is decoded against the exact reply or cleaned-draft schema before it can cross IPC.
