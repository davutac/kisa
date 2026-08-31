import { describe, expect, it } from "vitest";

import {
  assignComposerInlineContentIds,
  collectComposerInlineContentIds,
  getActiveComposerAttachments,
  partitionComposerFiles,
} from "../src/renderer/src/components/mail/composer-inline-images";
import {
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_MESSAGE_BYTES,
} from "../src/shared/attachments";

const fileWithType = (type: string, size = 100): File =>
  ({ size, type }) as File;

describe("composer inline images", () => {
  it("routes email-safe image formats inline and falls back for other files", () => {
    const png = fileWithType("image/png");
    const jpeg = fileWithType("image/jpeg");
    const gif = fileWithType("image/gif");
    const webp = fileWithType("image/webp");
    const heic = fileWithType("image/heic");
    const pdf = fileWithType("application/pdf");

    expect(
      partitionComposerFiles([png, jpeg, gif, webp, heic, pdf])
    ).toStrictEqual({
      attachments: [heic, pdf],
      inlineImages: [png, jpeg, gif, webp],
    });
  });

  it("attaches images that exceed the inline rendering budgets", () => {
    const tooLarge = fileWithType("image/png", MAX_INLINE_IMAGE_BYTES + 1);
    const overMessageBudget = fileWithType("image/jpeg", 2);

    expect(
      partitionComposerFiles(
        [tooLarge, overMessageBudget],
        MAX_INLINE_MESSAGE_BYTES - 1
      )
    ).toStrictEqual({
      attachments: [tooLarge, overMessageBudget],
      inlineImages: [],
    });
  });

  it("rechecks the retained inline budget after authorization", () => {
    const authorized = {
      filename: "new.png",
      id: "new",
      mediaType: "image/png",
      referenceId: "new-ref",
      size: 2,
    };

    expect(
      assignComposerInlineContentIds(
        [authorized],
        MAX_INLINE_MESSAGE_BYTES - 1,
        () => "new@inline.kisa.email"
      )
    ).toStrictEqual([authorized]);
  });

  it("finds the inline parts still referenced by the draft body", () => {
    expect(
      collectComposerInlineContentIds(
        '<p>Before <img alt="one" src="cid:first@inline.kisa.email">' +
          '<img src="https://example.com/remote.png"></p>'
      )
    ).toStrictEqual(new Set(["first@inline.kisa.email"]));
  });

  it("keeps detached inline records available for editor undo", () => {
    const regularAttachment = {
      filename: "notes.txt",
      id: "regular",
      mediaType: "text/plain",
      referenceId: "regular-ref",
      size: 10,
    };
    const inlineAttachment = {
      contentId: "photo@inline.kisa.email",
      filename: "photo.png",
      id: "inline",
      mediaType: "image/png",
      referenceId: "inline-ref",
      size: 20,
    };
    const attachments = [regularAttachment, inlineAttachment];

    expect(getActiveComposerAttachments(attachments, new Set())).toStrictEqual([
      regularAttachment,
    ]);
    expect(
      getActiveComposerAttachments(
        attachments,
        new Set(["photo@inline.kisa.email"])
      )
    ).toStrictEqual(attachments);
  });
});
