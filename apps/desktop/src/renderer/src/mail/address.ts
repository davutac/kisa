const EMAIL_ADDRESS_PATTERN =
  /[\w.!#$%&'*+/=?^`{|}~-]+@[\dA-Za-z](?:[\dA-Za-z-]{0,61}[\dA-Za-z])?(?:\.[\dA-Za-z](?:[\dA-Za-z-]{0,61}[\dA-Za-z])?)*/gu;

export const extractEmailAddresses = (header?: string): readonly string[] =>
  header?.match(EMAIL_ADDRESS_PATTERN) ?? [];

export const parseEmailAddressList = (value: string): readonly string[] => {
  const tokens = value
    .split(/[,;\n]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const addresses = tokens.map((token) => extractEmailAddresses(token));

  return addresses.every((matches) => matches.length === 1)
    ? addresses.flat()
    : [];
};

export const mergeUniqueEmailAddresses = (
  current: readonly string[],
  additions: readonly string[]
): readonly string[] => {
  const seen = new Set(current.map((address) => address.toLowerCase()));
  const uniqueAdditions = additions.filter((address) => {
    const normalizedAddress = address.toLowerCase();

    if (seen.has(normalizedAddress)) {
      return false;
    }

    seen.add(normalizedAddress);
    return true;
  });

  return [...current, ...uniqueAdditions];
};

export interface MailboxAddress {
  email: string;
  name?: string;
}

export const parseMailboxAddress = (header: string): MailboxAddress => {
  const [email] = extractEmailAddresses(header);

  if (email === undefined) {
    return { email: header };
  }

  const angleBracketIndex = header.indexOf("<");
  const rawName =
    angleBracketIndex === -1 ? "" : header.slice(0, angleBracketIndex).trim();
  const name = rawName.replaceAll(/^"|"$/gu, "").trim();

  return name.length === 0 ? { email } : { email, name };
};
