import { useShortcut } from "@ui-sdk/react/shortcuts";
import { ChevronLeftIcon, ChevronRightIcon, MailIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";

import AccountProviderIcon from "@/components/accounts/account-provider-icon";
import { WindowTitlebar } from "@/components/shell/window-titlebar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  PasswordInput,
  PasswordInputControl,
} from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  getAccountSetupMode,
  INITIAL_ACCOUNT_SETUP_FORM,
  readSignInAgain,
  SETUP_PROVIDER_NAMES,
  toMicrosoftSubmission,
  toPasswordSubmission,
  withServerSecurity,
} from "./account-setup-form";
import type {
  AccountSetupField,
  AccountSetupForm,
  AccountSetupMode,
  ServerFields,
  ServerSide,
  SetupProvider,
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

// The notices under the form ease in; the form's own problem line, which
// changes as the user types, appears at once.
const alertClassName =
  "mt-4 transition-[opacity,translate] duration-150 starting:translate-y-1 starting:opacity-0 motion-reduce:transition-opacity";

// A step eases in from the side it comes from: the form from the end, as
// the next step, and the providers from the start, going back.
const STEP_ENTER_CLASS_NAMES = {
  back: "transition-[opacity,translate] duration-150 starting:-translate-x-2 starting:opacity-0 motion-reduce:transition-opacity",
  forward:
    "transition-[opacity,translate] duration-150 starting:translate-x-2 starting:opacity-0 motion-reduce:transition-opacity",
} as const;

const DESCRIPTIONS = {
  manual:
    "Sign in with an app password and your mail provider's server settings. Kisa checks them before saving.",
  microsoft: "Kisa signs in to Outlook through Microsoft, in your browser.",
} as const satisfies Record<
  Exclude<AccountSetupMode["kind"], "preset">,
  string
>;

const TITLES = {
  manual: "Add IMAP account",
  microsoft: "Add Outlook account",
} as const satisfies Record<
  Exclude<AccountSetupMode["kind"], "preset">,
  string
>;

const titleFor = (mode: AccountSetupMode): string => {
  if (SIGN_IN_AGAIN !== undefined) {
    return "Sign in again";
  }
  return mode.kind === "preset"
    ? `Add ${mode.preset.title} account`
    : TITLES[mode.kind];
};

const SUBMIT_LABELS = {
  microsoft: "Sign in with Microsoft",
  password: "Sign in",
} as const satisfies Record<SignInMethod, string>;

const PENDING_LABELS = {
  microsoft: "Waiting for Microsoft…",
  password: "Signing in…",
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

const SECURITY_ITEMS: { label: string; value: MailServerSecurity }[] = [
  { label: "SSL/TLS", value: "tls" },
  { label: "STARTTLS", value: "starttls" },
];

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
  const describe = (field: AccountSetupField) =>
    invalidField === field ? PROBLEM_ID : undefined;

  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{SERVER_LEGENDS[side]}</FieldLegend>
      <Field invalid={invalidField === hostField}>
        <FieldLabel>Server</FieldLabel>
        <Input
          aria-describedby={describe(hostField)}
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
        <Field invalid={invalidField === portField}>
          <FieldLabel>Port</FieldLabel>
          <Input
            aria-describedby={describe(portField)}
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
          <FieldLabel>Security</FieldLabel>
          <Select
            items={SECURITY_ITEMS}
            onValueChange={(security) => {
              if (security !== null) {
                onChange(withServerSecurity(side, fields, security));
              }
            }}
            readOnly={isLocked}
            value={fields.security}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECURITY_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
  const isInvalid = invalidField === "password";

  return (
    <Field invalid={isInvalid}>
      <FieldLabel>
        {preset === undefined
          ? "App password"
          : PRESET_COPY[preset.provider].passwordLabel}
      </FieldLabel>
      <PasswordInput
        autoComplete="off"
        onValueChange={(value) => {
          onChange(value.length > 0);
        }}
        readOnly={isLocked}
      >
        <PasswordInputControl
          aria-describedby={isInvalid ? PROBLEM_ID : undefined}
          // Signing in again, the password is the one thing to type.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={isFirst}
          id={FIELD_IDS.password}
          ref={inputRef}
          spellCheck={false}
        />
      </PasswordInput>
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

/** Outlook.com's IMAP hint under the address, which Microsoft 365 needs not. */
const AddressNotes = ({ mode }: { readonly mode: AccountSetupMode }) =>
  // Signing in again, the account already reached its mailbox.
  SIGN_IN_AGAIN === undefined &&
  mode.kind === "microsoft" &&
  mode.via === "address" ? (
    <FieldDescription>
      Kisa needs IMAP, which Outlook.com has off by default.{" "}
      <a href={OUTLOOK_IMAP_HELP_URL} rel="noreferrer" target="_blank">
        Turn on IMAP
      </a>
    </FieldDescription>
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
    size="lg"
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
    <Field invalid={isInvalid}>
      <FieldLabel>Name</FieldLabel>
      <Input
        aria-describedby={describedBy}
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

/** The providers in the order the first step lists them, Other last. */
const PROVIDER_OPTIONS = [
  { description: "Gmail and Google Workspace", provider: "gmail" },
  { description: "iCloud Mail", provider: "icloud" },
  {
    description: "Outlook.com, Hotmail and Microsoft 365",
    provider: "outlook",
  },
  { description: "Any other provider with IMAP", provider: "imap" },
] as const satisfies readonly {
  readonly description: string;
  readonly provider: SetupProvider;
}[];

interface ProviderPickerProps {
  /** The option that takes focus: the one the user came back from, or the first. */
  readonly focused: SetupProvider;
  readonly onPick: (provider: SetupProvider) => void;
}

/**
 * The window's first step. Picking a provider goes straight to its form,
 * so each option is a button rather than a choice to confirm.
 */
const ProviderPicker = ({ focused, onPick }: ProviderPickerProps) => (
  <div className="flex flex-col gap-2">
    {PROVIDER_OPTIONS.map(({ description, provider }) => {
      const isUnavailable =
        provider === "outlook" && !CAN_SIGN_IN_WITH_MICROSOFT;
      return (
        <Button
          // The window opens to pick a provider; focus starts on one.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={provider === focused}
          className="h-auto w-full justify-start gap-3 px-3 py-2.5 text-left whitespace-normal"
          disabled={isUnavailable}
          focusableWhenDisabled
          key={provider}
          onClick={() => {
            onPick(provider);
          }}
          variant="outline"
        >
          {provider === "imap" ? (
            <MailIcon
              aria-hidden="true"
              className="text-muted-foreground size-5"
            />
          ) : (
            <AccountProviderIcon className="size-5" provider={provider} />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-foreground text-sm font-medium">
              {SETUP_PROVIDER_NAMES[provider]}
            </span>{" "}
            <span className="text-muted-foreground font-normal">
              {isUnavailable
                ? "This build of Kisa can’t sign in to Microsoft accounts."
                : description}
            </span>
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className="text-muted-foreground"
          />
        </Button>
      );
    })}
  </div>
);

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
  // The provider the user went back from, which the first step focuses and
  // which says that step was reached by going back.
  const [returnedFrom, setReturnedFrom] = useState<SetupProvider>();
  // Whether the user stopped the sign-in that is waiting on the browser.
  const wasCancelledRef = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Escape cancels, as Cancel does. This window has no @/hotkeys registry, so
  // its one key goes to ui-sdk directly, which skips an Escape a list handled.
  useShortcut(
    "escape",
    () => {
      void bridge?.close();
    },
    { allowInInput: true }
  );

  // Changing step unmounts the password input and every message about it.
  const changeProvider = (provider: SetupProvider | undefined): void => {
    setError(undefined);
    setHasPassword(false);
    setHasTriedSubmit(false);
    setForm({ ...form, provider });
  };

  const { provider } = form;
  if (provider === undefined) {
    return (
      <ProviderStep
        onCancel={() => {
          void bridge?.close();
        }}
        onPick={changeProvider}
        returnedFrom={returnedFrom}
      />
    );
  }

  const mode = getAccountSetupMode(provider, form.email);
  const isMicrosoft = mode.kind === "microsoft";
  const isMicrosoftUnavailable = isMicrosoft && !CAN_SIGN_IN_WITH_MICROSOFT;
  const isSubmitting = pendingSignIn !== undefined;
  const problem = findSetupProblem(form, provider, hasPassword, SIGN_IN_AGAIN);
  const visibleProblem = hasTriedSubmit ? problem : undefined;
  const invalidField = visibleProblem?.field;

  const updateForm = (next: AccountSetupForm): void => {
    setError(undefined);
    setForm(next);
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
      bridge.submit(
        toPasswordSubmission(form, provider, password, SIGN_IN_AGAIN)
      )
    );
  };

  const describe = (field: AccountSetupField) =>
    invalidField === field ? PROBLEM_ID : undefined;

  return (
    <SetupWindow>
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
          } ${SIGN_IN_AGAIN === undefined ? STEP_ENTER_CLASS_NAMES.forward : ""}`}
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

              <Field invalid={invalidField === "email"}>
                <FieldLabel>Email address</FieldLabel>
                <Input
                  aria-describedby={describe("email")}
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
                <AddressNotes mode={mode} />
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

              {visibleProblem === undefined ? null : (
                // One message for the whole form: ui-sdk's FieldError shows
                // only inside its Field, and a narrow column can't hold it.
                <p
                  className="text-destructive text-xs/relaxed"
                  id={PROBLEM_ID}
                  role="alert"
                >
                  {visibleProblem.message}
                </p>
              )}
            </FieldGroup>
          </fieldset>

          {isMicrosoftUnavailable ? (
            <Alert className={alertClassName}>
              <AlertDescription>
                This build of Kisa can’t sign in to Microsoft accounts.
              </AlertDescription>
            </Alert>
          ) : null}

          {error === undefined ? null : (
            <Alert className={alertClassName} variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <footer className="border-border flex justify-end gap-2 border-t px-6 py-3">
          {SIGN_IN_AGAIN === undefined ? (
            // Signing in again has no providers to go back to.
            <Button
              className="mr-auto"
              disabled={isSubmitting}
              onClick={() => {
                setReturnedFrom(provider);
                changeProvider(undefined);
              }}
              size="lg"
              type="button"
              variant="ghost"
            >
              <ChevronLeftIcon data-icon="inline-start" />
              Back
            </Button>
          ) : null}
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
            size="lg"
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
    </SetupWindow>
  );
};

interface ProviderStepProps {
  readonly onCancel: () => void;
  readonly onPick: (provider: SetupProvider) => void;
  /** The provider the user went back from, if they did. */
  readonly returnedFrom: SetupProvider | undefined;
}

/** The first step: which provider the account is on. */
const ProviderStep = ({
  onCancel,
  onPick,
  returnedFrom,
}: ProviderStepProps) => (
  <SetupWindow>
    <div className="flex min-h-0 flex-col">
      <div
        className={`min-h-0 flex-1 overflow-y-auto px-6 pb-4 ${
          IS_SHEET ? "pt-6" : "pt-2"
        } ${returnedFrom === undefined ? "" : STEP_ENTER_CLASS_NAMES.back}`}
      >
        <header className="mb-5">
          <h1 className="font-heading text-base font-medium">Add account</h1>
          <p className="text-muted-foreground mt-1 text-xs/relaxed">
            Choose your mail provider.
          </p>
        </header>
        <ProviderPicker
          focused={returnedFrom ?? PROVIDER_OPTIONS[0].provider}
          onPick={onPick}
        />
      </div>
      <footer className="border-border flex justify-end gap-2 border-t px-6 py-3">
        <Button onClick={onCancel} size="lg" type="button" variant="secondary">
          Cancel
        </Button>
      </footer>
    </div>
  </SetupWindow>
);

/** The window's frame around either step: the title strip, then the step. */
const SetupWindow = ({ children }: { readonly children: ReactNode }) => (
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
    {children}
  </main>
);

export default AccountSetupApp;
