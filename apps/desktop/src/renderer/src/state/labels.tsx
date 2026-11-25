import type { ReactNode } from "react";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { runWithCleanup } from "@/lib/run-with-cleanup";
import { sortLabelCatalog } from "@/mail/label";
import { getMailApi } from "@/platform/desktop";
import type {
  MailLabelCatalog,
  MailLabelColor,
  MailLabelSummary,
} from "@/shared/ipc/mail";

interface LabelCatalogState {
  readonly catalog: MailLabelCatalog;
  readonly colorsByName: ReadonlyMap<string, MailLabelColor>;
  readonly names: ReadonlySet<string>;
}

export type LabelCatalogLoadStatus = "loading" | "ready" | "unavailable";

interface LabelsContextValue {
  readonly catalogs: ReadonlyMap<string, LabelCatalogState>;
  readonly ensureLabels: (accountId: string, labels: readonly string[]) => void;
  readonly updateCatalog: (
    accountId: string,
    catalog: MailLabelCatalog
  ) => void;
  readonly upsertLabel: (accountId: string, label: MailLabelSummary) => void;
  readonly statuses: ReadonlyMap<string, LabelCatalogLoadStatus>;
}

const EMPTY_COLORS: ReadonlyMap<string, MailLabelColor> = new Map();
const LabelsContext = createContext<LabelsContextValue | undefined>(undefined);

const toLabelColors = (
  labels: readonly MailLabelSummary[]
): ReadonlyMap<string, MailLabelColor> =>
  new Map(
    labels.flatMap((label) =>
      label.color === undefined ? [] : [[label.name, label.color] as const]
    )
  );

const toLabelCatalogState = (catalog: MailLabelCatalog): LabelCatalogState => {
  const labels = sortLabelCatalog(catalog.labels);

  return {
    catalog: { ...catalog, labels },
    colorsByName: toLabelColors(labels),
    names: new Set(labels.map((label) => label.name)),
  };
};

const withLabelCatalog = (
  catalogs: ReadonlyMap<string, LabelCatalogState>,
  accountId: string,
  catalog: MailLabelCatalog
): ReadonlyMap<string, LabelCatalogState> => {
  const entry = [accountId, toLabelCatalogState(catalog)] as const;

  return new Map([...catalogs, entry]);
};

export const LabelsProvider = ({
  accountIds,
  children,
}: {
  accountIds: readonly string[];
  children: ReactNode;
}) => {
  const [catalogs, setCatalogs] = useState<
    ReadonlyMap<string, LabelCatalogState>
  >(new Map());

  const [statuses, setStatuses] = useState<
    ReadonlyMap<string, LabelCatalogLoadStatus>
  >(new Map());

  const attemptedLabels = useRef(new Set<string>());
  const loadsInFlight = useRef(new Map<string, Promise<void>>());

  const updateCatalog = useCallback(
    (accountId: string, catalog: MailLabelCatalog): void => {
      setCatalogs((current) => withLabelCatalog(current, accountId, catalog));
    },
    []
  );

  const upsertLabel = useCallback(
    (accountId: string, label: MailLabelSummary): void => {
      setCatalogs((current) => {
        const state = current.get(accountId);

        if (state === undefined) {
          return current;
        }

        const catalog = {
          ...state.catalog,
          labels: [
            ...state.catalog.labels.filter(
              (candidate) => candidate.id !== label.id
            ),
            label,
          ],
        };

        return withLabelCatalog(current, accountId, catalog);
      });
    },
    []
  );

  const loadCatalog = useCallback(
    (accountId: string): Promise<void> => {
      const active = loadsInFlight.current.get(accountId);

      if (active !== undefined) {
        return active;
      }

      const load = (async () => {
        setStatuses((current) => new Map(current).set(accountId, "loading"));
        await runWithCleanup(
          async () => {
            try {
              const reply = await getMailApi()?.listLabels({ accountId });

              if (reply?.ok === true) {
                updateCatalog(accountId, reply.data);
                setStatuses((current) =>
                  new Map(current).set(accountId, "ready")
                );
              } else {
                setStatuses((current) =>
                  new Map(current).set(accountId, "unavailable")
                );
              }
            } catch {
              // Labels are supplementary mailbox metadata; the sync action is the
              // visible retry when a cached catalog cannot be loaded.
              setStatuses((current) =>
                new Map(current).set(accountId, "unavailable")
              );
            }
          },
          () => {
            loadsInFlight.current.delete(accountId);
          }
        );
      })();

      loadsInFlight.current.set(accountId, load);

      return load;
    },
    [updateCatalog]
  );

  useEffect(() => {
    void Promise.all(accountIds.map(loadCatalog));
  }, [accountIds, loadCatalog]);

  useEffect(() => {
    const mailApi = getMailApi();

    if (mailApi === undefined) {
      return;
    }

    const connectedAccountIds = new Set(accountIds);

    return mailApi.onLabelCatalogChanged(({ accountId }) => {
      if (connectedAccountIds.has(accountId)) {
        void loadCatalog(accountId);
      }
    });
  }, [accountIds, loadCatalog]);

  const ensureLabels = useCallback(
    (accountId: string, labels: readonly string[]): void => {
      const knownNames = catalogs.get(accountId)?.names;

      const missing = labels.filter((label) => {
        const key = `${accountId}\0${label}`;

        return (
          !(knownNames?.has(label) ?? false) &&
          !attemptedLabels.current.has(key)
        );
      });

      if (missing.length === 0) {
        return;
      }

      for (const label of missing) {
        attemptedLabels.current.add(`${accountId}\0${label}`);
      }

      void loadCatalog(accountId);
    },
    [catalogs, loadCatalog]
  );

  const value = useMemo(() => {
    const connectedAccountIds = new Set(accountIds);

    const connectedCatalogs = new Map(
      [...catalogs].filter(([accountId]) => connectedAccountIds.has(accountId))
    );

    const connectedStatuses = new Map(
      [...statuses].filter(([accountId]) => connectedAccountIds.has(accountId))
    );

    return {
      catalogs: connectedCatalogs,
      ensureLabels,
      statuses: connectedStatuses,
      updateCatalog,
      upsertLabel,
    };
  }, [
    accountIds,
    catalogs,
    ensureLabels,
    statuses,
    updateCatalog,
    upsertLabel,
  ]);

  return <LabelsContext value={value}>{children}</LabelsContext>;
};

const useLabelsContext = (): LabelsContextValue => {
  const context = use(LabelsContext);

  if (context === undefined) {
    throw new Error("LabelsProvider is missing");
  }

  return context;
};

export const useLabelColors = (
  accountId: string,
  labels: readonly string[]
): ReadonlyMap<string, MailLabelColor> => {
  const context = useLabelsContext();

  useEffect(() => {
    context.ensureLabels(accountId, labels);
  }, [accountId, context, labels]);

  return context.catalogs.get(accountId)?.colorsByName ?? EMPTY_COLORS;
};

export const useLabelCatalog = (
  accountId: string
): MailLabelCatalog | undefined =>
  useLabelsContext().catalogs.get(accountId)?.catalog;

export const useLabelCatalogs = (): ReadonlyMap<
  string,
  readonly MailLabelSummary[]
> => {
  const { catalogs } = useLabelsContext();

  return useMemo(
    () =>
      new Map(
        [...catalogs].map(([accountId, state]) => [
          accountId,
          state.catalog.labels,
        ])
      ),
    [catalogs]
  );
};

export const useLabelCatalogSnapshot = (): {
  readonly catalogs: ReadonlyMap<string, readonly MailLabelSummary[]>;
  readonly statuses: ReadonlyMap<string, LabelCatalogLoadStatus>;
} => {
  const { catalogs, statuses } = useLabelsContext();

  return useMemo(
    () => ({
      catalogs: new Map(
        [...catalogs].map(([accountId, state]) => [
          accountId,
          state.catalog.labels,
        ])
      ),
      statuses,
    }),
    [catalogs, statuses]
  );
};

export const useUpdateLabelCatalog =
  (): LabelsContextValue["updateCatalog"] => {
    const context = useLabelsContext();

    return context.updateCatalog;
  };

export const useUpsertLabel = (): LabelsContextValue["upsertLabel"] => {
  const context = useLabelsContext();

  return context.upsertLabel;
};
