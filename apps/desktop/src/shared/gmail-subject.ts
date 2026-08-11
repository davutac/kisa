/** Gmail's documented maximum for the Subject header value. */
export const MAX_GMAIL_SUBJECT_LENGTH = 998;

export const truncateGmailSubject = (subject: string): string =>
  subject.slice(0, MAX_GMAIL_SUBJECT_LENGTH);
