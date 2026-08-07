import type { ReactNode } from "react";
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
  actions?: ReactNode;
  className?: string;
  onChange: (recipients: EmailRecipients) => void;
  value: EmailRecipients;
}

type RecipientField = keyof EmailRecipients;

const EmailRecipientFields = ({
  actions,
  className,
  onChange,
  value,
}: EmailRecipientFieldsProps) => {
  const id = useId();
  const [showCc, setShowCc] = useState(value.cc.length > 0);
  const [showBcc, setShowBcc] = useState(value.bcc.length > 0);

  const updateField = (
    field: RecipientField,
    fieldValue: readonly string[]
  ) => {
    onChange({ ...value, [field]: fieldValue });
  };

  const renderField = (field: RecipientField, label: "Bcc" | "Cc" | "To") => (
    <EmailAddressInput
      actions={
        field === "to" ? (
          <>
            <InputGroupButton
              aria-controls={`${id}-cc`}
              aria-expanded={showCc}
              onClick={() => setShowCc((isVisible) => !isVisible)}
              size="sm"
              variant={showCc ? "secondary" : "ghost"}
            >
              Cc
            </InputGroupButton>
            <InputGroupButton
              aria-controls={`${id}-bcc`}
              aria-expanded={showBcc}
              onClick={() => setShowBcc((isVisible) => !isVisible)}
              size="sm"
              variant={showBcc ? "secondary" : "ghost"}
            >
              Bcc
            </InputGroupButton>
            {actions}
          </>
        ) : undefined
      }
      id={`${id}-${field}`}
      label={label}
      onChange={(addresses) => updateField(field, addresses)}
      value={value[field]}
    />
  );

  return (
    <div className={cn("flex flex-col gap-px", className)}>
      {renderField("to", "To")}
      {showCc ? renderField("cc", "Cc") : null}
      {showBcc ? renderField("bcc", "Bcc") : null}
    </div>
  );
};

export default EmailRecipientFields;
