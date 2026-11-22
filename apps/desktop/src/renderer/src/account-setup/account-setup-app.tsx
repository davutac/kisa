import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { flushSync } from "react-dom";

import { WindowTitlebar } from "@/components/shell/window-titlebar";
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
import type {
  MicrosoftAccountSetupReply,
  PasswordAccountSetupReply,
} from "@/shared/ipc/account-setup";
import {
  MAX_DISPLAY_NAME_LENGTH,
  OUTLOOK_IMAP_HELP_URL,
} from "@/shared/mail-account-presets";
import type {
  MailAccountPreset,
  MailServerSecurity,
} from "@/shared/mail-account-presets";
import { TITLEBAR_HEIGHT } from "@/shared/window-chrome";

import {
  createSignInAgainForm,
  findSetupProblem,
  findSetupSignInSwitch,
  getAccountSetupMode,
  INITIAL_ACCOUNT_SETUP_FORM,
  readSignInAgain,
  toMicrosoftSubmission,
  toPasswordSubmission,
  withServerSecurity,
  withSignInMethod,
} from "./account-setup-form";
import type {
  AccountSetupField,
  AccountSetupForm,
  AccountSetupMode,
  ServerFields,
  ServerSide,
  SignInMethod,
} from "./account-setup-form";

const FIELD_IDS = {
  email: "account-email",
  imapHost: "account-imap-host",
  imapPort: "account-imap-port",
  name: "account-name",
  password: "account-password",
  smtpHost: "account-smtp-host",
  smtpPort: "account-smtp-port",
} as const satisfies Record<AccountSetupField, string>;
const PROBLEM_ID = "account-setup-problem";

const DESCRIPTIONS = {
  address: "Sign in with an app password from your mail provider.",
  manual:
    "Enter your mail provider's server settings. Kisa checks them before saving.",
  microsoft: "Kisa signs in to Outlook through Microsoft, in your browser.",
} as const satisfies Record<
  Exclude<AccountSetupMode["kind"], "preset">,
  string
>;

const titleFor = (mode: AccountSetupMode): string => {
  if (SIGN_IN_AGAIN !== undefined) {
    return "Sign in again";
  }
  if (mode.kind === "preset") {
    return `Add ${mode.preset.title} account`;
  }
  if (mode.kind === "microsoft") {
    return mode.via === "address"
      ? "Add Outlook account"
      : "Add Microsoft account";
  }
  return "Add account";
};

const SUBMIT_LABELS = {
  microsoft: "Sign in with Microsoft",
  password: "Sign in",
} as const satisfies Record<SignInMethod, string>;

const PENDING_LABELS = {
  microsoft: "Waiting for Microsoft…",
  password: "Signing in…",
} as const satisfies Record<SignInMethod, string>;

const SIGN_IN_SWITCH_LABELS = {
  microsoft: "Sign in with Microsoft instead",
  password: "Use a password instead",
} as const satisfies Record<SignInMethod, string>;

interface PresetCopy {
  readonly description: string;
  /** Says which password not to use, before the link to make the right one. */
  readonly hint: string;
  readonly linkText: string;
  readonly passwordLabel: string;
}

/** Keyed by provider, so a new preset cannot ship without its own copy. */
const PRESET_COPY = {
  gmail: {
    description: "Kisa signs in to Gmail with an app password.",
    hint: "Your Google password won’t work, and app passwords need 2-Step Verification.",
    linkText: "Create an app password",
    passwordLabel: "App password",
  },
  icloud: {
    description: "Kisa signs in to iCloud Mail with an app-specific password.",
    hint: "Your Apple Account password won’t work.",
    linkText: "Create an app-specific password",
    passwordLabel: "App-specific password",
  },
} as const satisfies Record<MailAccountPreset["provider"], PresetCopy>;

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

interface PasswordFieldProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly invalidField: AccountSetupField | undefined;
  /** Takes focus when the page opens, as the first field to fill. */
  readonly isFirst?: boolean;
  readonly isLocked: boolean;
  readonly onChange: (hasPassword: boolean) => void;
  readonly preset: MailAccountPreset | undefined;
}

/** Uncontrolled: the password is read from the element only when sending. */
const PasswordField = ({
  inputRef,
  invalidField,
  isFirst = false,
  isLocked,
  onChange,
  preset,
}: PasswordFieldProps) => {
  const isInvalid = invalidField === "password" ? true : undefined;

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={FIELD_IDS.password}>
        {preset === undefined
          ? "App password"
          : PRESET_COPY[preset.provider].passwordLabel}
      </FieldLabel>
      <Input
        aria-describedby={isInvalid ? PROBLEM_ID : undefined}
        aria-invalid={isInvalid}
        autoComplete="off"
        // Signing in again, the password is the one thing to type.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={isFirst}
        id={FIELD_IDS.password}
        onChange={(event) => {
          onChange(event.currentTarget.value.length > 0);
        }}
        ref={inputRef}
        spellCheck={false}
        readOnly={isLocked}
        type="password"
      />
      {preset === undefined ? (
        <FieldDescription>
          Use an app password if your provider offers one.
        </FieldDescription>
      ) : (
        <FieldDescription>
          {PRESET_COPY[preset.provider].hint}{" "}
          <a href={preset.appPasswordUrl} rel="noreferrer" target="_blank">
            {PRESET_COPY[preset.provider].linkText}
          </a>
        </FieldDescription>
      )}
    </Field>
  );
};

interface AddressNotesProps {
  readonly isLocked: boolean;
  readonly mode: AccountSetupMode;
  readonly onSwitch: (method: SignInMethod) => void;
  readonly signInSwitch: SignInMethod | undefined;
}

/**
 * What goes under the address: Outlook.com's IMAP hint, and the switch
 * between a password and Microsoft. The switch is one button in one place
 * for both directions, so it keeps focus when it switches.
 */
const AddressNotes = ({
  isLocked,
  mode,
  onSwitch,
  signInSwitch,
}: AddressNotesProps) =>
  // Signing in again, the address is fixed and so is how it signs in.
  SIGN_IN_AGAIN === undefined ? (
    <>
      {mode.kind === "microsoft" && mode.via === "address" ? (
        <FieldDescription>
          Kisa needs IMAP, which Outlook.com has off by default.{" "}
          <a href={OUTLOOK_IMAP_HELP_URL} rel="noreferrer" target="_blank">
            Turn on IMAP
          </a>
        </FieldDescription>
      ) : null}
      {signInSwitch === undefined ? null : (
        <FieldDescription>
          <button
            className="hover:text-primary underline underline-offset-4 disabled:opacity-50"
            disabled={isLocked}
            onClick={() => {
              onSwitch(signInSwitch);
            }}
            type="button"
          >
            {SIGN_IN_SWITCH_LABELS[signInSwitch]}
          </button>
        </FieldDescription>
      )}
    </>
  ) : null;

interface SubmitButtonProps {
  readonly isDisabled: boolean;
  readonly method: SignInMethod;
  readonly pending: SignInMethod | undefined;
}

const SubmitButton = ({ isDisabled, method, pending }: SubmitButtonProps) => (
  <Button
    aria-disabled={pending !== undefined}
    disabled={isDisabled}
    type="submit"
  >
    {pending === undefined ? (
      SUBMIT_LABELS[method]
    ) : (
      <>
        <Spinner data-icon="inline-start" />
        {PENDING_LABELS[pending]}
      </>
    )}
  </Button>
);

interface NameFieldProps {
  readonly describedBy: string | undefined;
  readonly isInvalid: boolean;
  readonly isLocked: boolean;
  readonly onChange: (name: string) => void;
  readonly value: string;
}

/** The sender name. Signing in again keeps the account's, so it is not asked. */
const NameField = ({
  describedBy,
  isInvalid,
  isLocked,
  onChange,
  value,
}: NameFieldProps) =>
  SIGN_IN_AGAIN === undefined ? (
    <Field data-invalid={isInvalid ? true : undefined}>
      <FieldLabel htmlFor={FIELD_IDS.name}>Name</FieldLabel>
      <Input
        aria-describedby={describedBy}
        aria-invalid={isInvalid ? true : undefined}
        autoComplete="name"
        // The window exists for this form, and the name comes first.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        id={FIELD_IDS.name}
        maxLength={MAX_DISPLAY_NAME_LENGTH}
        onChange={(event) => onChange(event.currentTarget.value)}
        readOnly={isLocked}
        value={value}
      />
      <FieldDescription>
        Optional. The name people see on mail you send.
      </FieldDescription>
    </Field>
  ) : null;

const focusField = (field: AccountSetupField): void => {
  document.querySelector<HTMLElement>(`#${FIELD_IDS[field]}`)?.focus();
};

/**
 * Main opens the page as a macOS sheet, which has no title bar, or as a
 * window, which keeps a strip for its controls.
 */
const IS_SHEET =
  new URLSearchParams(window.location.search).get("presentation") === "sheet";

/**
 * Whether this build can sign in to Microsoft, which needs a registered
 * client. Main says so in the page URL; anything else means it cannot.
 */
const CAN_SIGN_IN_WITH_MICROSOFT =
  new URLSearchParams(window.location.search).get("microsoft") === "available";

/**
 * Set when main opened the page to sign a connected account in again. The
 * page then asks only for what that sign-in needs: the account keeps its
 * name and servers, and main checks the address against the one it chose.
 */
const SIGN_IN_AGAIN = readSignInAgain(window.location.search);

const SIGN_IN_AGAIN_DESCRIPTIONS = {
  microsoft: (email: string) =>
    `Sign in to ${email} with Microsoft, in your browser. Kisa keeps the account's mail.`,
  password: (email: string) =>
    `Enter a new app password for ${email}. Kisa keeps the account's mail and settings.`,
} as const satisfies Record<SignInMethod, (email: string) => string>;

const describeMode = (mode: AccountSetupMode): string => {
  if (SIGN_IN_AGAIN !== undefined) {
    return SIGN_IN_AGAIN_DESCRIPTIONS[SIGN_IN_AGAIN.method](
      SIGN_IN_AGAIN.email
    );
  }
  return mode.kind === "preset"
    ? PRESET_COPY[mode.preset.provider].description
    : DESCRIPTIONS[mode.kind];
};

/**
 * The Add account window. It sends the sign-in to main once per attempt and
 * gets back only success or a fixed message; main closes the window once
 * the account is saved. A Microsoft sign-in happens in the browser, so this
 * window only starts it, waits, and can stop it.
 */
const AccountSetupApp = () => {
  const bridge = window.accountSetup;
  const [form, setForm] = useState<AccountSetupForm>(() =>
    SIGN_IN_AGAIN === undefined
      ? INITIAL_ACCOUNT_SETUP_FORM
      : createSignInAgainForm(SIGN_IN_AGAIN)
  );
  const [hasPassword, setHasPassword] = useState(false);
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  const [pendingSignIn, setPendingSignIn] = useState<SignInMethod>();
  const [error, setError] = useState<string>();
  // Whether the user stopped the sign-in that is waiting on the browser.
  const wasCancelledRef = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Escape cancels, as Cancel does. This page is a dialog of its own and has
  // no hotkey system, so its one dismissal key is handled here.
  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        void bridge?.close();
      }
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape);
    };
  }, [bridge]);

  const mode = getAccountSetupMode(form);
  const isMicrosoft = mode.kind === "microsoft";
  const isMicrosoftUnavailable = isMicrosoft && !CAN_SIGN_IN_WITH_MICROSOFT;
  const isSubmitting = pendingSignIn !== undefined;
  const signInSwitch = findSetupSignInSwitch(
    mode,
    CAN_SIGN_IN_WITH_MICROSOFT,
    SIGN_IN_AGAIN
  );
  const problem = findSetupProblem(form, hasPassword, SIGN_IN_AGAIN);
  const visibleProblem = hasTriedSubmit ? problem : undefined;
  const invalidField = visibleProblem?.field;

  const updateForm = (next: AccountSetupForm): void => {
    setError(undefined);
    // Microsoft mode unmounts the password input; it comes back empty.
    if (getAccountSetupMode(next).kind === "microsoft") {
      setHasPassword(false);
    }
    setForm(next);
  };

  // A Microsoft server typed into the host field, or the switch itself, can
  // remove the focused control. Focus then lands on the address, from which
  // Enter signs in, rather than nowhere.
  const updateFormKeepingFocus = (next: AccountSetupForm): void => {
    flushSync(() => {
      updateForm(next);
    });
    if (document.activeElement === document.body) {
      focusField("email");
    }
  };

  const signIn = async (
    method: SignInMethod,
    send: () => Promise<MicrosoftAccountSetupReply | PasswordAccountSetupReply>
  ): Promise<void> => {
    setPendingSignIn(method);
    wasCancelledRef.current = false;
    await runWithCleanup(
      async () => {
        try {
          const reply = await send();
          // A sign-in the user stopped themselves is not an error to report.
          if (!(reply.ok || wasCancelledRef.current)) {
            setError(reply.error);
          }
        } catch {
          setError("Could not add the account.");
        }
      },
      () => {
        setPendingSignIn(undefined);
      }
    );
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

    if (isMicrosoft) {
      if (!isMicrosoftUnavailable) {
        await signIn("microsoft", () =>
          bridge.signInWithMicrosoft(toMicrosoftSubmission(form, SIGN_IN_AGAIN))
        );
      }
      return;
    }
    const password = passwordRef.current?.value ?? "";
    await signIn("password", () =>
      bridge.submit(toPasswordSubmission(form, password, SIGN_IN_AGAIN))
    );
  };

  const describe = (field: AccountSetupField) =>
    invalidField === field ? PROBLEM_ID : undefined;

  return (
    <main
      className="bg-background grid h-svh overflow-hidden"
      style={{
        gridTemplateRows: IS_SHEET
          ? "minmax(0, 1fr)"
          : `${TITLEBAR_HEIGHT}px minmax(0, 1fr)`,
      }}
    >
      {IS_SHEET ? null : (
        // The drag strip behind the window controls; the heading names it.
        <WindowTitlebar as="div" />
      )}

      <form
        aria-busy={isSubmitting}
        className="flex min-h-0 flex-col"
        noValidate
        onSubmit={submit}
      >
        <div
          className={`min-h-0 flex-1 overflow-y-auto px-6 pb-4 ${
            // A sheet has no title strip above, so it pads like its sides.
            IS_SHEET ? "pt-6" : "pt-2"
          }`}
        >
          <header className="mb-5">
            <h1 className="font-heading text-base font-medium">
              {titleFor(mode)}
            </h1>
            <p className="text-muted-foreground mt-1 text-xs/relaxed">
              {describeMode(mode)}
            </p>
          </header>

          {/* Fields go read-only while signing in, rather than disabled, so
              the control the user submitted from keeps its focus. */}
          <fieldset className="min-w-0">
            <FieldGroup>
              <NameField
                describedBy={describe("name")}
                isInvalid={invalidField === "name"}
                isLocked={isSubmitting}
                onChange={(name) => updateForm({ ...form, name })}
                value={form.name}
              />

              <Field data-invalid={invalidField === "email" ? true : undefined}>
                <FieldLabel htmlFor={FIELD_IDS.email}>Email address</FieldLabel>
                <Input
                  aria-describedby={describe("email")}
                  aria-invalid={invalidField === "email" ? true : undefined}
                  autoComplete="email"
                  // Signing in with Microsoft again, nothing is typed here:
                  // Enter from the address starts the sign-in.
                  // oxlint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus={SIGN_IN_AGAIN?.method === "microsoft"}
                  id={FIELD_IDS.email}
                  onChange={(event) =>
                    updateForm({ ...form, email: event.currentTarget.value })
                  }
                  placeholder="name@example.com"
                  spellCheck={false}
                  // Signing in again, the address is the account's.
                  readOnly={isSubmitting || SIGN_IN_AGAIN !== undefined}
                  type="email"
                  value={form.email}
                />
                <AddressNotes
                  isLocked={isSubmitting}
                  mode={mode}
                  onSwitch={(method) => {
                    updateFormKeepingFocus(withSignInMethod(form, method));
                  }}
                  signInSwitch={signInSwitch}
                />
              </Field>

              {isMicrosoft ? null : (
                <PasswordField
                  inputRef={passwordRef}
                  invalidField={invalidField}
                  isFirst={SIGN_IN_AGAIN !== undefined}
                  isLocked={isSubmitting}
                  onChange={(next) => {
                    setError(undefined);
                    setHasPassword(next);
                  }}
                  preset={mode.kind === "preset" ? mode.preset : undefined}
                />
              )}

              {mode.kind === "manual" && SIGN_IN_AGAIN === undefined ? (
                <>
                  <ServerFieldset
                    fields={form.imap}
                    invalidField={invalidField}
                    isLocked={isSubmitting}
                    onChange={(imap) =>
                      updateFormKeepingFocus({ ...form, imap })
                    }
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

          {isMicrosoftUnavailable ? (
            <Alert className="mt-4">
              <AlertDescription>
                This build of Kisa can’t sign in to Microsoft accounts.
              </AlertDescription>
            </Alert>
          ) : null}

          {error === undefined ? null : (
            <Alert className="mt-4" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <footer className="border-border flex justify-end gap-2 border-t px-6 py-3">
          <Button
            onClick={() => {
              // While Microsoft waits on the browser, Cancel stops only the
              // sign-in, and its reply comes back to this window.
              if (pendingSignIn === "microsoft") {
                wasCancelledRef.current = true;
                void bridge?.cancelMicrosoftSignIn();
              } else {
                void bridge?.close();
              }
            }}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <SubmitButton
            isDisabled={bridge === undefined || isMicrosoftUnavailable}
            method={isMicrosoft ? "microsoft" : "password"}
            pending={pendingSignIn}
          />
        </footer>
      </form>
    </main>
  );
};

export default AccountSetupApp;
