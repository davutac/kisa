import type { ReactNode } from "react";
import { createContext, use, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getTemplateApi } from "@/platform/desktop";
import type {
  ComposerTemplate,
  ComposerTemplateChanged,
} from "@/shared/ipc/templates";

interface ComposerTemplatesState {
  readonly isLoading: boolean;
  readonly templates: readonly ComposerTemplate[];
}

const ComposerTemplatesContext = createContext<ComposerTemplatesState>({
  isLoading: false,
  templates: [],
});

const sortTemplates = (
  templates: readonly ComposerTemplate[]
): readonly ComposerTemplate[] =>
  [...templates].toSorted(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id)
  );

const applyChange = (
  templates: readonly ComposerTemplate[],
  change: ComposerTemplateChanged
): readonly ComposerTemplate[] =>
  change.kind === "remove"
    ? templates.filter(({ id }) => id !== change.templateId)
    : sortTemplates([
        change.template,
        ...templates.filter(({ id }) => id !== change.template.id),
      ]);

const applyChanges = (
  templates: readonly ComposerTemplate[],
  changes: readonly ComposerTemplateChanged[]
): readonly ComposerTemplate[] => {
  let current = templates;
  for (const change of changes) {
    current = applyChange(current, change);
  }
  return current;
};

export const ComposerTemplatesProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const templateApi = useMemo(() => getTemplateApi(), []);
  const [templates, setTemplates] = useState<readonly ComposerTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(templateApi !== undefined);
  const value = useMemo(
    () => ({ isLoading, templates }),
    [isLoading, templates]
  );

  useEffect(() => {
    if (templateApi === undefined) {
      return;
    }

    let active = true;
    let isLoaded = false;
    const pendingChanges: ComposerTemplateChanged[] = [];
    const unsubscribe = templateApi.onChanged((change) => {
      if (!active) {
        return;
      }
      if (!isLoaded) {
        pendingChanges.push(change);
        return;
      }
      setTemplates((current) => applyChange(current, change));
    });

    const load = async (): Promise<void> => {
      try {
        const reply = await templateApi.list();
        if (!active) {
          return;
        }
        if (!reply.ok) {
          toast.error(reply.error);
          return;
        }
        const loadedTemplates = applyChanges(
          sortTemplates(reply.data),
          pendingChanges
        );
        pendingChanges.length = 0;
        setTemplates(loadedTemplates);
      } catch {
        if (active) {
          toast.error("Could not load templates");
        }
      } finally {
        if (active) {
          isLoaded = true;
          if (pendingChanges.length > 0) {
            const changes = [...pendingChanges];
            pendingChanges.length = 0;
            setTemplates((current) => applyChanges(current, changes));
          }
          setIsLoading(false);
        }
      }
    };
    void load();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [templateApi]);

  return (
    <ComposerTemplatesContext value={value}>
      {children}
    </ComposerTemplatesContext>
  );
};

export const useComposerTemplates = (): ComposerTemplatesState =>
  use(ComposerTemplatesContext);
