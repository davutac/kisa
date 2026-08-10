import type { ReactNode, Ref } from "react";
import { useId, useState } from "react";

import EmailAddressInput from "@/components/mail/email-address-input";
import { InputGroupButton } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

export interface EmailRecipients {
  bcc: readonly string[];
  cc: readonly string[];
  to: readonly string[];
}

interface EmailRecipientFieldsProps {
  accountId: string;
  actions?: ReactNode;
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
  inputRefs?: Partial<Record<RecipientField, Ref<HTMLInputElement>>>;
  onChange: (recipients: EmailRecipients) => void;
  resetKey?: string;
  suggestedAddresses?: readonly string[];
  value: EmailRecipients;
}

export type RecipientField = keyof EmailRecipients;

const NO_SUGGESTED_ADDRESSES: readonly string[] = [];

const EmailRecipientFields = ({
  accountId,
  actions,
  autoFocus = false,
  className,
  disabled = false,
  inputRefs,
  onChange,
  resetKey,
  suggestedAddresses = NO_SUGGESTED_ADDRESSES,
  value,
}: EmailRecipientFieldsProps) => {
  const id = useId();
  const [showCc, setShowCc] = useState(value.cc.length > 0);
  const [showBcc, setShowBcc] = useState(value.bcc.length > 0);
  const isCcVisible = showCc || value.cc.length > 0;
  const isBccVisible = showBcc || value.bcc.length > 0;

  const updateField = (
    field: RecipientField,
    fieldValue: readonly string[]
  ) => {
    onChange({ ...value, [field]: fieldValue });
  };

  const rememberVisibleField = (field: RecipientField): void => {
    if (field === "cc") {
      setShowCc(true);
    } else if (field === "bcc") {
      setShowBcc(true);
    }
  };

  const renderField = (field: RecipientField, label: "Bcc" | "Cc" | "To") => (
    <EmailAddressInput
      accountId={accountId}
      autoFocus={autoFocus && field === "to"}
      actions={
        field === "to" ? (
          <>
            <InputGroupButton
              aria-controls={`${id}-cc`}
              aria-expanded={isCcVisible}
              disabled={disabled}
              onClick={() => setShowCc((isVisible) => !isVisible)}
              variant={isCcVisible ? "secondary" : "ghost"}
            >
              Cc
            </InputGroupButton>
            <InputGroupButton
              aria-controls={`${id}-bcc`}
              aria-expanded={isBccVisible}
              disabled={disabled}
              onClick={() => setShowBcc((isVisible) => !isVisible)}
              variant={isBccVisible ? "secondary" : "ghost"}
            >
              Bcc
            </InputGroupButton>
            {actions}
          </>
        ) : undefined
      }
      id={`${id}-${field}`}
      inputRef={inputRefs?.[field]}
      key={`${field}:${resetKey ?? "stable"}`}
      label={label}
      disabled={disabled}
      onChange={(addresses) => updateField(field, addresses)}
      onFocus={field === "to" ? undefined : () => rememberVisibleField(field)}
      suggestedAddresses={suggestedAddresses}
      value={value[field]}
    />
  );

  return (
    <div className={cn("flex flex-col gap-px", className)}>
      {renderField("to", "To")}
      {isCcVisible ? renderField("cc", "Cc") : null}
      {isBccVisible ? renderField("bcc", "Bcc") : null}
    </div>
  );
};

export default EmailRecipientFields;
