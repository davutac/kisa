import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { APPLE_APP_PASSWORD_GUIDE_URL } from "@/shared/mail-account-presets";
import type { MailServerSecurity } from "@/shared/mail-account-presets";
import { TITLEBAR_HEIGHT } from "@/shared/window-chrome";

import {
  findAccountSetupProblem,
  getAccountSetupMode,
  INITIAL_ACCOUNT_SETUP_FORM,
  toAccountServers,
  withServerSecurity,
} from "./account-setup-form";
import type {
  AccountSetupField,
  AccountSetupForm,
  AccountSetupMode,
  ServerFields,
  ServerSide,
} from "./account-setup-form";

const FIELD_IDS = {
  email: "account-email",
  imapHost: "account-imap-host",
  imapPort: "account-imap-port",
  password: "account-password",
  smtpHost: "account-smtp-host",
  smtpPort: "account-smtp-port",
} as const satisfies Record<AccountSetupField, string>;
const PROBLEM_ID = "account-setup-problem";

const DESCRIPTIONS = {
  address: "Sign in with an app password from your mail provider.",
  gmail: "Sign in with an app password from your mail provider.",
  manual:
    "Enter your mail provider's server settings. Kisa checks them before saving.",
  preset: "Kisa signs in to iCloud Mail with an app-specific password.",
} as const satisfies Record<AccountSetupMode["kind"], string>;

const SERVER_LEGENDS = {
  imap: "Incoming mail (IMAP)",
  smtp: "Outgoing mail (SMTP)",
} as const satisfies Record<ServerSide, string>;

interface ServerFieldsetProps {
  readonly fields: ServerFields;
  readonly invalidField: AccountSetupField | undefined;
  readonly isLocked: boolean;
  readonly onChange: (fields: ServerFields) => void;
  readonly side: ServerSide;
}

const ServerFieldset = ({
  fields,
  invalidField,
  isLocked,
  onChange,
  side,
}: ServerFieldsetProps) => {
  const hostField = side === "imap" ? "imapHost" : "smtpHost";
  const portField = side === "imap" ? "imapPort" : "smtpPort";
  const securityId = `account-${side}-security`;
  const describe = (field: AccountSetupField) =>
    invalidField === field ? PROBLEM_ID : undefined;

  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{SERVER_LEGENDS[side]}</FieldLegend>
      <Field data-invalid={invalidField === hostField ? true : undefined}>
        <FieldLabel htmlFor={FIELD_IDS[hostField]}>Server</FieldLabel>
        <Input
          aria-describedby={describe(hostField)}
          aria-invalid={invalidField === hostField ? true : undefined}
          autoComplete="off"
          id={FIELD_IDS[hostField]}
          onChange={(event) =>
            onChange({ ...fields, host: event.currentTarget.value })
          }
          placeholder={
            side === "imap" ? "imap.example.com" : "smtp.example.com"
          }
          spellCheck={false}
          readOnly={isLocked}
          value={fields.host}
        />
      </Field>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
        <Field data-invalid={invalidField === portField ? true : undefined}>
          <FieldLabel htmlFor={FIELD_IDS[portField]}>Port</FieldLabel>
          <Input
            aria-describedby={describe(portField)}
            aria-invalid={invalidField === portField ? true : undefined}
            autoComplete="off"
            id={FIELD_IDS[portField]}
            inputMode="numeric"
            onChange={(event) =>
              onChange({ ...fields, port: event.currentTarget.value })
            }
            spellCheck={false}
            readOnly={isLocked}
            value={fields.port}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={securityId}>Security</FieldLabel>
          <NativeSelect
            className="w-full"
            disabled={isLocked}
            id={securityId}
            onChange={(event) =>
              onChange(
                withServerSecurity(
                  side,
                  fields,
                  event.currentTarget.value === "starttls" ? "starttls" : "tls"
                )
              )
            }
            value={fields.security satisfies MailServerSecurity}
          >
            <NativeSelectOption value="tls">SSL/TLS</NativeSelectOption>
            <NativeSelectOption value="starttls">STARTTLS</NativeSelectOption>
          </NativeSelect>
        </Field>
      </div>
    </FieldSet>
  );
};

const focusField = (field: AccountSetupField): void => {
  document.querySelector<HTMLElement>(`#${FIELD_IDS[field]}`)?.focus();
};

/**
 * The Add account window. It sends the sign-in to main once per attempt and
 * gets back only success or a fixed message; main closes the window once
 * the account is saved.
 */
const AccountSetupApp = () => {
  const bridge = window.accountSetup;
  const [form, setForm] = useState<AccountSetupForm>(
    INITIAL_ACCOUNT_SETUP_FORM
  );
  const [hasPassword, setHasPassword] = useState(false);
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  // Uncontrolled: the password is read from the element only when sending.
  const passwordRef = useRef<HTMLInputElement>(null);

  const mode = getAccountSetupMode(form.email);
  const problem = findAccountSetupProblem(form, hasPassword);
  const visibleProblem =
    hasTriedSubmit || mode.kind === "gmail" ? problem : undefined;
  const invalidField = visibleProblem?.field;

  const updateForm = (next: AccountSetupForm): void => {
    setError(undefined);
    setForm(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (bridge === undefined || isSubmitting) {
      return;
    }

    setHasTriedSubmit(true);
    setError(undefined);
    if (problem !== undefined) {
      focusField(problem.field);
      return;
    }

    setIsSubmitting(true);
    await runWithCleanup(
      async () => {
        try {
          const reply = await bridge.submit({
            email: form.email.trim(),
            password: passwordRef.current?.value ?? "",
            servers: toAccountServers(form),
          });
          if (!reply.ok) {
            setError(reply.error);
          }
        } catch {
          setError("Could not add the account.");
        }
      },
      () => {
        setIsSubmitting(false);
      }
    );
  };

  const describe = (field: AccountSetupField) =>
    invalidField === field ? PROBLEM_ID : undefined;

  return (
    <main
      className="bg-background grid h-svh overflow-hidden"
      style={{ gridTemplateRows: `${TITLEBAR_HEIGHT}px minmax(0, 1fr)` }}
    >
      <header className="app-titlebar flex items-center justify-center">
        <span className="text-xs font-medium">Add account</span>
      </header>
      <form
        aria-busy={isSubmitting}
        className="flex min-h-0 flex-col"
        noValidate
        onSubmit={submit}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-4">
          <header className="mb-5">
            <h1 className="font-heading text-base font-medium">
              {mode.kind === "preset"
                ? `Add ${mode.preset.title} account`
                : "Add iCloud or other account"}
            </h1>
            <p className="text-muted-foreground mt-1 text-xs/relaxed">
              {DESCRIPTIONS[mode.kind]}
            </p>
          </header>

          {/* Fields go read-only while signing in, rather than disabled, so
              the control the user submitted from keeps its focus. */}
          <fieldset className="min-w-0">
            <FieldGroup>
              <Field data-invalid={invalidField === "email" ? true : undefined}>
                <FieldLabel htmlFor={FIELD_IDS.email}>Email address</FieldLabel>
                <Input
                  aria-describedby={describe("email")}
                  aria-invalid={invalidField === "email" ? true : undefined}
                  autoComplete="email"
                  // The window exists for this form; the address comes first.
                  // oxlint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  id={FIELD_IDS.email}
                  onChange={(event) =>
                    updateForm({ ...form, email: event.currentTarget.value })
                  }
                  placeholder="name@icloud.com"
                  spellCheck={false}
                  readOnly={isSubmitting}
                  type="email"
                  value={form.email}
                />
              </Field>

              <Field
                data-invalid={invalidField === "password" ? true : undefined}
              >
                <FieldLabel htmlFor={FIELD_IDS.password}>
                  {mode.kind === "preset"
                    ? "App-specific password"
                    : "App password"}
                </FieldLabel>
                <Input
                  aria-describedby={describe("password")}
                  aria-invalid={invalidField === "password" ? true : undefined}
                  autoComplete="off"
                  id={FIELD_IDS.password}
                  onChange={(event) => {
                    setError(undefined);
                    setHasPassword(event.currentTarget.value.length > 0);
                  }}
                  ref={passwordRef}
                  spellCheck={false}
                  readOnly={isSubmitting}
                  type="password"
                />
                {mode.kind === "preset" ? (
                  <FieldDescription>
                    Your Apple Account password won’t work.{" "}
                    <a
                      href={APPLE_APP_PASSWORD_GUIDE_URL}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Create an app-specific password
                    </a>
                  </FieldDescription>
                ) : (
                  <FieldDescription>
                    Use an app password if your provider offers one.
                  </FieldDescription>
                )}
              </Field>

              {mode.kind === "manual" ? (
                <>
                  <ServerFieldset
                    fields={form.imap}
                    invalidField={invalidField}
                    isLocked={isSubmitting}
                    onChange={(imap) => updateForm({ ...form, imap })}
                    side="imap"
                  />
                  <ServerFieldset
                    fields={form.smtp}
                    invalidField={invalidField}
                    isLocked={isSubmitting}
                    onChange={(smtp) => updateForm({ ...form, smtp })}
                    side="smtp"
                  />
                </>
              ) : null}

              <FieldError id={PROBLEM_ID}>{visibleProblem?.message}</FieldError>
            </FieldGroup>
          </fieldset>

          {error === undefined ? null : (
            <Alert className="mt-4" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <footer className="border-border flex justify-end gap-2 border-t px-6 py-3">
          <Button
            onClick={() => {
              void bridge?.close();
            }}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            aria-disabled={isSubmitting}
            disabled={bridge === undefined}
            type="submit"
          >
            {isSubmitting ? (
              <>
                <Spinner data-icon="inline-start" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </footer>
      </form>
    </main>
  );
};

export default AccountSetupApp;
