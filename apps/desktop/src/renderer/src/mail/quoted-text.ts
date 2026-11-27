// Finds the earlier messages quoted at the end of a message body, so the
// conversation can show each as a message of its own. Nothing but `>` marks a
// quote in a standard way (RFC 3676), so the start of one is recognized by the
// lines clients write above it: an attribution ("On …, Jonas wrote:"), an
// Outlook header block, or an "Original Message" separator.
// docs/research/2026-11-27-quoted-replies.md records where each comes from.
//
// Every pattern tests one line of bounded length and holds only bounded
// repeats with a literal between them, so a hostile message cannot make a
// match run longer than linear time.

import { extractEmailAddresses } from "@/mail/address";

/** Past this many lines a body is shown whole rather than scanned. */
export const MAX_QUOTE_SCAN_LINES = 5000;

/** A longer line is ordinary text, never a header. */
const MAX_HEADER_LINE_LENGTH = 400;

/** How many messages deep a chain of quotes is unpacked. */
export const MAX_QUOTE_DEPTH = 12;

/** How far below an Outlook "From:" its "Sent:" line may sit. */
const OUTLOOK_FIELD_LOOKAHEAD = 4;

const ANY = ".{1,300}";
const OPTIONAL_ANY = `(?:\\s${ANY})?`;

// Attributions that open with a fixed word. Only these are looked for across
// two lines: one that may start anywhere would take the reply's last line
// into the quote.
const OPENING_ATTRIBUTION_PATTERNS: readonly RegExp[] = [
  // On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto <jonas@example.com> wrote:
  new RegExp(`^On\\s${ANY}\\swrote:$`, "iu"),
  // Am 26.11.2026 um 12:17 schrieb Jonas Aalto <jonas@example.com>:
  new RegExp(`^Am\\s${ANY}\\sschrieb${OPTIONAL_ANY}:$`, "iu"),
  // Le 26 nov. 2026 à 12:17, Jonas Aalto <jonas@example.com> a écrit :
  new RegExp(`^Le\\s${ANY}\\sa\\sécrit\\s?:$`, "iu"),
  // El 26 nov 2026, a las 12:17, Jonas Aalto escribió:
  new RegExp(`^El\\s${ANY}\\sescribió:$`, "iu"),
  // Em 26 de nov. de 2026, às 12:17, Jonas Aalto escreveu:
  new RegExp(`^(?:Em|Na)\\s${ANY}\\sescreveu:$`, "iu"),
  // Il giorno 26 nov 2026, alle ore 12:17, Jonas Aalto ha scritto:
  new RegExp(`^Il\\s${ANY}\\sha\\sscritto:$`, "iu"),
  // Op 26 nov 2026 om 12:17 heeft Jonas Aalto het volgende geschreven:
  new RegExp(`^Op\\s${ANY}\\s(?:schreef${OPTIONAL_ANY}|geschreven):$`, "iu"),
  // Den 26 nov. 2026 kl. 12:17 skrev Jonas Aalto <jonas@example.com>:
  new RegExp(`^(?:Den|På)\\s${ANY}\\sskrev${OPTIONAL_ANY}:$`, "iu"),
  // W dniu 26.11.2026 o 12:17, Jonas Aalto pisze:
  new RegExp(
    `^(?:W\\sdniu|Dnia)\\s${ANY}\\s(?:pisze|napisała?)${OPTIONAL_ANY}:$`,
    "iu"
  ),
  // 2026年11月26日(水) 12:17 Jonas Aalto <jonas@example.com>:
  new RegExp(`^\\d{4}年${ANY}>[:：]$`, "u"),
];

// Attributions that name the sender first, so they can start anywhere.
const FLOATING_ATTRIBUTION_PATTERNS: readonly RegExp[] = [
  // Jonas Aalto <jonas@example.com> wrote:
  new RegExp(`^[^@]{1,300}@${ANY}\\swrote:$`, "iu"),
  // Jonas Aalto <jonas@example.com> schrieb am 26.11.2026:
  new RegExp(`^[^@]{1,300}@${ANY}\\sschrieb${OPTIONAL_ANY}:$`, "iu"),
  // 26 Kas 2026 Çar, saat 12:17 tarihinde Jonas Aalto şunu yazdı:
  new RegExp(`^${ANY}\\sşunu\\syazdı:$`, "iu"),
  // 26.11.2026, 12:17, Jonas Aalto пишет:
  new RegExp(`^${ANY}\\s(?:пишет|написала?):$`, "iu"),
  // Jonas Aalto <jonas@example.com> 于2026年11月26日周三 12:17写道：
  new RegExp(`^${ANY}(?:のメッセージ|写道|寫道)[:：]$`, "u"),
  // 2026년 11월 26일 (수) 오후 12:17, Jonas Aalto <jonas@example.com>님이 작성:
  new RegExp(`^${ANY}\\s?작성:$`, "u"),
];

const ORIGINAL_MESSAGE_PATTERN =
  /^-{2,}\s?(?:Original Message|Ursprüngliche Nachricht|Message d'origine|Mensaje original|Messaggio originale|Mensagem original|Oorspronkelijk bericht|Originalmeddelande|Oprindelig meddelelse|Opprinnelig melding|Orijinal Mesaj|Исходное сообщение|原始邮件)\s?-{2,}$/iu;

const FORWARD_SEPARATOR_SOURCE =
  "-{2,}\\s?(?:Forwarded message|Weitergeleitete Nachricht|Message transféré|Mensaje reenviado|Messaggio inoltrato|Mensagem encaminhada|Doorgestuurd bericht|Vidarebefordrat meddelande|Videresendt meddelelse|Videresendt melding|İletilen Mesaj|Пересылаемое сообщение|转发的邮件)\\s?-{2,}|Begin forwarded message:|Anfang der weitergeleiteten Nachricht:|Début du message réexpédié\\s?:";

const FORWARD_SEPARATOR_PATTERN = new RegExp(
  `^(?:${FORWARD_SEPARATOR_SOURCE})$`,
  "iu"
);

/** A forward separator anywhere in a run of text, as a frame's text has it. */
export const FORWARD_SEPARATOR_IN_TEXT = new RegExp(
  FORWARD_SEPARATOR_SOURCE,
  "iu"
);

// Outlook's header block. A "From:" alone is ordinary prose, so it counts only
// with a sent-date field a few lines below it.
const OUTLOOK_FROM_PATTERN =
  /^\*?(?:From|Von|De|Da|Van|Från|Fra|Od|Kimden|От|Lähettäjä|发件人|寄件者|差出人|보낸 사람)\s?\*?\s?[:：]\s?.{1,300}$/iu;

const OUTLOOK_SENT_PATTERN =
  /^\*?(?:Sent|Date|Gesendet|Datum|Envoyé|Enviado|Fecha|Inviato|Data|Verzonden|Skickat|Sendt|Gönderildi|Tarih|Отправлено|Дата|Lähetetty|发送时间|寄件日期|送信日時|보낸 날짜)\s?\*?\s?[:：]\s?.{1,300}$/iu;

/** The rule Outlook's plain text draws above its header block. */
const OUTLOOK_RULE_PATTERN = /^_{10,}$/u;

const QUOTED_LINE_PATTERN = /^>/u;

/** A forward's subject; only the first prefix counts, so "Re: Fwd:" is a reply. */
const FORWARD_SUBJECT_PATTERN =
  /^\s*(?:\[[^\]]{0,100}\]\s*)?(?:Fwd?|WG|TR|RV|ENC|VS|Doorst|PD|İlt|Пересл)\s?:/iu;

export const isForwardSubject = (subject: string): boolean =>
  FORWARD_SUBJECT_PATTERN.test(subject);

const asHeaderCandidate = (line: string): string | undefined => {
  const trimmed = line.trim();

  return trimmed.length === 0 || trimmed.length > MAX_HEADER_LINE_LENGTH
    ? undefined
    : trimmed;
};

const matchesAny = (patterns: readonly RegExp[], text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));

/** Whether a line opens a quote by itself: an attribution or a separator. */
export const isQuoteHeaderLine = (line: string): boolean => {
  const candidate = asHeaderCandidate(line);

  return (
    candidate !== undefined &&
    (ORIGINAL_MESSAGE_PATTERN.test(candidate) ||
      matchesAny(OPENING_ATTRIBUTION_PATTERNS, candidate) ||
      matchesAny(FLOATING_ATTRIBUTION_PATTERNS, candidate))
  );
};

const SENTENCE_END_PATTERN = /[.!?]$/u;

/**
 * Whether two lines are one attribution that a client wrapped. A line that
 * ends a sentence is the reply's own, even when it opens with "On".
 */
const isWrappedAttribution = (line: string, next: string): boolean => {
  const first = line.trim();
  const candidate = asHeaderCandidate(`${first} ${next.trim()}`);

  return (
    candidate !== undefined &&
    !SENTENCE_END_PATTERN.test(first) &&
    matchesAny(OPENING_ATTRIBUTION_PATTERNS, candidate)
  );
};

/** Whether a line is an "Original Message" rule, which fields follow. */
export const isOriginalMessageLine = (line: string): boolean => {
  const candidate = asHeaderCandidate(line);

  return candidate !== undefined && ORIGINAL_MESSAGE_PATTERN.test(candidate);
};

/**
 * How many of the first lines are an attribution: one, two when a client
 * wrapped it, or none.
 */
export const attributionLineCount = (lines: readonly string[]): number => {
  const [first = "", second] = lines;

  if (isOriginalMessageLine(first)) {
    return 0;
  }

  if (isQuoteHeaderLine(first)) {
    return 1;
  }

  return second !== undefined && isWrappedAttribution(first, second) ? 2 : 0;
};

export const isOutlookFromLine = (line: string): boolean => {
  const candidate = asHeaderCandidate(line);

  return candidate !== undefined && OUTLOOK_FROM_PATTERN.test(candidate);
};

const isForwardSeparatorLine = (line: string): boolean => {
  const candidate = asHeaderCandidate(line);

  return candidate !== undefined && FORWARD_SEPARATOR_PATTERN.test(candidate);
};

const isBlank = (line: string): boolean => line.trim().length === 0;

const isQuoted = (line: string): boolean =>
  QUOTED_LINE_PATTERN.test(line.trimStart());

const isOutlookHeaderAt = (
  lines: readonly string[],
  index: number
): boolean => {
  if (!isOutlookFromLine(lines[index] ?? "")) {
    return false;
  }

  const end = Math.min(lines.length, index + 1 + OUTLOOK_FIELD_LOOKAHEAD);

  for (let next = index + 1; next < end; next += 1) {
    const candidate = asHeaderCandidate(lines[next] ?? "");

    if (candidate !== undefined && OUTLOOK_SENT_PATTERN.test(candidate)) {
      return true;
    }
  }

  return false;
};

interface QuoteHeader {
  /** The first line of the quote, the header or a rule drawn above it. */
  readonly start: number;
  /** The first line after the header. */
  readonly end: number;
}

const previousNonBlank = (
  lines: readonly string[],
  index: number
): number | undefined => {
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    if (!isBlank(lines[previous] ?? "")) {
      return previous;
    }
  }

  return undefined;
};

const findFirstHeader = (
  lines: readonly string[],
  from: number
): QuoteHeader | undefined => {
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (isQuoted(line) || isBlank(line)) {
      continue;
    }

    if (isQuoteHeaderLine(line)) {
      return { end: index + 1, start: index };
    }

    // A client that wraps at 76 characters can split the attribution after
    // the sender's name.
    const next = lines[index + 1];

    if (
      next !== undefined &&
      !isBlank(next) &&
      !isQuoted(next) &&
      isWrappedAttribution(line, next)
    ) {
      return { end: index + 2, start: index };
    }

    if (isOutlookHeaderAt(lines, index)) {
      const rule = previousNonBlank(lines, index);

      return {
        end: index + 1,
        start:
          rule !== undefined &&
          OUTLOOK_RULE_PATTERN.test(lines[rule]?.trim() ?? "")
            ? rule
            : index,
      };
    }
  }

  return undefined;
};

const hasTextBefore = (lines: readonly string[], end: number): boolean =>
  lines.slice(0, end).some((line) => !isBlank(line) && !isQuoted(line));

/**
 * Where a quote under a header ends the body: the header's line, or
 * undefined when the reply carries on between the quoted lines.
 */
const headerQuoteStart = (
  lines: readonly string[],
  header: QuoteHeader
): number | undefined => {
  const rest = lines.slice(header.end);
  const firstLine = rest.find((line) => !isBlank(line));

  // Under Outlook's block the original follows as plain text, so everything
  // after the header is quoted. Under an attribution the quote is `>` lines,
  // and an unquoted line among them is the reply answering inline.
  if (
    firstLine !== undefined &&
    isQuoted(firstLine) &&
    rest.some((line) => !isBlank(line) && !isQuoted(line))
  ) {
    return undefined;
  }

  return header.start;
};

interface QuoteSpan {
  /** The first line of the quote: its header, or its first quoted line. */
  readonly start: number;
  /** The first line of what the quoted message itself said. */
  readonly contentStart: number;
}

/**
 * A run of `>` lines that ends the body, with no header the patterns know.
 * A short line ending in a colon right above it is taken as its attribution.
 */
const trailingQuoteSpan = (lines: readonly string[]): QuoteSpan | undefined => {
  let last = lines.length - 1;

  while (last >= 0 && isBlank(lines[last] ?? "")) {
    last -= 1;
  }

  if (last < 0 || !isQuoted(lines[last] ?? "")) {
    return undefined;
  }

  let contentStart = last;

  for (let previous = last - 1; previous >= 0; previous -= 1) {
    const line = lines[previous] ?? "";

    if (isQuoted(line)) {
      contentStart = previous;
    } else if (!isBlank(line)) {
      break;
    }
  }

  const above = previousNonBlank(lines, contentStart);
  const attribution = above === undefined ? undefined : lines[above]?.trim();

  return {
    contentStart,
    start:
      above !== undefined &&
      attribution !== undefined &&
      attribution.length <= MAX_HEADER_LINE_LENGTH &&
      attribution.endsWith(":")
        ? above
        : contentStart,
  };
};

/**
 * The header that opens the trailing quote. A header with nothing above it
 * is the text's own, as when the text is itself a quoted message, so the one
 * after it is looked for.
 */
const findQuoteHeader = (lines: readonly string[]): QuoteHeader | undefined => {
  let header = findFirstHeader(lines, 0);

  while (header !== undefined && !hasTextBefore(lines, header.start)) {
    header = findFirstHeader(lines, header.end);
  }

  return header;
};

const findQuoteSpan = (lines: readonly string[]): QuoteSpan | undefined => {
  if (lines.length > MAX_QUOTE_SCAN_LINES) {
    return undefined;
  }

  const forward = lines.findIndex(isForwardSeparatorLine);

  // A forwarded message is the point of the message, not a copy of one
  // already in the conversation. A forward inside the quote is only history.
  const isBeforeForward = (start: number): boolean =>
    forward === -1 || forward > start;

  const header = findQuoteHeader(lines);

  if (header !== undefined) {
    const start = headerQuoteStart(lines, header);

    if (start !== undefined && isBeforeForward(start)) {
      return { contentStart: header.end, start };
    }
  }

  const span = trailingQuoteSpan(lines);

  return span !== undefined &&
    hasTextBefore(lines, span.start) &&
    isBeforeForward(span.start)
    ? span
    : undefined;
};

/**
 * The index of the line where the quoted earlier messages at the end of a
 * body begin, or null when there are none to set apart: the body quotes
 * nothing, is nothing but quote, forwards a message, or answers inline.
 */
export const findQuotedTextStart = (lines: readonly string[]): number | null =>
  findQuoteSpan(lines)?.start ?? null;

const QUOTE_MARK_PATTERN = /^\s*>\s?/u;

const withoutQuoteMark = (line: string): string =>
  line.replace(QUOTE_MARK_PATTERN, "");

export interface QuotedText {
  readonly sender: QuoteSender;
  /** What the quoted message said, without its header or quote marks. */
  readonly text: string;
}

/** How many fields of an Outlook header block are passed over. */
export const MAX_HEADER_FIELDS = 8;

// A field needs a value, so a greeting that ends in a colon is not one.
const HEADER_FIELD_PATTERN = /^\*?[^:：]{1,40}[:：]\*?\s*\S/u;

/** Whether a line could be a field of an Outlook header: "Sent: Monday". */
export const isHeaderFieldLine = (line: string): boolean => {
  const candidate = asHeaderCandidate(line);

  return candidate !== undefined && HEADER_FIELD_PATTERN.test(candidate);
};

const FIELD_NAME_PATTERN = /^[^:：]{1,40}[:：]/u;
const LEADING_BLANK_LINES_PATTERN = /^(?:[ \t\r]*\n)+/u;

/**
 * What follows an Outlook header's From line without the block's other
 * fields: Sent, To, Subject and the like.
 */
const withoutHeaderFields = (
  header: readonly string[],
  rest: readonly string[]
): readonly string[] => {
  if (
    !header.some(
      (line) =>
        isOutlookFromLine(line) || ORIGINAL_MESSAGE_PATTERN.test(line.trim())
    )
  ) {
    return rest;
  }

  let fields = 0;

  while (
    fields < Math.min(rest.length, MAX_HEADER_FIELDS) &&
    isHeaderFieldLine(rest[fields] ?? "")
  ) {
    fields += 1;
  }

  return rest.slice(fields);
};

/**
 * The messages quoted from a span on, nearest first. Each is what that
 * message said: its header and one level of `>` removed, and without the
 * older messages it quoted in turn.
 */
const unpackQuotes = (
  lines: readonly string[],
  span: QuoteSpan,
  depth: number
): readonly QuotedText[] => {
  const header = lines.slice(span.start, span.contentStart);
  const rest = lines.slice(span.contentStart);
  const firstLine = rest.find((line) => !isBlank(line));

  const content =
    firstLine !== undefined && isQuoted(firstLine)
      ? rest.map(withoutQuoteMark)
      : withoutHeaderFields(header, rest);

  const older = depth < MAX_QUOTE_DEPTH ? findQuoteSpan(content) : undefined;
  const own = older === undefined ? content : content.slice(0, older.start);

  const quote = {
    sender: parseQuoteSender(lines.slice(span.start)),
    text: own.join("\n").replace(LEADING_BLANK_LINES_PATTERN, "").trimEnd(),
  };

  return older === undefined
    ? [quote]
    : [quote, ...unpackQuotes(content, older, depth + 1)];
};

export interface QuotedTextChain {
  /** The message's own text, without the blank lines that ended it. */
  readonly reply: string;
  /** Each earlier message it quotes, nearest first. */
  readonly quotes: readonly QuotedText[];
}

/** A plain-text body and the chain of messages quoted at its end, if any. */
export const splitQuotedTextChain = (text: string): QuotedTextChain | null => {
  const lines = text.split("\n");
  const span = findQuoteSpan(lines);

  return span === undefined
    ? null
    : {
        quotes: unpackQuotes(lines, span, 1),
        reply: lines.slice(0, span.start).join("\n").trimEnd(),
      };
};

export interface QuoteSender {
  readonly email: string | undefined;
  readonly name: string | undefined;
  /**
   * The quote's header in its own words: its attribution line, or the From
   * and Sent fields of an Outlook header.
   */
  readonly attribution: string | undefined;
}

/** How many lines of a quote its header is looked for in. */
export const QUOTE_HEADER_LINES = 6;

/** Words that sit between a date and a name without being part of either. */
const NOT_A_NAME = new Set(["AM", "PM", "UHR", "GMT", "UTC", "CET", "CEST"]);

/** Parts of a family name that are written in lower case. */
const NAME_PARTICLES = new Set([
  "al",
  "bin",
  "da",
  "de",
  "del",
  "den",
  "der",
  "di",
  "du",
  "la",
  "le",
  "ten",
  "ter",
  "van",
  "von",
]);

const NAME_WORD_PATTERN = /^\p{Lu}[\p{L}\p{M}.'’-]*$/u;
const NAME_PUNCTUATION_PATTERN = /^[<("'[*]+|[>)"'\],:;*]+$/gu;

/** Nothing, or a word in lower case. */
const FOLLOWS_NAME_PATTERN = /^(?:\p{Ll}[\p{L}\p{M}]*)?$/u;

const MAX_NAME_WORDS = 4;

const isNameWord = (word: string): boolean =>
  NAME_WORD_PATTERN.test(word) && !NOT_A_NAME.has(word.toUpperCase());

/**
 * The name a run of text ends with: its last capitalized words, as in
 * "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto". A guess, for a label.
 */
const trailingName = (text: string): string | undefined => {
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  const name: string[] = [];
  let index = words.length - 1;

  // What follows the name is not part of it: "wrote", "a écrit", a bracket.
  // Only such words are passed over, so a date is never read as a name.
  while (
    index >= 0 &&
    FOLLOWS_NAME_PATTERN.test(
      (words[index] ?? "").replaceAll(NAME_PUNCTUATION_PATTERN, "")
    )
  ) {
    index -= 1;
  }

  for (; index >= 0 && name.length < MAX_NAME_WORDS; index -= 1) {
    const raw = words[index] ?? "";
    const word = raw.replaceAll(NAME_PUNCTUATION_PATTERN, "");
    const isParticle = name.length > 0 && NAME_PARTICLES.has(word);

    // A comma before the name ends what came before it, such as a weekday.
    if (
      (!isNameWord(word) && !isParticle) ||
      (name.length > 0 && raw.endsWith(","))
    ) {
      break;
    }

    name.unshift(word);
  }

  while (name[0] !== undefined && NAME_PARTICLES.has(name[0])) {
    name.shift();
  }

  return name.length === 0 ? undefined : name.join(" ");
};

const senderFromField = (
  from: string,
  sent: string | undefined
): QuoteSender => {
  const value = from.replace(FIELD_NAME_PATTERN, "").trim();
  const [email] = extractEmailAddresses(value);

  const name = value
    .slice(0, email === undefined ? undefined : value.indexOf(email))
    .replaceAll(/\[mailto:$|[<"'*[\]]/gu, "")
    .trim();

  return {
    attribution: sent === undefined ? from : `${from} · ${sent}`,
    email,
    name: name.length === 0 || name.includes("@") ? undefined : name,
  };
};

const senderFromAttribution = (line: string): QuoteSender => {
  const [email] = extractEmailAddresses(line);

  return {
    // A quote that opens with no header has only its first quoted line here.
    attribution:
      isQuoteHeaderLine(line) || line.endsWith(":") ? line : undefined,
    email,
    name: trailingName(
      email === undefined ? line : line.slice(0, line.indexOf(email))
    ),
  };
};

/**
 * Who a quoted message is from, as far as its first lines say: the address
 * and name in its attribution, or in the From field of an Outlook header.
 */
export const parseQuoteSender = (lines: readonly string[]): QuoteSender => {
  const head = lines
    .slice(0, QUOTE_HEADER_LINES * 2)
    .filter((line) => !isBlank(line))
    .slice(0, QUOTE_HEADER_LINES)
    .map((line) => line.trim());

  const [first = "", second = ""] = head;
  const from = head.find(isOutlookFromLine);

  // Under a rule or a separator the sender is in the From field. An
  // attribution names its sender itself, wrapped onto a second line or not.
  if (
    from !== undefined &&
    (from === first ||
      OUTLOOK_RULE_PATTERN.test(first) ||
      ORIGINAL_MESSAGE_PATTERN.test(first))
  ) {
    return senderFromField(
      from,
      head.find((line) => OUTLOOK_SENT_PATTERN.test(line))
    );
  }

  return senderFromAttribution(
    isWrappedAttribution(first, second) ? `${first} ${second}` : first
  );
};
