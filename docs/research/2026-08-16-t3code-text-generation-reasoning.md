# T3 Code text-generation model reasoning

Date: 2026-08-16  
Upstream reviewed: [`pingdotgg/t3code` at `bab4b6f02b8bdaf15fd32636a97f69ff657cec50`](https://github.com/pingdotgg/t3code/tree/bab4b6f02b8bdaf15fd32636a97f69ff657cec50)

## Conclusion

T3 Code represents reasoning as a model-owned option descriptor. A descriptor has an opaque provider-specific id, a list of real choices, an optional current value, and an `isDefault` marker on one of those choices. The UI renders the default marker as a badge beside that real choice. It does not add a second synthetic `Default (Medium)` or `Default (High)` row, so the menu cannot contain two values that mean the same thing.

The source of the choices is provider-specific:

- Codex reasoning efforts and the default effort come directly from every model returned by Codex `model/list`.
- Claude's model list, reasoning choices, and defaults are a T3 Code-owned static catalog, filtered by the installed Claude Code version. The Claude Agent SDK initialization probe supplies account and command information, not this model catalog.
- OpenCode variants come from the live OpenCode provider inventory. T3 Code then infers a default variant by upstream provider id.

The saved `ModelSelection` always names an explicit provider instance and explicit model slug. Its option values are also concrete ids such as `low`, `high`, or `medium`; `default` is presentation metadata, not a persisted reasoning value. Before dispatch, T3 Code resolves missing or invalid selections back to the descriptor's current/default real choice and materializes explicit option selections.

## Shared representation

`ProviderOptionChoice` contains `id`, `label`, optional `description`, and optional `isDefault`. A select descriptor contains its own `id`, `label`, choices, optional `currentValue`, and optional prompt-injected values. A `ModelSelection` persists `instanceId`, the explicit `model` slug, and optional `{ id, value }[]` selections. The values remain open strings because provider vocabularies differ. ([option contracts](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/packages/contracts/src/model.ts#L7-L53), [model-selection contract](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/packages/contracts/src/orchestration.ts#L55-L117))

## How each provider obtains models, reasoning choices, and defaults

### Codex: live, per-model metadata

The Codex provider pages through `model/list`. Each response model becomes a real model row with its slug, display name, `isDefault`, and capabilities. T3 Code maps `supportedReasoningEfforts` directly into choices and marks the choice matching `defaultReasoningEffort` as the default; it does not create a synthetic default choice. ([Codex capability mapping](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/CodexProvider.ts#L115-L181), [model parsing and paginated discovery](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/CodexProvider.ts#L183-L201), [request loop](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/CodexProvider.ts#L291-L307))

Known effort ids receive display labels (`xhigh` becomes `Extra High`, for example), while unknown ids are shown unchanged. The reasoning descriptor id is `reasoningEffort`, and its `currentValue` is the real default effort id. ([effort labels](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/CodexProvider.ts#L53-L73), [reasoning descriptor](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/CodexProvider.ts#L115-L155))

T3 Code overrides only the default **model** preference when a preferred current Codex model is present. That is separate from the provider-reported default **reasoning effort**, which stays attached to each model. ([preferred Codex model resolution](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/CodexProvider.ts#L203-L225))

### Claude: explicit static model catalog, version-gated

Claude is deliberately different. T3 Code owns an explicit `CLAUDE_MODEL_CATALOG` of named models and their capabilities; it does not add a `Default` pseudo-model. At the inspected commit the catalog contains Claude Fable 5, Opus 5, Opus 4.8, Opus 4.7, Opus 4.6, Opus 4.5, Sonnet 5, Sonnet 4.6, and Haiku 4.5. ([Claude catalog](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/ClaudeProvider.ts#L65-L328))

Fable 5, Opus 5, and Sonnet 5 are the catalog's current models; the other built-ins are marked legacy, but remain explicit named model rows. ([current/legacy classification](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/ClaudeProvider.ts#L54-L63), [legacy marking](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/ClaudeProvider.ts#L330-L332))

The reasoning defaults are explicit in that catalog:

| Model | Reasoning choices | Marked default |
| --- | --- | --- |
| Fable 5 | low, medium, high, xhigh, max, ultracode, ultrathink | high |
| Opus 5 | low, medium, high, xhigh, max, ultracode, ultrathink | high |
| Opus 4.8 | low, medium, high, xhigh, max, ultracode, ultrathink | high |
| Opus 4.7 | low, medium, high, xhigh, max, ultrathink | xhigh |
| Opus 4.6 | low, medium, high, max, ultrathink | high |
| Opus 4.5 | low, medium, high, max | high |
| Sonnet 5 | low, medium, high, xhigh, max, ultrathink | high |
| Sonnet 4.6 | low, medium, high, max, ultrathink | high |
| Haiku 4.5 | no effort select; a `thinking` boolean instead | n/a |

The installed CLI version gates newer entries: Opus 5, Fable 5, Opus 4.8, and Opus 4.7 each have a minimum Claude Code version; all other catalog entries remain. Custom Claude models get empty fallback capabilities rather than inheriting an arbitrary built-in model's reasoning options. ([version filtering](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/ClaudeProvider.ts#L330-L368), [version probe and final model construction](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/ClaudeProvider.ts#L807-L915), [custom-model capability fallback](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/providerSnapshot.ts#L141-L165))

The lightweight Claude Agent SDK initialization probe is only used for account/authentication metadata and slash commands. It sends no prompt and does not read a model or effort catalog from `initializationResult()`. ([Claude initialization probe](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/ClaudeProvider.ts#L719-L788))

### OpenCode: live variants plus an inferred default

OpenCode inventory supplies connected providers and their models. T3 Code flattens only connected providers, keeps each explicit `provider/model` slug, and reads the model's `variants` keys as selectable option ids. ([OpenCode inventory flattening](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/OpenCodeProvider.ts#L220-L251), [inventory loading](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/OpenCodeProvider.ts#L393-L431))

The upstream inventory does not provide the default in the shape T3 Code uses, so T3 Code infers one: the sole variant if only one exists; `high` for Anthropic or Google providers; `medium`, otherwise `high`, for OpenAI or OpenCode; and no inferred default for other provider ids. The descriptor id is `variant`, and T3 Code labels the control `Variant`, not `Reasoning`; it does not assume that every provider-defined variant denotes reasoning effort. This is an application heuristic, not provider-returned default metadata. ([OpenCode variant/default mapping](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/OpenCodeProvider.ts#L137-L218))

## Default and normalization semantics

T3 Code has two distinct kinds of default:

1. The application-wide initial text-generation selection is explicitly Codex `gpt-5.6-luna` with `reasoningEffort: low`.
2. Every model may advertise its own default option choice through `isDefault` and `currentValue`.

The application-wide constants also define provider-specific fallback text-generation models: Codex Luna, Claude Haiku 4.5, Cursor Composer 2, and OpenCode `openai/gpt-5`. ([model and text-generation defaults](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/packages/contracts/src/model.ts#L136-L166), [saved settings default](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/packages/contracts/src/settings.ts#L575-L588))

Resolution follows one rule: use the selected real option if it exists; otherwise use the descriptor's `currentValue`, then its `isDefault` choice. An unknown selection is replaced by the same fallback. Prompt-injected choices such as Claude `ultrathink` deliberately resolve back to the descriptor default for dispatch unless prompt handling is active. ([choice resolution](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/packages/shared/src/model.ts#L80-L101), [descriptor/current-value resolution](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/packages/shared/src/model.ts#L119-L174))

`buildProviderOptionSelectionsFromDescriptors` then turns all resolved current values into explicit `{ id, value }` selections. Consequently, switching to a model with no saved options still yields that model's real default ids before dispatch; there is no need to persist or transmit the word `default`. ([selection materialization](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/packages/shared/src/model.ts#L196-L229), [composer normalization](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/web/src/components/chat/composerProviderState.tsx#L51-L80), [settings selection normalization](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/web/src/modelSelection.ts#L280-L330))

## Rendering: one real option, one default badge

The model picker trigger resolves and displays the selected model's real name. Model rows come from the provider inventory; there is no synthetic `Default (recommended)` row in this path. ([explicit model trigger](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/web/src/components/chat/ProviderModelPicker.tsx#L50-L70), [picker wiring](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/web/src/components/chat/ProviderModelPicker.tsx#L128-L209))

The traits menu iterates only `descriptor.options`. If a real option is the default, it renders a small `Default` badge beside that option's ordinary label. The radio group's selected value is the resolved real option id. This is the exact mechanism that avoids duplicated `Default (Medium)` plus `Medium` rows. ([default badge](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/web/src/components/chat/TraitsPicker.tsx#L49-L60), [reasoning menu rendering](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/web/src/components/chat/TraitsPicker.tsx#L296-L355))

The trigger itself shows the selected real label, and may combine it with other traits using a middle dot. It never prefixes the label with `Default`. ([trigger label construction](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/web/src/components/chat/TraitsPicker.tsx#L390-L443))

In Settings, both the model and traits triggers use `min-w-0 max-w-none shrink-0`, so they size to their contents instead of occupying equal columns or a fixed full width. ([Settings trigger sizing](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/web/src/components/settings/SettingsPanels.tsx#L2281-L2319))

## One-shot text-generation dispatch

Thread-title, branch-name, commit-message, and pull-request writing all receive the complete saved `ModelSelection`. Thread titles read `settings.textGenerationModelSelection`; source-control writing may use its own override. ([one-shot selection routing](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts#L784-L863), [title regeneration](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts#L890-L926))

Provider adapters translate the opaque option ids at their boundary:

- **Codex:** reads `reasoningEffort`, falls back to the global text-generation effort `low`, and launches `codex exec` with `--model <explicit-slug>` and `--config model_reasoning_effort="<explicit-effort>"`. ([Codex one-shot invocation](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/textGeneration/CodexTextGeneration.ts#L152-L219))
- **Claude:** resolves missing/invalid `effort` through the selected model's static descriptor, maps special/compatibility values (`ultracode` to `xhigh`, `ultrathink` to no flag, older-model adjustments), and launches Claude with `--model <explicit-id>` and, when applicable, `--effort <resolved-effort>`. ([Claude effort normalization](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/provider/Layers/ClaudeProvider.ts#L398-L444), [Claude one-shot invocation](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/textGeneration/ClaudeTextGeneration.ts#L107-L183))
- **OpenCode:** parses the explicit `provider/model` slug, reads the selected `variant`, and passes it directly as `variant` to `client.session.prompt`. ([OpenCode one-shot invocation](https://github.com/pingdotgg/t3code/blob/bab4b6f02b8bdaf15fd32636a97f69ff657cec50/apps/server/src/textGeneration/OpenCodeTextGeneration.ts#L361-L435))

## Direct implications for Kisa

1. Keep the selected model explicit. Do not expose or persist a provider-level `default` model choice when the UI can resolve a real model slug.
2. Keep reasoning values provider-owned and model-scoped. Codex efforts, Claude effort ids, and OpenCode variants do not need a universal enum.
3. Represent a default as metadata on one real choice and preselect that choice. Do not manufacture an additional `Default (<label>)` choice.
4. For Claude, a complete named model list requires an application-owned catalog (and maintenance/version policy) unless the installed provider exposes a trustworthy model inventory. T3 Code does not obtain that list from the Claude SDK initialization result.
5. Resolve defaults once into explicit values before saving or dispatching. Provider adapters should still retain a safe missing-value fallback at their boundary.
6. Preserve provider semantics in labels: OpenCode exposes `Variant`, which may happen to encode reasoning for a model but is not universally a reasoning control.
