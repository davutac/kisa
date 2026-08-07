// Remote images are the tracking pixels of email: loading one tells the sender
// the message was opened, and from which IP. The frame's Content-Security-Policy
// is what actually keeps them out, but a blocked request still leaves a torn
// image icon behind, so the markup is stripped as well.

export interface RemoteImageScan {
  readonly hasRemoteImages: boolean;
  readonly html: string;
}

const TAG_PATTERN = /<(?<tag>[a-z][^\s/>]*)(?<attributes>[^>]*)>/giu;
const ATTRIBUTE_PATTERN =
  /\s(?<name>[\w:-]+)\s*=\s*(?<value>"[^"]*"|'[^']*'|[^\s"'`<=>]+)/giu;
const CSS_URL_PATTERN =
  /url\(\s*(?<quote>["']?)(?<url>[^"')]*)\k<quote>\s*\)/giu;
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
  const withoutRemoteAttributes = html.replaceAll(
    TAG_PATTERN,
    (tag, name: string, attributes: string) => {
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
    }
  );
  // Covers both `style` attributes and `<style>` blocks, which reach remote
  // images through `background-image` rather than through an attribute.
  const withoutRemoteStyleUrls = withoutRemoteAttributes.replaceAll(
    CSS_URL_PATTERN,
    (declaration, _quote: string, url: string) => {
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
