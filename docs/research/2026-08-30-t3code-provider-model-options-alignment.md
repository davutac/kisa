# T3 Code provider and model-option alignment

Date: 2026-08-30  
Upstream reviewed: [`pingdotgg/t3code` at `2daff8c25adf701fddd062ae93b94cc57d420ec2`](https://github.com/pingdotgg/t3code/tree/2daff8c25adf701fddd062ae93b94cc57d420ec2)  
Kisa's documented implementation reference: [`97db94c9bf6fa5d83f94c8fff85566d7fc96276e`](https://github.com/pingdotgg/t3code/tree/97db94c9bf6fa5d83f94c8fff85566d7fc96276e)

## Conclusion

Kisa remains aligned with current T3 Code on the parts it already models:

- Codex models and per-model reasoning efforts come from the live Codex app-server catalog.
- Kisa's nine Claude model slugs, their ordinary `low` through `max` effort ladders, and their marked defaults match T3 Code's current catalog.
- OpenCode models use explicit `provider/model` slugs, live per-model variants, and the same inferred-default heuristic.
- A default is metadata on a real option, not a separate persisted `default` value.

The core upstream model slugs and ordinary Codex/Claude/OpenCode reasoning defaults have not changed since Kisa's pinned reference. At the start of this review, the meaningful mismatch was structural rather than a stale name: T3 Code consistently treats model traits as a list of typed, model-owned option descriptors, while Kisa can represent only one optional string called `reasoning`. That baseline could not express Claude Haiku's boolean **Thinking** control, Codex's service-tier option, or any model with two independent controls, and it labeled every OpenCode variant as reasoning.

The implementation accompanying this review closes the Kisa-relevant surface gaps without importing T3 Code's entire coding-agent option system: it adds version-gated Claude models, Haiku Thinking On/Off translated to `alwaysThinkingEnabled`, provider/model-specific option labels including OpenCode Variant, and Codex 0.150 account labels. Full multi-option parity remains intentionally open, including Codex service tiers and the newer OpenCode SDK catalog lifecycle.

The most relevant post-pin upstream change is OpenCode catalog robustness in [commit `cb49e5d7` / PR #8480](https://github.com/pingdotgg/t3code/pull/8480): T3 Code now loads the model catalog from a verified OpenCode server connection, keeps the last good catalog on discovery failure, and preserves an existing model plus its saved options when that model is temporarily missing. Kisa still parses `opencode models --verbose`; when a successful refresh omits the saved model, Kisa retains the stored id but its availability resolver returns no usable selection and disables generation.

Kisa does not need to add Cursor or Grok merely to claim alignment. They were already outside Kisa's documented three-provider scope at the pinned commit. If Kisa wants parity with T3 Code's full provider list, that is a separate product expansion: current T3 Code has five built-in drivers—Codex, Claude, Cursor, Grok, and OpenCode. ([provider architecture](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/docs/internals/providers.md#L5-L24))

## What changed after Kisa's pinned upstream commit

The changes relevant to provider discovery and model-option semantics are:

1. [PR #6092 / commit `39167eb1`](https://github.com/pingdotgg/t3code/pull/6092) added an explanation that Claude **Ultracode** means `xhigh` effort plus multi-agent orchestration. It did not change model availability or the ordinary effort defaults.
2. [PR #8227 / commit `badae6a5`](https://github.com/pingdotgg/t3code/pull/8227) moved current-versus-legacy classification out of hardcoded sets and into a remotely refreshable manifest. The current manifest calls Codex Luna, Terra, Sol, and the two Daybreak models current; for Claude it calls Fable 5, Opus 5, and Sonnet 5 current. Other catalog entries remain selectable as legacy. ([manifest](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/model-manifest.json), [manifest service](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/ModelManifest.ts#L1-L116))
3. [PR #8358 / commit `ead4ce52`](https://github.com/pingdotgg/t3code/pull/8358) made Grok reasoning model-specific and metadata-driven. This is relevant as confirmation of T3 Code's generic option direction, but it does not create a gap inside Kisa's existing provider set. ([Grok mapping](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/Layers/GrokProvider.ts#L52-L227))
4. [PR #8447 / commit `94401d01`](https://github.com/pingdotgg/t3code/pull/8447) accepted the additional account-plan literals emitted by Codex 0.150. This affects the authentication label only, not model or reasoning discovery.
5. [PR #8480 / commit `cb49e5d7`](https://github.com/pingdotgg/t3code/pull/8480) changed OpenCode discovery and lifecycle behavior: a minimum supported OpenCode version, authenticated server-health checks, SDK HTTP inventory, a shared short-lived local server, retained last-known catalogs on failure, and preservation of unavailable saved selections. The variant-default heuristic itself is unchanged. ([OpenCode user contract](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/docs/user/providers-opencode.md#L1-L53), [server/catalog design](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/docs/internals/providers.md#L42-L84))
6. [PR #8502 / commit `49f6241d`](https://github.com/pingdotgg/t3code/pull/8502) surfaced the model and effort used by Codex child agents. It does not change the parent model picker or one-shot text generation, so it has no direct Kisa email-writing implication.

No post-pin change altered T3 Code's Kisa-relevant defaults: general Codex prefers Sol then Terra, one-shot text generation remains Luna at `low`, Claude's general default remains Sonnet 5, Claude one-shot text generation remains Haiku 4.5, and OpenCode's fallback remains `openai/gpt-5`. ([current constants](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/packages/contracts/src/model.ts#L130-L166))

### Delta from the prior Kisa research snapshot

The earlier reasoning note reviewed T3 Code at [`bab4b6f02b8bdaf15fd32636a97f69ff657cec50`](https://github.com/pingdotgg/t3code/tree/bab4b6f02b8bdaf15fd32636a97f69ff657cec50) on 2026-08-16. From that commit to current main:

- The shared model-option contract has no semantic change.
- Codex's model-list mapping, reasoning-effort mapping, service-tier mapping, default model, and text-generation default are unchanged.
- Claude's model slugs, version gates, effort/default matrix, Thinking/Fast Mode/context descriptors, and dispatch normalization are unchanged. Only the human-readable Ultracode description changed.
- OpenCode's `provider/model` slugs, variant choices, variant-default heuristic, and build-first agent default are unchanged. The catalog transport and failure lifecycle changed materially in #8480.
- Grok is the only provider whose model-reasoning catalog semantics changed: #8358 added dynamic reasoning metadata. Grok is not a current Kisa provider.
- Current/legacy grouping changed independently of selectable model and reasoning catalogs through the Daybreak update and hosted manifest.

The prior Kisa research therefore remains correct about model/default semantics. This note adds the operational OpenCode change and makes explicit the Kisa gaps that were already present at `bab4b6f`: Claude CLI version gating, Haiku's boolean Thinking option, and T3 Code's multi-option descriptor model.

## Current upstream option model

T3 Code does not have a universal reasoning enum. A model advertises zero or more descriptors:

- `select`: opaque string choices with labels, descriptions, a current value, and `isDefault` metadata on a real choice;
- `boolean`: a model-specific on/off value;
- persisted selections: ordered `{ id, value }` pairs where `value` is a string or boolean.

That contract lets a model expose several independent controls without teaching the shared settings and picker code what they mean. Unknown provider-owned string ids remain valid. ([descriptor and selection contracts](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/packages/contracts/src/model.ts#L7-L128))

Missing or invalid saved choices resolve to the descriptor's concrete current/default choice. The resolved real values are materialized before dispatch; `default` is never a provider option value. Prompt-injected choices are resolved separately rather than sent as ordinary provider flags. ([resolution and materialization](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/packages/shared/src/model.ts#L80-L213))

The web UI iterates descriptors, renders their provider-supplied labels, marks a concrete choice with a `Default` badge, and renders boolean descriptors as On/Off. It retains labels such as `Reasoning effort`, `Effort`, and `Variant` instead of flattening them all to Reasoning. ([traits picker](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/web/src/components/chat/TraitsPicker.tsx#L37-L73), [select and boolean rendering](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/web/src/components/chat/TraitsPicker.tsx#L379-L468))

## Provider-by-provider comparison

### Codex

Current T3 Code pages through Codex app-server `model/list`. Each live model supplies its own `supportedReasoningEfforts` and `defaultReasoningEffort`. Known labels include `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`; an unknown future id is preserved and displayed rather than rejected. The same model response can advertise `serviceTiers` or older `additionalSpeedTiers`, which T3 Code exposes as a second `serviceTier` descriptor with a real `default`/Standard choice. ([Codex mapping](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/Layers/CodexProvider.ts#L53-L180), [model paging and default-model preference](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/Layers/CodexProvider.ts#L183-L225))

For one-shot text generation, T3 Code sends the explicit model and reasoning effort, plus `service_tier` when selected. ([Codex text generation](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/textGeneration/CodexTextGeneration.ts#L180-L205))

Kisa's live model and reasoning discovery is aligned. Its boundary schema still ignores service-tier metadata, its settings cannot persist a second option, and generation never supplies `service_tier`. See [Kisa's Codex provider](../../apps/desktop/src/main/ai/providers/codex.ts) and [AI IPC contract](../../apps/desktop/src/shared/ipc/ai.ts).

[PR #8447 / commit `94401d01`](https://github.com/pingdotgg/t3code/pull/8447) also added Codex 0.150 account-plan literals: `self_serve_business_prolite`, `ent26`, `enterprise_cbp_automation`, `edu_plus`, and `edu_pro`. Kisa already decoded `planType` as an open string, so these values never broke provider probing or model inventory; the implementation in this review adds their specific Business, Enterprise, and Edu labels. This was account-label drift, not model/reasoning drift. ([current Codex plan mapping](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/Layers/CodexProvider.ts#L70-L108))

### Claude

T3 Code continues to own a static, version-gated Claude catalog; it does not obtain these model capabilities from the Claude initialization probe. The current matrix is:

| Model | Reasoning or thinking | Other model options |
| --- | --- | --- |
| Fable 5 | low, medium, **high**, xhigh, max, ultracode, ultrathink | context 200k / **1m** |
| Opus 5 | low, medium, **high**, xhigh, max, ultracode, ultrathink | Fast Mode; context 200k / **1m** |
| Opus 4.8 | low, medium, **high**, xhigh, max, ultracode, ultrathink | Fast Mode |
| Opus 4.7 | low, medium, high, **xhigh**, max, ultrathink | Fast Mode |
| Opus 4.6 | low, medium, **high**, max, ultrathink | Fast Mode; context 200k / **1m** |
| Opus 4.5 | low, medium, **high**, max | Fast Mode |
| Sonnet 5 | low, medium, **high**, xhigh, max, ultrathink | context **200k** / 1m |
| Sonnet 4.6 | low, medium, **high**, max, ultrathink | context **200k** / 1m |
| Haiku 4.5 | boolean Thinking | none |

Bold values are catalog defaults. Opus 5, Fable 5, Opus 4.8, and Opus 4.7 require minimum Claude Code versions before T3 Code includes them. ([catalog and version gates](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/Layers/ClaudeProvider.ts#L54-L381))

The special values are not ordinary API effort names. `ultrathink` is prompt-injected and omitted from `--effort`; `ultracode` becomes `xhigh` plus Claude's `ultracode` setting. Haiku Thinking becomes `alwaysThinkingEnabled`, and Fast Mode becomes `fastMode`. Compatibility normalization still maps `xhigh` to `max` on older models and Sonnet 4.6 `max` to `high`. ([Claude normalization](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/Layers/ClaudeProvider.ts#L384-L465), [one-shot CLI settings](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/textGeneration/ClaudeTextGeneration.ts#L129-L175))

Kisa has all nine slugs and matches every ordinary effort/default listed above. Before this review it always published the full catalog on older Claude Code versions and Haiku 4.5 had no control. The accompanying implementation applies T3 Code's four minimum-version gates and adds a Thinking On/Off option for Haiku, translated to Claude's boolean `alwaysThinkingEnabled` setting. Kisa continues to omit `ultracode`, `ultrathink`, Fast Mode, and context. See [Kisa's Claude provider](../../apps/desktop/src/main/ai/providers/claude.ts).

For Kisa's bounded email-writing requests, omitting context-window controls is harmless: its maximum supplied context is far below 200k. Omitting Ultracode is also appropriate unless Kisa deliberately enables multi-agent tools; its Claude invocation currently disables tools. Ultrathink is a prompt behavior, not a normal effort flag, and should not be copied into the hardcoded mail instruction hierarchy without a separate product decision. Thinking and ordinary effort are the options that directly match Kisa's current feature promise.

### OpenCode

T3 Code flattens models only from connected upstream providers and retains explicit `provider/model` slugs. It maps each model's native `variants` keys to a descriptor labeled `Variant`. Defaults are inferred as follows: the sole variant; `high` for Anthropic/Google; `medium`, otherwise `high`, for OpenAI/OpenCode; no invented default for other provider ids. It also exposes OpenCode's visible primary agents as a separate `Agent` descriptor. ([OpenCode capabilities and model flattening](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/Layers/OpenCodeProvider.ts#L142-L255))

Since #8480, the inventory is loaded from the verified server SDK using `client.provider.list()` (alongside `app.agents()` and `app.skills()`), not from the `opencode models --verbose` CLI output. ([SDK inventory call](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/provider/opencodeRuntime.ts#L836-L873))

One-shot generation forwards selected `agent` and `variant` unchanged. ([OpenCode text generation](https://github.com/pingdotgg/t3code/blob/2daff8c25adf701fddd062ae93b94cc57d420ec2/apps/server/src/textGeneration/OpenCodeTextGeneration.ts#L202-L257))

Kisa's model slugs, variant parsing, disabled-variant filtering, default heuristic, and dispatch are aligned. Before this review it presented every variant under a control labeled Reasoning; the accompanying implementation carries an optional model-specific label through IPC and renders OpenCode's control as Variant. The remaining gaps are:

- Kisa uses the CLI's verbose output rather than the current server SDK inventory path.
- Kisa has no minimum OpenCode version/health contract for catalog probing.
- A missing catalog model makes Kisa's availability resolver return no usable selection; current T3 Code preserves the explicit unavailable model and saved options as a visible, dispatchable selection so transient catalog absence does not disable the user's choice.
- Kisa cannot preserve or send OpenCode's independent `agent` option.

See [Kisa's OpenCode provider](../../apps/desktop/src/main/ai/providers/opencode.ts) and [selection resolution](../../apps/desktop/src/renderer/src/ai.ts).

## Which upstream traits belong in Kisa

T3 Code is an interactive coding-agent harness. Kisa's AI writing is tool-disabled, permission-denied, structured one-shot generation. Alignment should preserve provider truth without importing controls whose behavior depends on a coding-agent session.

Kisa-relevant traits are:

- the explicit selected model;
- Codex's live per-model reasoning choices and concrete default;
- Claude's ordinary per-model effort choices and Haiku's boolean Thinking setting;
- OpenCode's opaque per-model Variant choice;
- potentially Codex service tier and Claude Fast Mode, but only with clear cost/speed copy and an explicit product decision.

Interactive-coding traits that should not be copied automatically are:

- Claude Ultracode, because it combines `xhigh` with multi-agent orchestration while Kisa disables tools;
- OpenCode Agent selection (`build`, `plan`, and custom agents), because Kisa asks for a constrained JSON result and denies all permissions;
- Codex/Claude child-agent model and effort reporting;
- provider interaction modes, plan modes, skills, slash commands, context-usage compaction, and per-turn option switching.

Claude Ultrathink is not an ordinary CLI effort and should also stay out by default. T3 Code activates it by rewriting the user's interactive prompt. Kisa has a fixed system contract plus separately delimited mail data and user preferences; prompt injection here would need a dedicated design and safety review. Context-window selection is not harmful, but it has no practical effect on Kisa's currently bounded mail context, which is comfortably below the smallest advertised Claude context.

## Implemented in this review

- [x] Claude models are filtered by the same minimum CLI versions as T3 Code: Opus 4.7 at 2.1.111, Opus 4.8 at 2.1.154, Fable 5 at 2.1.169, and Opus 5 at 2.1.219.
- [x] Claude Haiku 4.5 exposes Thinking as Off/On and dispatches it through `--settings {"alwaysThinkingEnabled": false|true}` instead of `--effort`.
- [x] `AiModel` and `AiReasoningOption` can carry optional display labels; Settings, tooltips, and selection summaries use them.
- [x] OpenCode models label their option Variant while preserving the opaque variant id and existing dispatch behavior.
- [x] Codex 0.150 Business, Enterprise, and Edu account-plan variants receive the correct authentication labels.

These are narrow extensions of Kisa's existing one-option settings shape. They do not claim support for multiple simultaneous descriptors or for T3 Code's interactive agent traits.

## Alignment checklist

### Required to match the stated model/reasoning feature

- [x] Add a model-scoped Thinking choice for Claude Haiku 4.5 and translate it to Claude's boolean `alwaysThinkingEnabled` setting.
- [x] Keep Codex efforts and defaults live and open-string; coverage preserves `ultra` and an unknown future effort id rather than introducing a closed enum.
- [x] Label OpenCode's control **Variant**, while continuing to pass the opaque selected id unchanged.
- [x] Keep the existing concrete-default behavior: one real option carries the Default badge, and invalid saved values heal to that real option.
- [x] Version-gate the newer Claude catalog entries instead of offering a model the installed CLI cannot run.

### Required only for full T3 Code option parity

- [ ] Replace Kisa's single nullable string `providerReasoning` with model-scoped typed option selections that can hold multiple `{ id, value }` pairs with string or boolean values.
- [ ] Preserve labels and descriptions for every generic descriptor across IPC. This review carries the one model option's label, but Kisa still cannot represent several independently labeled descriptors at once.
- [ ] Decode and expose Codex `serviceTiers`/`additionalSpeedTiers`, then pass an explicit selected `service_tier` at dispatch. Because a faster tier can affect billing, this needs clear product copy rather than silent enablement.
- [ ] Add any intentionally supported Claude Fast Mode and context-window descriptors. Do not add Ultracode while Kisa disables tools, and treat Ultrathink as prompt injection rather than a CLI effort.
- [ ] Load OpenCode inventory through the verified SDK server path and preserve an unavailable saved model plus its saved options across transient catalog failures.
- [ ] Add OpenCode's `agent` descriptor only if choosing an agent is meaningful for Kisa's permission-denied, structured one-shot mail generation.

### Explicit product-scope decisions

- [ ] Decide whether Kisa remains a Codex/Claude/OpenCode client. Cursor and Grok are not accidental omissions; adding them requires new adapters, provider probes, privacy review, UI copy, and tests.
- [ ] Decide whether Kisa's Claude default intentionally remains Sonnet 5. T3 Code's general interactive default is also Sonnet 5, but its inexpensive one-shot text-generation default is Haiku 4.5. This is a quality/cost decision, not upstream drift.
- [ ] If Kisa adds current/legacy grouping, prefer a release-bundled list or a privacy-reviewed refresh policy. T3 Code's hourly hosted manifest is useful for a fast-moving agent model picker, but it would add a new network surface to Kisa.

## Verification targets for an implementation change

- Codex inventory tests preserve unknown effort ids and map both current and legacy service-tier fields.
- Each Claude model test asserts the exact available options and default, plus CLI-version filtering.
- Haiku Thinking serializes as a boolean through settings, IPC, selection, tooltip, and CLI settings.
- Model changes retain only option ids and values supported by the new model; otherwise they materialize the new model's concrete defaults.
- OpenCode UI says Variant, forwards the opaque value, and does not discard the saved model/options when a refresh temporarily omits them.
- Existing settings migrate without changing the user's selected provider, model, or ordinary reasoning choice.
