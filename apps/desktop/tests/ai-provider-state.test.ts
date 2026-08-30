import { describe, expect, it, vi } from "vitest";

import type { AiApi } from "../src/renderer/src/platform/desktop";
import { createAiProviderStateStore } from "../src/renderer/src/state/ai-provider-state";
import type {
  AiProviderStatusListReply,
  AiProviderStatus,
  AiSettings,
} from "../src/shared/ipc/ai";

const settings = {
  activeProvider: "codex",
  cleanupUserInstructions: "Clean up drafts",
  providerModels: {
    claude: "claude-sonnet-5",
    codex: "gpt-5.6-luna",
    opencode: null,
  },
  providerReasoning: { claude: null, codex: "low", opencode: null },
  replyUserInstructions: "Write replies",
} satisfies AiSettings;

const providers = [
  {
    authentication: "authenticated",
    installed: true,
    models: [
      {
        id: "gpt-5.6-luna",
        isDefault: true,
        name: "GPT-5.6 Luna",
        reasoningOptions: [{ id: "low" }, { id: "medium", isDefault: true }],
      },
    ],
    provider: "codex",
  },
] satisfies readonly AiProviderStatus[];

const createAiApi = (): AiApi => ({
  categorizeThread: vi.fn<AiApi["categorizeThread"]>(() =>
    Promise.resolve({ data: { labelIds: [] }, ok: true as const })
  ),
  cleanupDraft: vi.fn<AiApi["cleanupDraft"]>(() =>
    Promise.resolve({
      data: { body: "Clean body", subject: "Clean subject" },
      ok: true as const,
    })
  ),
  generateReply: vi.fn<AiApi["generateReply"]>(() =>
    Promise.resolve({ data: { body: "Reply" }, ok: true as const })
  ),
  getSettings: vi.fn<AiApi["getSettings"]>(() =>
    Promise.resolve({ data: settings, ok: true as const })
  ),
  listProviders: vi.fn<AiApi["listProviders"]>(() =>
    Promise.resolve({ data: providers, ok: true as const })
  ),
  updateSettings: vi.fn<AiApi["updateSettings"]>((request) =>
    Promise.resolve({ data: request, ok: true as const })
  ),
});

describe("AI provider state", () => {
  it("loads provider readiness once for the authenticated app lifetime", async () => {
    const api = createAiApi();
    const store = createAiProviderStateStore(api);

    await Promise.all([
      store.getState().initialize(),
      store.getState().initialize(),
    ]);

    expect(store.getState()).toMatchObject({
      isLoadingProviders: false,
      isLoadingSettings: false,
      providers,
      providersError: null,
      settings,
      settingsError: null,
    });
    expect(api.getSettings).toHaveBeenCalledOnce();
    expect(api.listProviders).toHaveBeenCalledOnce();
  });

  it("keeps the last usable provider state while a refresh fails", async () => {
    const api = createAiApi();
    const store = createAiProviderStateStore(api);
    await store.getState().initialize();
    const refreshReply = Promise.withResolvers<AiProviderStatusListReply>();
    vi.mocked(api.listProviders).mockReturnValueOnce(refreshReply.promise);

    const refreshing = store.getState().refreshProviders();
    const duplicateRefresh = store.getState().refreshProviders();

    expect(store.getState()).toMatchObject({
      isLoadingProviders: true,
      providers,
      providersError: null,
    });
    expect(api.listProviders).toHaveBeenCalledTimes(2);

    refreshReply.resolve({ error: "Provider probe failed", ok: false });
    await Promise.all([refreshing, duplicateRefresh]);

    expect(store.getState()).toMatchObject({
      isLoadingProviders: false,
      providers,
      providersError: "Provider probe failed",
    });
  });

  it("publishes saved model settings to existing consumers", async () => {
    const api = createAiApi();
    const store = createAiProviderStateStore(api);
    await store.getState().initialize();
    const nextSettings = {
      ...settings,
      activeProvider: "claude",
    } satisfies AiSettings;

    const error = await store.getState().saveSettings(nextSettings);

    expect(error).toBeNull();
    expect(store.getState().settings).toStrictEqual(nextSettings);
    expect(api.updateSettings).toHaveBeenCalledWith(nextSettings);
  });

  it("can retry an unavailable settings load without rebuilding the state", async () => {
    const api = createAiApi();
    vi.mocked(api.getSettings)
      .mockResolvedValueOnce({ error: "Database unavailable", ok: false })
      .mockResolvedValueOnce({ data: settings, ok: true });
    const store = createAiProviderStateStore(api);
    await store.getState().initialize();

    expect(store.getState()).toMatchObject({
      isLoadingSettings: false,
      settings: null,
      settingsError: "Database unavailable",
    });

    await store.getState().loadSettings();

    expect(store.getState()).toMatchObject({
      isLoadingSettings: false,
      settings,
      settingsError: null,
    });
  });
});
