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

import { getMailApi } from "@/platform/desktop";
import type { GmailLabelCatalog, GmailLabelColor } from "@/shared/ipc/mail";

interface GmailLabelCatalogState {
  readonly colorsByName: ReadonlyMap<string, GmailLabelColor>;
  readonly names: ReadonlySet<string>;
}

interface GmailLabelsContextValue {
  readonly catalogs: ReadonlyMap<string, GmailLabelCatalogState>;
  readonly ensureLabels: (accountId: string, labels: readonly string[]) => void;
  readonly updateCatalog: (
    accountId: string,
    catalog: GmailLabelCatalog
  ) => void;
}

const EMPTY_COLORS: ReadonlyMap<string, GmailLabelColor> = new Map();
const GmailLabelsContext = createContext<GmailLabelsContextValue | undefined>(
  undefined
);

const toGmailLabelColors = (
  catalog: GmailLabelCatalog
): ReadonlyMap<string, GmailLabelColor> =>
  new Map(
    catalog.labels.flatMap((label) =>
      label.color === undefined ? [] : [[label.name, label.color] as const]
    )
  );

export const GmailLabelsProvider = ({
  accountIds,
  children,
}: {
  accountIds: readonly string[];
  children: ReactNode;
}) => {
  const [catalogs, setCatalogs] = useState<
    ReadonlyMap<string, GmailLabelCatalogState>
  >(new Map());
  const attemptedLabels = useRef(new Set<string>());
  const loadsInFlight = useRef(new Map<string, Promise<void>>());

  const updateCatalog = useCallback(
    (accountId: string, catalog: GmailLabelCatalog): void => {
      setCatalogs((current) => {
        const state = {
          colorsByName: toGmailLabelColors(catalog),
          names: new Set(catalog.labels.map((label) => label.name)),
        };
        return new Map([...current, [accountId, state]]);
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
        try {
          const reply = await getMailApi()?.listLabels({ accountId });

          if (reply?.ok === true) {
            updateCatalog(accountId, reply.data);
          }
        } catch {
          // Labels are supplementary mailbox metadata; the sync action is the
          // visible retry when a cached catalog cannot be loaded.
        } finally {
          loadsInFlight.current.delete(accountId);
        }
      })();

      loadsInFlight.current.set(accountId, load);
      return load;
    },
    [updateCatalog]
  );

  useEffect(() => {
    void Promise.all(accountIds.map(loadCatalog));
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

    return { catalogs: connectedCatalogs, ensureLabels, updateCatalog };
  }, [accountIds, catalogs, ensureLabels, updateCatalog]);

  return <GmailLabelsContext value={value}>{children}</GmailLabelsContext>;
};

const useGmailLabelsContext = (): GmailLabelsContextValue => {
  const context = use(GmailLabelsContext);

  if (context === undefined) {
    throw new Error("GmailLabelsProvider is missing");
  }

  return context;
};

export const useGmailLabelColors = (
  accountId: string,
  labels: readonly string[]
): ReadonlyMap<string, GmailLabelColor> => {
  const context = useGmailLabelsContext();

  useEffect(() => {
    context.ensureLabels(accountId, labels);
  }, [accountId, context, labels]);

  return context.catalogs.get(accountId)?.colorsByName ?? EMPTY_COLORS;
};

export const useUpdateGmailLabelCatalog =
  (): GmailLabelsContextValue["updateCatalog"] => {
    const context = useGmailLabelsContext();

    return context.updateCatalog;
  };
