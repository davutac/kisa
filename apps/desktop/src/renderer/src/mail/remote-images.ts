// Remote images are the tracking pixels of email: loading one tells the sender
// the message was opened, and from which IP. The frame's Content-Security-Policy
// is what actually keeps them out, but a blocked request still leaves a torn
// image icon behind, so the markup is stripped as well.

export interface RemoteImageScan {
  readonly hasRemoteImages: boolean;
  readonly html: string;
}

// These patterns run over sender-controlled HTML on the renderer thread, so
// each has to stay linear in the length of the message. Neighbouring parts of
// a pattern may not claim the same characters: when they can, every way of
// splitting a long run between them is tried, and a few kilobytes of `<a<a<a`
// hold the window for minutes. The attributes therefore start where the tag
// name ends, and a `url()` value has one shape per kind of quoting.
const TAG_PATTERN = /<(?<tag>[a-z][^\s/>]*)(?<attributes>(?:[\s/][^>]*)?)>/giu;
const ATTRIBUTE_PATTERN =
  /\s(?<name>[\w:-]+)\s*=\s*(?<value>"[^"]*"|'[^']*'|[^\s"'`<=>]+)/giu;
const CSS_URL_PATTERN =
  /url\(\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'()]+))\s*\)/giu;
const REMOTE_URL_PATTERN = /^(?:https?:)?\/\//iu;
const IMAGE_TAG_PATTERN = /^(?:image|img|input|picture|source|video)$/iu;

const unquote = (value: string): string =>
  value.startsWith('"') || value.startsWith("'") ? value.slice(1, -1) : value;

const isRemoteUrl = (value: string): boolean =>
  REMOTE_URL_PATTERN.test(value.trim());

// A source set lists several candidates for the same picture, so one remote
// candidate is enough to make the whole attribute unsafe.
const isRemoteSourceSet = (value: string): boolean =>
  value.split(",").some((candidate) => isRemoteUrl(candidate));

const isRemoteImageAttribute = (
  tag: string,
  name: string,
  value: string
): boolean => {
  const url = unquote(value);
  const attribute = name.toLowerCase();

  if (attribute === "background") {
    return isRemoteUrl(url);
  }

  if (!IMAGE_TAG_PATTERN.test(tag)) {
    return false;
  }

  if (attribute === "srcset") {
    return isRemoteSourceSet(url);
  }

  return (attribute === "poster" || attribute === "src") && isRemoteUrl(url);
};

/**
 * Removes every remote image reference from an email body and reports whether
 * there was anything to remove.
 */
export const blockRemoteImages = (html: string): RemoteImageScan => {
  let hasRemoteImages = false;
  // A tag ends at a `>`, so nothing after the last one can be a tag. Scanning
  // that tail anyway would read it to the end once for every `<` in it.
  const markupEnd = html.lastIndexOf(">") + 1;
  const markup = html
    .slice(0, markupEnd)
    .replaceAll(TAG_PATTERN, (tag, name: string, attributes: string) => {
      const keptAttributes = attributes.replaceAll(
        ATTRIBUTE_PATTERN,
        (attribute, attributeName: string, value: string) => {
          if (!isRemoteImageAttribute(name, attributeName, value)) {
            return attribute;
          }

          hasRemoteImages = true;
          return "";
        }
      );

      return keptAttributes === attributes ? tag : `<${name}${keptAttributes}>`;
    });
  const withoutRemoteAttributes = markup + html.slice(markupEnd);
  // Covers both `style` attributes and `<style>` blocks, which reach remote
  // images through `background-image` rather than through an attribute.
  const withoutRemoteStyleUrls = withoutRemoteAttributes.replaceAll(
    CSS_URL_PATTERN,
    (
      declaration,
      double: string | undefined,
      single: string | undefined,
      bare: string | undefined
    ) => {
      const url = double ?? single ?? bare ?? "";

      if (!isRemoteUrl(url)) {
        return declaration;
      }

      hasRemoteImages = true;
      return "url(about:blank)";
    }
  );

  return { hasRemoteImages, html: withoutRemoteStyleUrls };
};

export const containsRemoteImages = (html?: string): boolean =>
  html !== undefined && blockRemoteImages(html).hasRemoteImages;
