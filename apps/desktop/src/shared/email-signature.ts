import * as Schema from "effect/Schema";

export const MAX_EMAIL_SIGNATURE_TEXT_LENGTH = 10_000;
export const MAX_EMAIL_SIGNATURE_HTML_LENGTH = 100_000;

export const EmailSignatureBody = Schema.Struct({
  html: Schema.String.check(
    Schema.isMaxLength(MAX_EMAIL_SIGNATURE_HTML_LENGTH)
  ),
  text: Schema.String.check(
    Schema.isMaxLength(MAX_EMAIL_SIGNATURE_TEXT_LENGTH)
  ),
});
export type EmailSignatureBody = typeof EmailSignatureBody.Type;

export const EMPTY_EMAIL_SIGNATURE_BODY = {
  html: "",
  text: "",
} as const satisfies EmailSignatureBody;

export const normalizeEmailSignature = (
  value: EmailSignatureBody
): EmailSignatureBody => {
  const text = value.text.replaceAll(/\r\n?/gu, "\n");
  const html = value.html.trim();
  if (text.trim().length === 0 || html.length === 0) {
    return EMPTY_EMAIL_SIGNATURE_BODY;
  }

  return { html, text };
};

export const createEmailSignatureBody = (
  configuredSignature: EmailSignatureBody
): EmailSignatureBody | undefined => {
  const signature = normalizeEmailSignature(configuredSignature);
  return signature.text.length === 0 ? undefined : signature;
};

export const hasEmailSignature = (
  body: EmailSignatureBody,
  signature: EmailSignatureBody
): boolean =>
  signature.html.length > 0 &&
  signature.text.length > 0 &&
  body.html.trimEnd().endsWith(signature.html) &&
  body.text.trimEnd().endsWith(signature.text);

export const removeEmailSignature = (
  body: EmailSignatureBody,
  signature: EmailSignatureBody
): EmailSignatureBody => {
  if (!hasEmailSignature(body, signature)) {
    return body;
  }

  const htmlPrefix = body.html.trimEnd().slice(0, -signature.html.length);
  const htmlWithoutSignature = (
    htmlPrefix.endsWith("<p></p>")
      ? htmlPrefix.slice(0, -"<p></p>".length)
      : htmlPrefix
  ).trimEnd();
  const textWithoutSignature = body.text
    .trimEnd()
    .slice(0, -signature.text.length)
    .trimEnd();

  return { html: htmlWithoutSignature, text: textWithoutSignature };
};

export const appendEmailSignatureBody = (
  body: EmailSignatureBody,
  signature: EmailSignatureBody
): EmailSignatureBody => {
  const html = body.html.trimEnd();
  const text = body.text.trimEnd();

  return {
    html:
      html.length === 0
        ? `<p></p>${signature.html}`
        : `${html}<p></p>${signature.html}`,
    text: text.length === 0 ? signature.text : `${text}\n\n${signature.text}`,
  };
};

export const appendEmailSignatureHtml = (
  html: string,
  signature: EmailSignatureBody
): string => appendEmailSignatureBody({ html, text: "" }, signature).html;
