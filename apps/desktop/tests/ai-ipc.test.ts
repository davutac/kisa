// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable unicorn/no-useless-undefined vitest/max-expects vitest/no-standalone-expect vitest/prefer-import-in-mock vitest/require-mock-type-parameters
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vitest";

import {
  AI_CATEGORIZE_THREAD_CHANNEL,
  AI_CLEANUP_DRAFT_CHANNEL,
  AI_GENERATE_REPLY_CHANNEL,
  AI_GET_SETTINGS_CHANNEL,
  AI_LIST_PROVIDERS_CHANNEL,
  AI_UPDATE_SETTINGS_CHANNEL,
} from "../src/shared/ipc/channels";

const state = vi.hoisted(() => ({
  categorizeThread: vi.fn(() => Effect.succeed({ labelIds: ["Label_1"] })),
  cleanupAiDraft: vi.fn(() =>
    Effect.succeed({ body: "Clean body", subject: "Clean subject" })
  ),
  generateAiReply: vi.fn(() => Effect.succeed({ body: "Generated reply" })),
  getAiSettings: vi.fn(() =>
    Effect.succeed({
      activeProvider: "codex" as const,
      cleanupUserInstructions: "Cleanup",
      providerModels: {
        claude: "claude-sonnet-5",
        codex: "gpt-5.6-luna",
        opencode: "openai/gpt-5",
      },
      providerReasoning: { claude: null, codex: "low", opencode: "high" },
      replyUserInstructions: "Reply",
    })
  ),
  listAiProviderStatuses: vi.fn(() =>
    Effect.succeed([
      {
        authEmail: "person@example.com",
        authLabel: "ChatGPT Pro 5x Subscription",
        authentication: "authenticated" as const,
        installed: true,
        models: [
          {
            id: "gpt-5.6-luna",
            isDefault: true,
            name: "GPT-5.6 Luna",
            reasoningOptions: [
              { id: "low" },
              { id: "medium", isDefault: true },
            ],
          },
        ],
        provider: "codex" as const,
        version: "0.147.0",
      },
    ])
  ),
  updateAiSettings: vi.fn(() =>
    Effect.succeed({
      activeProvider: "codex" as const,
      cleanupUserInstructions: "Cleanup",
      providerModels: {
        claude: "claude-sonnet-5",
        codex: "gpt-5.6-luna",
        opencode: "openai/gpt-5",
      },
      providerReasoning: { claude: null, codex: "low", opencode: "high" },
      replyUserInstructions: "Reply",
    })
  ),
}));

vi.mock("../src/main/ai/ai-settings", () => ({
  getAiSettings: state.getAiSettings,
  updateAiSettings: state.updateAiSettings,
}));

vi.mock("../src/main/ai/ai-writing", () => ({
  cleanupAiDraft: state.cleanupAiDraft,
  generateAiReply: state.generateAiReply,
}));

vi.mock("../src/main/ai/provider-catalog", () => ({
  listAiProviderStatuses: state.listAiProviderStatuses,
}));

vi.mock("../src/main/ai/thread-categorization", () => ({
  categorizeThread: state.categorizeThread,
}));

const {
  categorizeMailThread,
  cleanupDraft,
  generateReply,
  getAiWritingSettings,
  listAiProviders,
  updateAiWritingSettings,
} = await import("../src/main/ipc/methods/ai");

describe("AI IPC", () => {
  it.effect(
    "exposes provider inventory and settings through typed replies",
    () =>
      Effect.gen(function* exposeProviderInventoryAndSettings() {
        expect(listAiProviders.channel).toBe(AI_LIST_PROVIDERS_CHANNEL);
        expect(getAiWritingSettings.channel).toBe(AI_GET_SETTINGS_CHANNEL);
        expect(updateAiWritingSettings.channel).toBe(
          AI_UPDATE_SETTINGS_CHANNEL
        );

        expect(yield* listAiProviders.handler(undefined)).toStrictEqual({
          data: [
            {
              authEmail: "person@example.com",
              authLabel: "ChatGPT Pro 5x Subscription",
              authentication: "authenticated",
              installed: true,
              models: [
                {
                  id: "gpt-5.6-luna",
                  isDefault: true,
                  name: "GPT-5.6 Luna",
                  reasoningOptions: [
                    { id: "low" },
                    { id: "medium", isDefault: true },
                  ],
                },
              ],
              provider: "codex",
              version: "0.147.0",
            },
          ],
          ok: true,
        });
        expect(yield* getAiWritingSettings.handler(undefined)).toStrictEqual({
          data: {
            activeProvider: "codex",
            cleanupUserInstructions: "Cleanup",
            providerModels: {
              claude: "claude-sonnet-5",
              codex: "gpt-5.6-luna",
              opencode: "openai/gpt-5",
            },
            providerReasoning: {
              claude: null,
              codex: "low",
              opencode: "high",
            },
            replyUserInstructions: "Reply",
          },
          ok: true,
        });
      })
  );

  it.effect("routes reply and cleanup requests without sending mail", () =>
    Effect.gen(function* routeReplyAndCleanupRequests() {
      const replyRequest = {
        accountId: "person@example.com",
        model: { model: "claude-sonnet-5", provider: "claude" as const },
        threadId: "thread-1",
      };
      const cleanupRequest = {
        body: "rough body",
        model: { model: "openai/gpt-5", provider: "opencode" as const },
        subject: "rough subject",
      };

      expect(generateReply.channel).toBe(AI_GENERATE_REPLY_CHANNEL);
      expect(cleanupDraft.channel).toBe(AI_CLEANUP_DRAFT_CHANNEL);
      expect(yield* generateReply.handler(replyRequest)).toStrictEqual({
        data: { body: "Generated reply" },
        ok: true,
      });
      expect(yield* cleanupDraft.handler(cleanupRequest)).toStrictEqual({
        data: { body: "Clean body", subject: "Clean subject" },
        ok: true,
      });
      expect(state.generateAiReply).toHaveBeenCalledWith(replyRequest);
      expect(state.cleanupAiDraft).toHaveBeenCalledWith(cleanupRequest);
    })
  );

  it.effect("routes manual categorization to the AI label pipeline", () =>
    Effect.gen(function* routeManualCategorization() {
      const request = {
        accountId: "person@example.com",
        threadId: "thread-1",
      };

      expect(categorizeMailThread.channel).toBe(AI_CATEGORIZE_THREAD_CHANNEL);
      expect(yield* categorizeMailThread.handler(request)).toStrictEqual({
        data: { labelIds: ["Label_1"] },
        ok: true,
      });
      expect(state.categorizeThread).toHaveBeenCalledWith(request);
    })
  );

  it.effect("rejects unknown providers before invoking backend code", () =>
    Effect.gen(function* rejectUnknownProviders() {
      const exit = yield* Effect.exit(
        cleanupDraft.handler({
          body: "Body",
          model: { model: "model", provider: "other" },
          subject: "Subject",
        })
      );

      expect(exit._tag).toBe("Failure");
    })
  );
});
