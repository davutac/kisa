/**
 * A message's MIME tree as an IMAP `BODYSTRUCTURE` describes it. This is the
 * structural subset of what an IMAP client parses; part numbers follow IMAP's
 * dotted sections, and the root of a multipart message has none.
 */
export interface BodyStructureNode {
  readonly childNodes?: readonly BodyStructureNode[] | undefined;
  readonly disposition?: string | undefined;
  readonly dispositionParameters?: Readonly<Record<string, string>> | undefined;
  readonly encoding?: string | undefined;
  readonly id?: string | undefined;
  readonly parameters?: Readonly<Record<string, string>> | undefined;
  readonly part?: string | undefined;
  readonly size?: number | undefined;
  readonly type: string;
}

/**
 * - `container`: a multipart node.
 * - `body`: a text part shown as the message, fetched with the metadata.
 * - `alternative`: a plain-text rendition left on the server because an HTML
 *   sibling says the same thing; the HTML is what gets shown and indexed.
 * - `attachment`: everything else, fetched only when the user opens it.
 */
export type MessagePartKind =
  | "alternative"
  | "attachment"
  | "body"
  | "container";

export interface MessagePart {
  readonly charset?: string | undefined;
  readonly contentId?: string | undefined;
  readonly disposition?: "attachment" | "inline" | undefined;
  readonly encoding?: string | undefined;
  readonly filename: string;
  readonly kind: MessagePartKind;
  readonly mimeType: string;
  readonly parts?: readonly MessagePart[] | undefined;
  /** The IMAP section to fetch, empty for a multipart root. */
  readonly section: string;
  readonly size: number;
}

export interface MessageStructure {
  readonly attachments: readonly MessagePart[];
  readonly bodies: readonly MessagePart[];
  readonly root: MessagePart;
  /** Some of the tree was beyond a limit and was left out or not fetched. */
  readonly truncated: boolean;
}

export interface MimeLimits {
  readonly maxDepth: number;
  readonly maxFilenameLength: number;
  readonly maxParts: number;
  readonly maxTextBytes: number;
  readonly maxTextPartBytes: number;
}

export const DEFAULT_MIME_LIMITS: MimeLimits = {
  maxDepth: 16,
  maxFilenameLength: 255,
  maxParts: 500,
  maxTextBytes: 8 * 1024 * 1024,
  maxTextPartBytes: 5 * 1024 * 1024,
};

const TEXT_BODY_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "text/plain",
]);

const normalizeType = (type: string): string => {
  const normalized = type.trim().toLowerCase();
  return normalized.includes("/") ? normalized : "application/octet-stream";
};

const isControlCharacter = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
};

const cleanFilename = (value: string | undefined, maxLength: number): string =>
  [...(value ?? "")]
    .filter((character) => !isControlCharacter(character))
    .join("")
    .trim()
    .slice(0, maxLength);

const cleanContentId = (value: string | undefined): string | undefined => {
  const cleaned = value?.trim().replaceAll(/^<|>$/gu, "");
  return cleaned === undefined || cleaned.length === 0 ? undefined : cleaned;
};

const toDisposition = (
  value: string | undefined
): MessagePart["disposition"] => {
  const disposition = value?.trim().toLowerCase();
  return disposition === "attachment" || disposition === "inline"
    ? disposition
    : undefined;
};

/**
 * In `multipart/alternative`, the HTML rendition is what Kisa shows and what
 * search indexes (as flattened text), so a plain-text sibling would only cost
 * bandwidth. It is kept in the tree but not fetched.
 */
const preferHtmlAlternative = (
  mimeType: string,
  parts: readonly MessagePart[]
): readonly MessagePart[] => {
  if (
    mimeType !== "multipart/alternative" ||
    !parts.some((part) => part.kind === "body" && part.mimeType === "text/html")
  ) {
    return parts;
  }

  return parts.map((part) =>
    part.kind === "body" && part.mimeType === "text/plain"
      ? { ...part, kind: "alternative" }
      : part
  );
};

const collectLeaves = (part: MessagePart): readonly MessagePart[] =>
  part.kind === "container"
    ? (part.parts ?? []).flatMap(collectLeaves)
    : [part];

/** What a walk has spent of the limits so far. */
interface PlanBudget {
  partCount: number;
  textBytes: number;
  truncated: boolean;
}

const planLeaf = (
  node: BodyStructureNode,
  mimeType: string,
  section: string,
  limits: MimeLimits,
  budget: PlanBudget
): MessagePart => {
  const filename = cleanFilename(
    node.dispositionParameters?.filename ?? node.parameters?.name,
    limits.maxFilenameLength
  );
  const disposition = toDisposition(node.disposition);
  const size = Math.max(0, Math.trunc(node.size ?? 0));
  const isTextCandidate =
    TEXT_BODY_TYPES.has(mimeType) &&
    filename.length === 0 &&
    disposition !== "attachment";
  const fits =
    isTextCandidate &&
    size <= limits.maxTextPartBytes &&
    budget.textBytes + size <= limits.maxTextBytes;

  if (fits) {
    budget.textBytes += size;
  } else if (isTextCandidate) {
    budget.truncated = true;
  }

  return {
    charset: node.parameters?.charset,
    contentId: cleanContentId(node.id),
    disposition,
    encoding: node.encoding?.trim().toLowerCase(),
    filename,
    kind: fits ? "body" : "attachment",
    mimeType,
    section,
    size,
  };
};

/**
 * Decides which parts are fetched as the message's text and which stay on the
 * server. Limits bound what a hostile structure can cost: past them a subtree
 * is dropped, and a text part that does not fit is offered as an attachment.
 */
export const planMessageStructure = (
  rootNode: BodyStructureNode,
  limits: MimeLimits = DEFAULT_MIME_LIMITS
): MessageStructure => {
  const budget: PlanBudget = { partCount: 0, textBytes: 0, truncated: false };

  const visit = (
    node: BodyStructureNode,
    depth: number,
    isRoot: boolean
  ): MessagePart | undefined => {
    if (budget.partCount >= limits.maxParts) {
      budget.truncated = true;
      return;
    }
    budget.partCount += 1;

    const mimeType = normalizeType(node.type);
    const isMultipart = mimeType.startsWith("multipart/");
    // A single-part message's only section is "1" (RFC 3501 section 6.4.5).
    const section = node.part ?? (isRoot && !isMultipart ? "1" : "");

    if (!isMultipart) {
      return planLeaf(node, mimeType, section, limits, budget);
    }

    if (depth >= limits.maxDepth) {
      budget.truncated = true;
      return { filename: "", kind: "container", mimeType, section, size: 0 };
    }

    const parts = (node.childNodes ?? []).flatMap((child) => {
      const visited = visit(child, depth + 1, false);
      return visited === undefined ? [] : [visited];
    });

    return {
      filename: "",
      kind: "container",
      mimeType,
      parts: preferHtmlAlternative(mimeType, parts),
      section,
      size: 0,
    };
  };

  const root = visit(rootNode, 0, true) ?? {
    filename: "",
    kind: "container",
    mimeType: "multipart/mixed",
    section: "",
    size: 0,
  };
  const leaves = collectLeaves(root);

  return {
    attachments: leaves.filter((part) => part.kind === "attachment"),
    bodies: leaves.filter((part) => part.kind === "body"),
    root,
    truncated: budget.truncated,
  };
};
