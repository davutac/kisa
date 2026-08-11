// The local edit buffer follows persisted template events while it remains clean.
// oxlint-disable react/react-compiler
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { EmailComposerValue } from "@/components/mail/email-composer";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import { useAppCommand } from "@/hotkeys";
import { getTemplateApi } from "@/platform/desktop";
import type {
  ComposerTemplate,
  ComposerTemplateInput,
} from "@/shared/ipc/templates";
import { validateTemplateText } from "@/shared/template-variables";
import { useComposerTemplates } from "@/state/composer-templates";
import { useGoogleAccounts } from "@/state/google-accounts";

import {
  createEmptyTemplate,
  getTemplateNameError,
  getVariablePreviewContext,
  templatesAreEqual,
  toTemplateInput,
} from "./template-draft";
import { getNextTemplateSelectionIndex } from "./template-selection";
import type { TemplateSelectionDirection } from "./template-selection";
import { useTemplateConfirmations } from "./use-template-confirmations";

export const useTemplateWorkspace = () => {
  const accounts = useGoogleAccounts();
  const { isLoading, templates } = useComposerTemplates();
  const templateApi = useMemo(() => getTemplateApi(), []);
  const accountIds = useMemo(
    () => new Set(accounts.map(({ email }) => email)),
    [accounts]
  );
  const [draft, setDraft] = useState<ComposerTemplateInput | null>(null);
  const [original, setOriginal] = useState<ComposerTemplateInput | null>(null);
  const [query, setQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const [editorVersion, setEditorVersion] = useState(0);
  const draftRef = useRef(draft);
  const searchInputRef = useRef<HTMLInputElement>(null);
  draftRef.current = draft;

  const isDirty =
    draft !== null &&
    (original === null || !templatesAreEqual(draft, original));
  const filteredTemplates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return templates.filter(({ name }) =>
      name.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [query, templates]);
  const { confirmDelete, confirmDiscard } = useTemplateConfirmations({
    isDirty,
    templateName: draft?.name,
  });

  // The editor buffer follows account-cascade and cross-window changes until
  // the user starts editing. Once dirty, their explicit local work wins.
  useEffect(() => {
    if (draft === null || original === null || isDirty) {
      return;
    }

    const latest = templates.find(({ id }) => id === draft.id);
    if (latest === undefined) {
      setDraft(null);
      setOriginal(null);
      return;
    }

    const input = toTemplateInput(latest, accountIds);
    if (!templatesAreEqual(input, draft)) {
      setDraft(input);
      setOriginal(input);
      setNameError(undefined);
      setEditorVersion((version) => version + 1);
    }
  }, [accountIds, draft, isDirty, original, templates]);

  const requestDiscard = async (action: () => void): Promise<void> => {
    if (!isDirty) {
      action();
      return;
    }

    if (await confirmDiscard()) {
      action();
    }
  };

  const chooseTemplate = (template: ComposerTemplate): void => {
    void requestDiscard(() => {
      const input = toTemplateInput(template, accountIds);
      setDraft(input);
      setOriginal(input);
      setEditorVersion((version) => version + 1);
    });
  };

  const createTemplate = (): void => {
    void requestDiscard(() => {
      setDraft(createEmptyTemplate());
      setOriginal(null);
      setNameError(undefined);
    });
  };

  const moveTemplateSelection = (
    direction: TemplateSelectionDirection
  ): void => {
    const nextIndex = getNextTemplateSelectionIndex(
      filteredTemplates.map(({ id }) => id),
      draft?.id,
      direction
    );
    const nextTemplate =
      nextIndex === null ? undefined : filteredTemplates[nextIndex];

    if (nextTemplate !== undefined && nextTemplate.id !== draft?.id) {
      chooseTemplate(nextTemplate);
    }
  };

  const updateDraft = (
    update: (current: ComposerTemplateInput) => ComposerTemplateInput
  ): void => {
    setDraft((current) => (current === null ? null : update(current)));
  };

  const updateRecipients = (recipients: EmailRecipients): void => {
    updateDraft((current) => ({ ...current, ...recipients }));
  };

  const updateBody = (body: EmailComposerValue): void => {
    updateDraft((current) => ({
      ...current,
      body: { html: body.html, text: body.text },
    }));
  };

  const save = async (): Promise<void> => {
    if (draft === null || templateApi === undefined || isSaving) {
      return;
    }

    const validationError = getTemplateNameError(draft, templates);
    if (validationError !== undefined) {
      setNameError(validationError);
      return;
    }
    setNameError(undefined);

    for (const [field, value] of [
      ["Subject", draft.subject],
      ["Body", draft.body.text],
    ] as const) {
      const validation = validateTemplateText(value);
      if (!validation.ok) {
        toast.error(`${field}: ${validation.message}`);
        return;
      }
    }

    const submittedDraft = draft;
    setIsSaving(true);
    try {
      const reply = await templateApi.save({
        ...submittedDraft,
        name: submittedDraft.name.trim(),
      });
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      const saved = toTemplateInput(reply.data, accountIds);
      if (draftRef.current?.id === saved.id) {
        setOriginal(saved);
        setDraft((current) => (current === submittedDraft ? saved : current));
      }
      toast.success("Template saved");
    } catch {
      toast.error("Could not save template");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (draft === null || original === null || templateApi === undefined) {
      return;
    }

    try {
      const reply = await templateApi.delete({ templateId: original.id });
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      setDraft(null);
      setOriginal(null);
      toast.success("Template deleted");
    } catch {
      toast.error("Could not delete template");
    }
  };

  const requestDelete = async (): Promise<void> => {
    if (original === null) {
      return;
    }

    const confirmed = await confirmDelete(original.name);

    if (confirmed) {
      await remove();
    }
  };

  useAppCommand("templates.new", createTemplate);
  useAppCommand("templates.next", () => moveTemplateSelection(1), {
    enabled: filteredTemplates.length > 0,
  });
  useAppCommand("templates.previous", () => moveTemplateSelection(-1), {
    enabled: filteredTemplates.length > 0,
  });
  useAppCommand("templates.save", save, {
    enabled: draft !== null && isDirty && !isSaving,
  });
  useAppCommand("templates.focusSearch", () => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  });

  return {
    editor:
      draft === null
        ? null
        : {
            accounts,
            draft,
            editorVersion,
            isCreating: original === null,
            isDirty,
            isSaving,
            nameError,
            onAccountChange: (accountId: string | null) =>
              updateDraft((current) => ({ ...current, accountId })),
            onBodyChange: updateBody,
            onDelete: () => {
              void requestDelete();
            },
            onNameChange: (name: string) => {
              setNameError(undefined);
              updateDraft((current) => ({ ...current, name }));
            },
            onRecipientsChange: updateRecipients,
            onSave: save,
            onSubjectChange: (subject: string) =>
              updateDraft((current) => ({ ...current, subject })),
            variablePreviewContext: getVariablePreviewContext(draft, accounts),
          },
    sidebar: {
      isLoading,
      onCreate: createTemplate,
      onQueryChange: setQuery,
      onSelect: chooseTemplate,
      query,
      searchInputRef,
      selectedTemplateId: draft?.id,
      templates: filteredTemplates,
      totalTemplateCount: templates.length,
    },
  };
};
