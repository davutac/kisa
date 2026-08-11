// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable unicorn/no-useless-undefined vitest/no-standalone-expect vitest/prefer-import-in-mock
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import {
  COMPOSER_TEMPLATE_DELETE_CHANNEL,
  COMPOSER_TEMPLATE_LIST_CHANNEL,
  COMPOSER_TEMPLATE_SAVE_CHANNEL,
} from "../src/shared/ipc/channels";
import type {
  ComposerTemplate,
  ComposerTemplateInput,
} from "../src/shared/ipc/templates";

const state = vi.hoisted(() => ({
  deleteTemplate: vi.fn<() => Effect.Effect<void>>(() => Effect.void),
  listTemplates: vi.fn<() => Effect.Effect<readonly ComposerTemplate[]>>(() =>
    Effect.succeed([])
  ),
  saveTemplate: vi.fn<
    (template: ComposerTemplateInput) => Effect.Effect<ComposerTemplate>
  >((template) => Effect.succeed({ ...template, createdAt: 1, updatedAt: 1 })),
}));

vi.mock("../src/main/templates/composer-templates", () => ({
  deleteComposerTemplate: state.deleteTemplate,
  listComposerTemplates: state.listTemplates,
  saveComposerTemplate: state.saveTemplate,
}));

const { deleteTemplate, listTemplates, saveTemplate } =
  await import("../src/main/ipc/methods/templates");

const template = {
  accountId: null,
  bcc: [],
  body: { html: "", text: "" },
  cc: [],
  id: "template-1",
  name: "Introduction",
  subject: "",
  to: [],
};

describe("composer template IPC", () => {
  it.effect("exposes validated list, save, and delete methods", () =>
    Effect.gen(function* composerTemplateIpc() {
      const listReply = yield* listTemplates.handler(undefined);
      const saveReply = yield* saveTemplate.handler(template);
      const deleteReply = yield* deleteTemplate.handler({
        templateId: template.id,
      });

      expect({
        delete: deleteTemplate.channel,
        list: listTemplates.channel,
        save: saveTemplate.channel,
      }).toStrictEqual({
        delete: COMPOSER_TEMPLATE_DELETE_CHANNEL,
        list: COMPOSER_TEMPLATE_LIST_CHANNEL,
        save: COMPOSER_TEMPLATE_SAVE_CHANNEL,
      });
      expect(listReply).toStrictEqual({ data: [], ok: true });
      expect(saveReply).toStrictEqual({
        data: { ...template, createdAt: 1, updatedAt: 1 },
        ok: true,
      });
      expect(deleteReply).toStrictEqual({ data: undefined, ok: true });
    })
  );
});
