# T3 Code provider-state lifecycle

Date: 2026-08-14  
Upstream reviewed: [`pingdotgg/t3code` at `184d8ef33b8f42869fb84f66a33984185b81dc47`](https://github.com/pingdotgg/t3code/tree/184d8ef33b8f42869fb84f66a33984185b81dc47)

## Conclusion

T3 Code does not make Settings or a composer own provider state. Provider availability, authentication, and model inventory are process-scoped server snapshots that are included in connection bootstrap, retained in shared client state, refreshed in the background, and consumed by every route. Settings only edits configuration and exposes a manual refresh control.

Kisa currently does the opposite: each Settings or composer hook starts with no selection and performs its own provider probe. Opening a new-message composer remounts the keyed dialog, discarding even a completed hidden-dialog load and starting the probe again. Reply composers first mount only after the reply action begins. That component-scoped ownership explains the delay before Clean or Create reply becomes available.

The smallest appropriate Kisa change is one authenticated-app-lifetime AI state owner that loads settings and provider inventory once, exposes a shared selection, and lets Settings explicitly refresh the same state. Persisting a last-known provider snapshot and revalidating it in the background is the follow-up that removes the remaining first-launch gap.

## T3 Code lifecycle

### 1. Provider status belongs to the server runtime

The provider registry is installed in the server's runtime dependency graph rather than constructed by a UI request. Each configured provider instance owns a managed snapshot with an in-memory `Ref` and change `PubSub`. It creates a cheap initial snapshot, starts the real provider check in a background fiber, reacts to provider-setting changes, and periodically refreshes without blocking layer construction. ([server runtime layer](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/server.ts#L363-L397), [managed snapshot creation and refresh](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/provider/makeManagedServerProvider.ts#L48-L148), [startup and periodic refresh](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/provider/makeManagedServerProvider.ts#L150-L228))

The registry aggregates all instance snapshots into one materialized provider list. It subscribes to each provider's changes before reading the current snapshot, avoiding a race in which a fast initial probe could finish between snapshot read and subscription. The aggregated list is readable synchronously from the runtime state and emits complete-list changes. ([registry subscription and initial synchronization](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/provider/Layers/ProviderRegistry.ts#L530-L593), [registry boot completion and public surface](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/provider/Layers/ProviderRegistry.ts#L646-L718))

This long-lived status lifecycle is separate from an interactive provider session or one-shot generation. Provider status can therefore be ready without keeping Codex, Claude, or OpenCode request processes alive.

### 2. Last-known snapshots bridge cold startup

At server boot, the registry hydrates a per-provider-instance disk cache into its in-memory provider list. Identity is checked before cached data is accepted. Live provider changes update the in-memory list and persist the refreshed snapshot. This lets the UI receive last-known installation, authentication, and model information while the new probe is still running. ([boot cache hydration](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/provider/Layers/ProviderRegistry.ts#L224-L330), [cache correlation and hydration](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/provider/providerStatusCache.ts#L37-L75))

### 3. Provider state is connection bootstrap data

Every client WebSocket session memoizes `serverGetConfig` and does not become ready until that initial config resolves. The server config contains the current provider list from the registry. ([client connection bootstrap](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/packages/client-runtime/src/rpc/session.ts#L113-L144), [server config assembly](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/ws.ts#L993-L1024))

The client then keeps a server-config subscription. On subscription, the server forks a non-blocking provider refresh, immediately emits the current full config, and streams debounced provider-list changes afterward. A Settings refresh calls the same registry explicitly; it does not initialize the lifecycle. ([config snapshot and live provider events](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/ws.ts#L2164-L2213), [manual provider refresh RPC](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/ws.ts#L1437-L1448))

### 4. The renderer retains one shared projection

An authenticated root-level `EventRouter` reads the primary server-config atom across all routes. Provider state is projected from that shared config, not loaded by Settings or the chat composer. ([authenticated root lifetime](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/web/src/routes/__root.tsx#L121-L144), [root config subscription](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/web/src/routes/__root.tsx#L319-L329), [shared provider atom](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/web/src/state/server.ts#L43-L81))

The environment config store restores a persisted config, applies provider events to `config.providers`, persists updates after a short debounce, and gives the subscription projection a five-minute idle lifetime. Thus reconnects and transient consumer unmounts do not force the UI back to an empty provider state. ([config projection](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/packages/client-runtime/src/state/server.ts#L251-L317), [restore, subscribe, and persist](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/packages/client-runtime/src/state/server.ts#L318-L405), [projection lifetime](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/packages/client-runtime/src/state/server.ts#L474-L501))

### 5. Refresh is bounded by foreground demand

Provider health refresh defaults to five minutes. The web client always reports `provider-status` as a baseline activity scope, including whether the app is visible, focused, or recently used. The server refresh loop probes only when foreground policy permits it, so status stays warm without tying probes to a particular screen. ([default interval](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/packages/contracts/src/settings.ts#L499-L500), [baseline provider-status scope](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/web/src/lib/backgroundActivityReporter.ts#L24-L29), [activity report](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/web/src/lib/backgroundActivityReporter.ts#L87-L109), [demand-gated refresh](https://github.com/pingdotgg/t3code/blob/184d8ef33b8f42869fb84f66a33984185b81dc47/apps/server/src/provider/makeManagedServerProvider.ts#L150-L219))

## Kisa's current lifecycle

Kisa's architecture document explicitly says provider inventory is probed on demand and is not cached in renderer state. ([AI writing lifecycle](../architecture/ai-writing.md#lifecycle))

The concrete paths are:

1. `useAiModelSelection` starts with `selection = null`. On every mount it first awaits `getSettings()`, then awaits `listProviders()`, and only then exposes a usable selection. It has no shared cache or subscription. ([selection hook](../../apps/desktop/src/renderer/src/hooks/use-ai-model-selection.ts))
2. `listProviders()` runs the Codex, Claude, and OpenCode probes concurrently every time it is called. ([provider catalog](../../apps/desktop/src/main/ai/provider-catalog.ts))
3. The new-message workspace owns its own `useAiModelSelection` call. Although the dialog exists while closed, opening it increments `composerKey`, remounting the whole dialog and throwing away the old component-local selection. The replacement hook repeats settings loading and the provider probe. ([new-message key lifecycle](../../apps/desktop/src/renderer/src/components/shell/new-message.tsx), [workspace selection](../../apps/desktop/src/renderer/src/components/mail/new-message/use-new-message-workspace.ts))
4. A reply workspace is rendered only while its reply composer is open, so its provider load begins at the moment the user starts replying. `canClean` and `canCreateReply` remain false until that load completes. ([reply mount](../../apps/desktop/src/renderer/src/components/mail/thread-conversation.tsx), [reply action gating](../../apps/desktop/src/renderer/src/components/mail/reply-area/use-reply-workspace.ts))
5. Settings owns a second, unrelated provider inventory and settings workflow. It loads settings and providers in parallel and offers refresh, but none of that state is shared with composers. ([Settings AI workflow](../../apps/desktop/src/renderer/src/routes/settings/-components/use-ai-settings.ts))

The hidden new-message dialog therefore does not provide effective preloading: its state is component-local and the key change deliberately destroys it on open. Multiple consumers can also run duplicate CLI probes at the same time.

## Recommended Kisa shape

### First step: app-lifetime shared state

Add one renderer-wide AI state owner for the authenticated app lifetime, alongside the existing account/settings state providers. It should own:

- the saved `AiSettings`;
- the current `AiProviderStatus[]`;
- initial-loading and background-refresh state separately;
- the last successful refresh time and a non-destructive refresh error;
- single-flight `refreshProviders()` and authoritative settings-update operations.

Load settings and provider inventory concurrently once when that owner mounts. Make `useAiModelSelection` a pure selector over the shared snapshot. Settings, new-message cleanup, reply creation, and reply cleanup then consume the same selection, so mounting or remounting a composer performs no IPC and no CLI probe.

Preserve the last successful provider list while a refresh is running or fails. Temporarily replacing it with an empty list would recreate the action flicker this change is intended to remove.

This is enough to remove the normal first-use delay because provider discovery runs while the authenticated mailbox shell is becoming usable. Kisa does not need T3 Code's multi-environment registry, worker graph, or five-minute client leases to get that benefit.

### Follow-up: eliminate the true cold-start gap

If Clean and Create reply must be available immediately even when the user opens a composer before the first live probe finishes, retain a last-known operational snapshot and revalidate it in the background. The cached shape needs a `checkedAt` value and only the fields required for selection and Settings presentation.

Provider status includes an authentication email, so any persisted snapshot must use Kisa's encrypted storage or omit that field. A stale cached selection can optimistically enable an action; the generation boundary must still return a typed provider/auth/model error if the CLI changed since the snapshot, then trigger a refresh.

A practical refresh policy for Kisa is startup plus manual Settings refresh, with an optional stale-on-focus refresh. Periodic probes should be added only if measured provider drift justifies them; OpenCode model inventory and authentication checks are external work.

### Verification targets

- Authenticated-shell mount performs one initial settings load and one provider inventory load.
- Opening, closing, and re-keying the new-message composer performs no additional provider probe.
- Opening reply, reply-all, and forward composers performs no additional provider probe.
- A Settings model/provider change updates already mounted consumers without navigation.
- Manual refresh is single-flight and keeps the prior usable selection visible while pending.
- Refresh failure reports stale/error state without disabling a previously usable selection.
- Cached startup state is available before background revalidation completes, if persistence is added.
- The global AI state remains intentionally independent of Gmail account identity while mail-generation requests remain account-scoped.
