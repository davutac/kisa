import { truncateGmailSubject } from "@/shared/gmail-subject";

export interface CleanDraftVersion {
  body: string;
  id: string;
  label: string;
  status: "loading" | "ready";
  subject: string;
}

interface DraftVersionContent {
  body: string;
  subject: string;
}

interface CleanDraftDismissal {
  history: readonly CleanDraftVersion[];
  selectedVersion: CleanDraftVersion | null;
}

interface CleanDraftHistoryChange {
  history: readonly CleanDraftVersion[];
  version: CleanDraftVersion;
}

const getNextCleanNumber = (history: readonly CleanDraftVersion[]): number => {
  let highest = 0;
  for (const { id } of history) {
    const number = /^clean-(?<number>\d+)(?:-|$)/u.exec(id)?.groups?.number;
    if (number !== undefined) {
      highest = Math.max(highest, Number(number));
    }
  }
  return highest + 1;
};

const createOriginalVersion = (
  original: DraftVersionContent
): CleanDraftVersion => ({
  body: original.body,
  id: "original",
  label: "Original",
  status: "ready",
  subject: original.subject,
});

export const appendPendingCleanDraftVersion = (
  history: readonly CleanDraftVersion[],
  original: DraftVersionContent
): CleanDraftHistoryChange => {
  const cleanNumber = getNextCleanNumber(history);
  const version: CleanDraftVersion = {
    body: original.body,
    id: `clean-${cleanNumber}-${crypto.randomUUID()}`,
    label: `#${cleanNumber} Clean`,
    status: "loading",
    subject: original.subject,
  };

  return {
    history:
      history.length === 0
        ? [createOriginalVersion(original), version]
        : [...history, version],
    version,
  };
};

export const completePendingCleanDraftVersion = (
  history: readonly CleanDraftVersion[],
  versionId: string,
  cleaned: DraftVersionContent
): CleanDraftHistoryChange | undefined => {
  const pending = history.find(
    ({ id, status }) => id === versionId && status === "loading"
  );
  if (pending === undefined) {
    return undefined;
  }
  const version: CleanDraftVersion = {
    ...pending,
    body: cleaned.body,
    status: "ready",
    subject: truncateGmailSubject(cleaned.subject),
  };
  return {
    history: history.map((current) =>
      current.id === versionId ? version : current
    ),
    version,
  };
};

export const dismissCleanDraftVersion = (
  history: readonly CleanDraftVersion[],
  dismissedVersionId: string,
  selectedVersionId: string | null
): CleanDraftDismissal => {
  const dismissedIndex = history.findIndex(
    ({ id }) => id === dismissedVersionId
  );
  if (dismissedIndex < 1) {
    return {
      history,
      selectedVersion:
        history.find(({ id }) => id === selectedVersionId) ?? null,
    };
  }

  const nextHistory = history.filter(({ id }) => id !== dismissedVersionId);
  let precedingReadyVersion: CleanDraftVersion | null = null;
  for (let index = dismissedIndex - 1; index >= 0; index -= 1) {
    const candidate = nextHistory[index];
    if (candidate?.status === "ready") {
      precedingReadyVersion = candidate;
      break;
    }
  }
  const selectedVersion =
    dismissedVersionId === selectedVersionId
      ? precedingReadyVersion
      : (nextHistory.find(({ id }) => id === selectedVersionId) ?? null);

  return { history: nextHistory, selectedVersion };
};
