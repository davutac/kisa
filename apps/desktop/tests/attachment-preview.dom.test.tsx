import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AttachmentPreviewApp from "../src/renderer/src/attachment-preview/attachment-preview-app";
import type { AttachmentPreviewBridge } from "../src/shared/ipc/attachment-preview";
import type {
  MailAttachmentPreviewReply,
  MailAttachmentSaveReply,
} from "../src/shared/ipc/mail";

// The attachment preview window's preload declares this; the test program
// doesn't include preload declarations.
declare global {
  interface Window {
    attachmentPreview?: AttachmentPreviewBridge;
  }
}

const agent = createAgent();

const imageReply: MailAttachmentPreviewReply = {
  data: {
    bytes: new Uint8Array(2048),
    filename: "receipt.png",
    kind: "image",
    mediaType: "image/png",
  },
  ok: true,
};

const installBridge = ({
  load = () => Promise.resolve(imageReply),
  save = () => Promise.resolve({ data: "saved", ok: true }),
}: {
  readonly load?: () => Promise<MailAttachmentPreviewReply>;
  readonly save?: () => Promise<MailAttachmentSaveReply>;
} = {}) => {
  const bridge = {
    load: vi.fn<() => Promise<MailAttachmentPreviewReply>>(load),
    save: vi.fn<() => Promise<MailAttachmentSaveReply>>(save),
  };
  window.attachmentPreview = bridge;
  return bridge;
};

const download = () => screen.getByRole("button", { name: "Download" });

describe(AttachmentPreviewApp, () => {
  beforeEach(() => {
    // jsdom has neither, so there is nothing to spy on.
    Object.assign(URL, {
      createObjectURL: () => "blob:attachment-preview",
      revokeObjectURL: vi.fn<(url: string) => void>(),
    });
  });

  afterEach(() => {
    window.attachmentPreview = undefined;
  });

  it("names its one control, and an agent downloads through it", async () => {
    const bridge = installBridge();
    render(<AttachmentPreviewApp />);
    await screen.findByRole("img", { name: "receipt.png" });

    const components = agent.snapshot().filter((entry) => !entry.offPage);
    for (const entry of components) {
      expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBe(
        "Download"
      );
    }
    expect(components).toHaveLength(1);

    const result = await agent.act({
      steps: [{ action: "press", ref: "Download" }],
    });

    expect(result).toMatchObject({ ok: true });
    expect(bridge.save).toHaveBeenCalledOnce();
    expect(screen.getByText("2.0 KB")).toBeDefined();
  });

  it("keeps Download disabled until the attachment loads", async () => {
    const loading = Promise.withResolvers<MailAttachmentPreviewReply>();
    const bridge = installBridge({ load: () => loading.promise });
    render(<AttachmentPreviewApp />);

    const pending = {
      disabled: download().hasAttribute("disabled"),
      status: screen.queryByText("Opening the envelope…") !== null,
    };
    const whileLoading = await agent.act({
      steps: [{ action: "press", ref: "Download" }],
    });

    await act(async () => {
      loading.resolve(imageReply);
      await settle();
    });

    expect({
      disabledAfter: download().hasAttribute("disabled"),
      pending,
      pressedWhileLoading: whileLoading.ok,
      saves: bridge.save.mock.calls.length,
    }).toStrictEqual({
      disabledAfter: false,
      pending: { disabled: true, status: true },
      pressedWhileLoading: false,
      saves: 0,
    });
  });

  it("shows why the attachment could not load, and offers no download", async () => {
    installBridge({
      load: () =>
        Promise.resolve({ error: "This attachment is too large.", ok: false }),
    });
    render(<AttachmentPreviewApp />);

    await screen.findByText("This attachment is too large.");
    expect({
      disabled: download().hasAttribute("disabled"),
      title: screen.queryByText("Attachment preview") !== null,
    }).toStrictEqual({ disabled: true, title: true });
  });

  it("downloads once for a double press, and reports a failed save in place of the size", async () => {
    const user = userEvent.setup();
    const saving = Promise.withResolvers<MailAttachmentSaveReply>();
    const bridge = installBridge({ save: () => saving.promise });
    render(<AttachmentPreviewApp />);
    await screen.findByRole("img", { name: "receipt.png" });

    await user.dblClick(download());
    await act(async () => {
      saving.resolve({ error: "The disk is full.", ok: false });
      await settle();
    });

    expect({
      alert: screen.getByRole("alert").textContent,
      disabled: download().hasAttribute("disabled"),
      saves: bridge.save.mock.calls.length,
      size: screen.queryByText("2.0 KB"),
    }).toStrictEqual({
      alert: "The disk is full.",
      disabled: false,
      saves: 1,
      size: null,
    });
  });
});
