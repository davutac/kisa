# AI writing and categorization

Kisa generates replies from cached thread context, cleans up draft text, and can categorize conversations manually or automatically with an account's existing Gmail labels. Settings store an active provider plus a model and one optional model-specific generation option for each provider. That option is a Codex or Claude reasoning effort, Claude Haiku's Thinking toggle, or an OpenCode Variant. AI action tooltips show the resolved provider, model, and option value. New-message, reply, and reply-all composers support cleanup; reply and reply-all also support reply generation.

Settings changes save automatically. Codex starts with `gpt-5.6-luna` at `low` reasoning, Claude starts with `claude-sonnet-5` and its provider-default reasoning, and OpenCode has no preset model or reasoning variant.

## Provider ownership

Kisa uses the user's existing command-line subscriptions and credentials. It does not collect provider API keys or copy provider credentials into Kisa:

- Codex runs through `codex exec`; authentication, model inventory, supported reasoning efforts, and each model's default effort come from `codex app-server`.
- Claude runs through `claude --print`; account state comes from a no-prompt Agent SDK initialization. Kisa keeps an explicit Claude model catalog because Claude Code's discovered list contains moving aliases. The catalog records each model's effort choices and default, filters newer models by the installed CLI version, and exposes Haiku 4.5's Thinking control.
- OpenCode runs a loopback-only `opencode serve` process and uses the OpenCode SDK. Model inventory and model variants come from `opencode models --verbose`. The settings control is labeled Variant and passes the selected opaque value through unchanged.

The OpenCode model picker groups models into submenus by their upstream provider while preserving the explicit `provider/model` value for selection and generation.

The process environment includes the interactive login shell's `PATH` so a packaged desktop app can locate user-installed CLIs. Provider stderr and raw failures never cross IPC. Generation has bounded output, startup, and request timeouts, and interruption terminates child processes.

This provider design is adapted from [T3 Code](https://github.com/pingdotgg/t3code), pinned during implementation at commit `97db94c9bf6fa5d83f94c8fff85566d7fc96276e`. The provider/model alignment was reviewed again against upstream commit `2daff8c25adf701fddd062ae93b94cc57d420ec2`; see [the dated comparison](../research/2026-08-30-t3code-provider-model-options-alignment.md). See the root third-party notice for its license.

## IPC API

The typed `desktopBridge` exposes six methods:

- `listAiProviders()` reports installation, authentication state, models, and model-specific generation choices for Codex, Claude, and OpenCode.
- `getAiSettings()` returns the reply and cleanup user instructions, active provider, and saved model and reasoning choice for each provider.
- `updateAiSettings(request)` persists both user-instruction fields, the active provider, and all provider model and reasoning selections.
- `generateEmailReply(request)` generates a body from an account-scoped cached thread plus optional request-specific instructions.
- `cleanupEmailDraft(request)` rewrites a supplied subject/body pair plus optional request-specific instructions.
- `categorizeThread(request)` selects and adds matching existing user labels to one account-scoped conversation.

The manual label-row action is available whenever the selected global model is usable and does not depend on the account's automatic-categorization setting. A per-account setting separately gates a main-process listener for brand-new conversations discovered by incremental Gmail history. Eligible conversations enter one non-persistent, globally serial queue. Each item is attempted at most once per process, with no result or retry state persisted when label refresh, model resolution, generation, or Gmail mutation fails. Initial sync, cursor recovery, historical indexing, and later messages on an existing conversation never enqueue categorization. Manual and automatic categorization generations share one global permit so provider generation remains serial.

Main decodes every IPC input and encodes every result. A generation request may supply a provider, model, and option value or use the saved active selection. Provider adapters translate that value to Codex's `model_reasoning_effort`, Claude's `--effort` or `alwaysThinkingEnabled` setting, or OpenCode's `variant`. The persisted and IPC field remains named `reasoning` for migration compatibility. IPC does not expose arbitrary prompts, commands, filesystem access, or provider configuration.

## Prompt and mail boundaries

Reply generation, draft cleanup, and categorization each receive a complete, independently hardcoded system prompt that cannot be changed in settings. These prompts own the safety boundary, operation contract, and required output format. The body contract requires HTML limited to the elements supported by the configured Tiptap composer; it excludes Markdown, headings, images, tables, inline styles, and unsupported elements. Claude receives the prompt through its `--system-prompt` option and OpenCode through the SDK system field. Codex CLI does not expose a separate system-prompt option on this generation path, so Kisa places the selected hardcoded system prompt and user prompt in explicit labeled sections of one prompt.

Categorization refreshes the eligible account's label catalog for every manual or automatic attempt and supplies only sorted user-label ids and names, current user-label membership, and the same bounded cached conversation context used for replies. Label names and mail are both untrusted data. The model is instructed to choose a label only when it is a clear, high-confidence fit for the conversation's primary purpose and to return none rather than make a weak match. The structured response may contain zero to three unique ids from that exact catalog. Empty, unknown, duplicate, or excess ids fail the attempt. Kisa only adds missing labels; it never creates labels or removes existing or system labels.

The editable reply and cleanup fields contain instructions about how the result should be written, including tone, style, perspective, preservation, concision, grammar, and formatting preferences within the fixed body contract. Each operation's default user instructions appear as textarea placeholder text rather than stored values; an empty field applies those defaults. The system prompts contain only provider identity, the operation, the instruction hierarchy, the untrusted-data boundary, and the required return shape and Tiptap-compatible HTML format. Kisa places effective standing instructions (saved preferences or the defaults) and optional request-specific instructions in separately marked sections before the explicitly untrusted mail-data section. Request-specific instructions take precedence over standing preferences when they conflict; neither can replace the hardcoded system task or output contract. Request-specific instructions are not persisted.

Create reply opens a focused steering popover before generation. The user can provide one-off instructions for that reply, or submit the textarea blank to generate from the cached conversation context and standing reply preferences. The Create reply hotkey opens the same popover as the mouse action.

Create reply remains available after generation so the user can steer another attempt. A successful generation replaces the current reply body; the selected model, forward restriction, and in-progress work still control action availability.

Each generation also receives a trusted runtime-context section containing the current date in the device's time zone and that IANA time-zone identifier. Kisa obtains the instant from Effect's clock, which keeps time deterministic under a test clock, and derives the calendar date through Effect's local-zone service. The context intentionally omits the wall-clock time and only helps interpret relative dates; it does not imply user availability or authorize commitments.

Reply context is loaded only from Kisa's local cache using the composite account and Gmail thread identity. It is bounded to the latest 50 messages, 12,000 body characters per message, and 60,000 body characters overall. Sender-controlled headers and plain-text bodies are serialized inside an explicitly untrusted data section. Loading context never calls Gmail and never marks, drafts, sends, or otherwise mutates mail.

Generation necessarily transmits the supplied draft or bounded thread context to the provider selected by the user, under that provider's subscription and data terms. Kisa runs each provider from an empty temporary directory and deletes temporary output afterward. Claude tools are disabled, and OpenCode sessions deny every permission. Codex is restricted to a read-only sandbox in the empty directory; the Codex CLI does not currently offer Kisa a complete switch for removing every built-in read capability. Provider-facing schemas use plain strings for compatibility with restricted structured-output schema subsets; Kisa applies stricter local validation before returning or applying a result and sanitizes and truncates cleaned subjects before IPC encoding.

Enabling automatic categorization also transmits bounded thread context and the account's user-label names without a separate action for each new conversation. The account switch is off by default and carries this disclosure inline. Queued work exists only in memory, is cleared on disconnect or quit, and is interrupted with the selected provider process. Removing an automatically applied label does not cause it to be re-added automatically; a later manual categorization remains an explicit user action.

AI settings live in the encrypted application database. System instructions are not persisted, so application updates can improve the safety and output-format contract without overwriting the user's reply or cleanup preferences.

## Lifecycle

The authenticated renderer mounts one `AiProviderStateProvider` for the application session. It loads settings and provider inventory concurrently and keeps the last successful inventory when refresh fails. Composer mounts do not probe providers. Settings changes update the shared state, and refresh runs one inventory request at a time.

Changing models keeps the current option value only when the new model supports it. Otherwise Settings selects the new model's reported default. The menu uses the model-owned label, such as Reasoning, Thinking, or Variant, and marks one concrete option as `Default`; it does not add a second default row. Models with no generation options have no option control.

Kisa intentionally does not copy every T3 Code coding-session trait. Claude Ultracode depends on multi-agent orchestration while Kisa disables tools, Ultrathink rewrites an interactive prompt, and OpenCode Agent selection is not meaningful for a permission-denied structured mail request. Codex service tiers, Claude Fast Mode, and additional context-window controls would need explicit cost, speed, and product copy before being exposed.

Provider inventory is not persisted across application restarts. OpenCode's loopback server and session remain scoped to one generation request, while Codex and Claude continue to use non-persistent/ephemeral invocations. Provider output is decoded against the exact reply or cleaned-draft schema before it can cross IPC.
