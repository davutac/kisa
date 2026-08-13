# t3code Codex integration comparison

Date: 2026-08-13  
Upstream reviewed: [`pingdotgg/t3code` at `fd51561b4e2de1893cb7eb4069937256d702572c`](https://github.com/pingdotgg/t3code/tree/fd51561b4e2de1893cb7eb4069937256d702572c)

## Conclusion

t3code does not use a fundamentally different Codex mechanism for small structured writing tasks. Like Kisa, it launches one ephemeral `codex exec`, passes a prompt on stdin, supplies a JSON schema and output-file path, and waits for the process to exit. Its flags and 180-second deadline are almost identical to Kisa's. The most relevant upstream practices are plain-string provider schemas followed by application-side sanitization, concurrent draining of both process streams, scoped process cleanup, preserving CLI stderr in typed failures, and making UI progress reach an explicit success/failure state.

The observed endless Kisa spinner had a more direct local explanation than the Codex invocation: [`use-new-message-workspace.ts`](../../apps/desktop/src/renderer/src/components/mail/new-message/use-new-message-workspace.ts) initialized `isMountedRef` to `true`, but its effect cleanup only set the ref to `false`. React Strict Mode's development setup/cleanup/setup probe therefore left it false. After the provider settled, cleanup returned before applying the reply, and `finally` also skipped `setIsCleaning(false)`. The implementation now tracks whether the compose surface is open through a complete effect setup/cleanup lifecycle and releases the busy state unconditionally when the request settles.

## Comparison

### Process launch and environment

- t3code's desktop startup captures a broader login-shell environment, including `PATH`, SSH, Homebrew, display, and XDG variables, and installs it into `process.env`; the local backend then inherits that environment. The probes are bounded and process termination has a force-kill grace period. ([desktop shell environment, lines 70-90 and 277-337](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/desktop/src/shell/DesktopShellEnvironment.ts#L70-L90), [lines 413-500](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/desktop/src/shell/DesktopShellEnvironment.ts#L413-L500))
- Each Codex provider instance can override the binary, environment, and `CODEX_HOME`; configured `~` home paths are expanded because direct process spawning does not perform shell expansion. ([provider environment merge](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/provider/ProviderInstanceEnvironment.ts#L1-L16), [Codex session spawn, lines 862-895](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L862-L895))
- Kisa similarly repairs `PATH` from a login shell and spawns directly. t3code's extra configurability is useful for multiple accounts and unusual installations, but there is no evidence here that it explains a request that already starts and exits.

### Codex strategy

- For one-shot structured text generation, t3code uses `codex exec --ephemeral --skip-git-repo-check -s read-only --model ... --output-schema ... --output-last-message ... -`. The prompt is streamed to stdin and stdout, stderr, and exit code are consumed concurrently. ([Codex text generation, lines 180-253](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/textGeneration/CodexTextGeneration.ts#L180-L253))
- t3code reserves the persistent `codex app-server` protocol for interactive agent sessions. It initializes the client, opens or resumes a thread, sends `turn/start`, and tracks app-server notifications. ([session startup, lines 1684-1713](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1684-L1713), [turn start, lines 1750-1801](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1750-L1801))
- Therefore Kisa's choice of `codex exec` for draft cleanup is aligned with upstream. Moving cleanup to app-server would add lifecycle complexity without directly fixing this spinner.

### Structured output and schema handling

- t3code materializes the Effect schema as JSON, writes it to a temporary schema file, asks Codex to write the last message to a temporary output file, and decodes that output back through the same Effect schema. Temporary files are cleaned in `ensuring`. ([schema/output lifecycle, lines 152-178 and 256-301](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/textGeneration/CodexTextGeneration.ts#L152-L178), [lines 256-301](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/textGeneration/CodexTextGeneration.ts#L256-L301))
- Its provider-facing schemas deliberately use flat `Schema.String` fields; length, newline, and fallback rules are enforced after decoding. ([commit schema, lines 34-78](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/textGeneration/TextGenerationPrompts.ts#L34-L78), [sanitizers, lines 22-63](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/textGeneration/TextGenerationUtils.ts#L22-L63))
- This directly supports Kisa's recent split between a permissive provider-generation schema and the constrained IPC schema. The earlier `allOf` rejection was real, but it is independent from the renderer remaining busy after main reports completion or failure.

### Timeouts and cancellation

- t3code and Kisa both use a 180-second one-shot Codex deadline. t3code wraps the spawned child in an Effect scope, applies `timeoutOption`, turns expiry into a typed error, and ensures temporary-file cleanup. ([deadline and cleanup, lines 40-41 and 256-301](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/textGeneration/CodexTextGeneration.ts#L40-L41))
- Interactive t3code sessions additionally expose `turn/interrupt`, interrupt live child turns with bounded per-child and aggregate deadlines, interrupt the parent turn, and close their owning runtime scope. ([interrupt and bounds, lines 1802-1834](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1802-L1834), [close, lines 1725-1744](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1725-L1744))
- Neither upstream one-shot text generation nor current Kisa cleanup offers a user-visible cancel action. Adding cancellation would improve the three-minute worst case, but it is not required to clear a spinner after a request has already settled.

### Failures and diagnostics

- On nonzero exit, t3code chooses trimmed stderr first, then stdout, and carries that detail in a typed `TextGenerationError`; it has a regression test that asserts the CLI diagnostic survives. ([nonzero-exit handling, lines 229-253](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/textGeneration/CodexTextGeneration.ts#L229-L253), [test, lines 644-672](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/textGeneration/CodexTextGeneration.test.ts#L644-L672))
- Kisa currently reduces a nonzero exit to a generic provider message. Privacy-safe classification is appropriate, but keeping a redacted reason code (schema rejection, authentication, unknown model, transport, timeout) would make the next failure diagnosable without logging the email or raw provider output.

### Progress, events, and renderer completion

- The one-shot generator itself is not streamed to the UI, but its enclosing Git workflow emits correlated `action_started`, `phase_started`, `action_finished`, and `action_failed` events. The schema requires an action ID, and the server guarantees a failure event on the error path. ([progress event contract](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/packages/contracts/src/git.ts#L396-L452), [server terminal events, lines 2291-2317](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/git/GitManager.ts#L2291-L2317))
- The renderer correlates events by `actionId`, updates elapsed progress, awaits a result, clears its active progress reference, and replaces the loading toast with failure or success. ([renderer progress lifecycle, lines 1306-1419](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/web/src/components/GitActionsControl.tsx#L1306-L1419))
- Interactive Codex uses provider notifications as authoritative terminal state: `turn/started` sets `running`, while `turn/completed` clears the active turn and sets `ready` or `error`; process exit also clears the active turn. ([turn state, lines 1386-1417](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1386-L1417), [process exit, lines 1657-1682](https://github.com/pingdotgg/t3code/blob/fd51561b4e2de1893cb7eb4069937256d702572c/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1657-L1682))
- Kisa's single request/reply IPC is sufficient for cleanup, but completion must be unconditional for the active request. A robust local model is: assign a request ID, set busy before invoke, and clear that same request's busy state in `finally` regardless of whether the compose surface is still eligible to receive content. Mount/open checks should guard applying output and toasts, not the release of operation state.

## Kisa outcomes

1. Compose-surface availability is set during every effect setup and cleared during cleanup, so React Strict Mode replay cannot leave it stale.
2. `isCleaning` is released whenever the request settles; mount, open, and draft identity checks only guard applying generated content and showing feedback.
3. Provider-facing cleanup output uses plain strings, while subject normalization remains at Kisa's boundary.
4. Privacy-safe provider failure classification and user-visible cancellation remain possible follow-ups; neither requires moving one-shot cleanup to app-server.
