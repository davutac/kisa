import { MAX_SCHEDULED_MAIL_PREVIEW_LENGTH } from "../../shared/ipc/scheduled-mail";

const TRAILING_HIGH_SURROGATE = /[\uD800-\uDBFF]$/u;

export const truncateScheduledMailPreview = (value: string): string => {
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  const truncated = normalized.slice(0, MAX_SCHEDULED_MAIL_PREVIEW_LENGTH);
  return TRAILING_HIGH_SURROGATE.test(truncated)
    ? truncated.slice(0, -1)
    : truncated;
};
