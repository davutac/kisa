/** Gmail's documented maximum for the Subject header value. */
export const MAX_SUBJECT_LENGTH = 998;

export const truncateSubject = (subject: string): string =>
  subject.slice(0, MAX_SUBJECT_LENGTH);
