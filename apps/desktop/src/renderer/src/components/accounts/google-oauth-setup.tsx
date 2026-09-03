import { ExternalLinkIcon, FileJsonIcon, ShieldCheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import createProjectImage from "../../assets/google-oauth-setup/01-create-project.png";
import enableGmailApiImage from "../../assets/google-oauth-setup/02-enable-gmail-api.png";
import configureAppImage from "../../assets/google-oauth-setup/03-configure-app.png";
import externalAudienceImage from "../../assets/google-oauth-setup/04-choose-external.png";
import gmailScopeImage from "../../assets/google-oauth-setup/05-add-gmail-scope.png";
import createDesktopClientImage from "../../assets/google-oauth-setup/06-create-desktop-client.png";
import downloadJsonImage from "../../assets/google-oauth-setup/07-download-json.png";
import publishAppImage from "../../assets/google-oauth-setup/08-publish-app.png";

const GOOGLE_PROJECT_URL = "https://console.cloud.google.com/projectcreate";
const GMAIL_API_URL =
  "https://console.cloud.google.com/apis/library/gmail.googleapis.com";
const GOOGLE_AUTH_URL = "https://console.cloud.google.com/auth/overview";
const GOOGLE_AUDIENCE_URL = "https://console.cloud.google.com/auth/audience";
const GOOGLE_SCOPES_URL = "https://console.cloud.google.com/auth/scopes";
const GOOGLE_CLIENTS_URL = "https://console.cloud.google.com/auth/clients";

const ExternalLink = ({
  children,
  href,
}: {
  readonly children: ReactNode;
  readonly href: string;
}) => (
  <a
    className="text-foreground hover:text-primary inline-flex items-center gap-1 underline underline-offset-3 [-webkit-app-region:no-drag]"
    href={href}
    rel="noreferrer"
    target="_blank"
  >
    {children}
    <ExternalLinkIcon className="size-3" />
  </a>
);

interface SetupStepProps {
  readonly children: ReactNode;
  readonly imageAlt: string;
  readonly imageSrc: string;
  readonly number: number;
  readonly title: string;
}

const SetupStep = ({
  children,
  imageAlt,
  imageSrc,
  number,
  title,
}: SetupStepProps) => (
  <li className="space-y-2.5">
    <div className="grid grid-cols-[1.5rem_1fr] gap-2">
      <span className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full font-medium">
        {number}
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <div className="text-muted-foreground mt-1 space-y-1">{children}</div>
      </div>
    </div>
    <img
      alt={imageAlt}
      className="border-border/70 bg-muted ml-8 block h-auto w-fit max-w-[calc(100%-2rem)] rounded-lg border object-contain object-left-top"
      draggable={false}
      loading="lazy"
      src={imageSrc}
    />
  </li>
);

export const GoogleOAuthSetupSteps = ({
  className,
}: {
  readonly className?: string;
}) => (
  <div className={cn("space-y-5 text-xs/relaxed", className)}>
    <ol className="space-y-6">
      <SetupStep
        imageAlt="Google Cloud new project form with Kisa Mail entered as the project name"
        imageSrc={createProjectImage}
        number={1}
        title="Create a project"
      >
        <p>
          Open{" "}
          <ExternalLink href={GOOGLE_PROJECT_URL}>New project</ExternalLink>,
          name it <strong className="text-foreground">Kisa Mail</strong>, leave
          the parent as{" "}
          <strong className="text-foreground">No organization</strong>, and
          select <strong className="text-foreground">Create</strong>.
        </p>
      </SetupStep>

      <SetupStep
        imageAlt="Gmail API product page with the Enable button visible"
        imageSrc={enableGmailApiImage}
        number={2}
        title="Enable the Gmail API"
      >
        <p>
          Open the <ExternalLink href={GMAIL_API_URL}>Gmail API</ExternalLink>,
          confirm <strong className="text-foreground">Kisa Mail</strong> is the
          selected project, and select{" "}
          <strong className="text-foreground">Enable</strong>.
        </p>
      </SetupStep>

      <SetupStep
        imageAlt="Google Auth project configuration form for app information"
        imageSrc={configureAppImage}
        number={3}
        title="Configure Google Auth"
      >
        <p>
          Open{" "}
          <ExternalLink href={GOOGLE_AUTH_URL}>
            Google Auth Platform
          </ExternalLink>
          {", "}select <strong className="text-foreground">Get started</strong>,
          and use <strong className="text-foreground">Kisa Mail</strong> as the
          app name. Select your Google account as the support email, then select{" "}
          <strong className="text-foreground">Next</strong>.
        </p>
      </SetupStep>

      <SetupStep
        imageAlt="Google Auth audience step with External selected"
        imageSrc={externalAudienceImage}
        number={4}
        title="Choose External"
      >
        <p>
          Select <strong className="text-foreground">External</strong>, then{" "}
          <strong className="text-foreground">Next</strong>. Enter your Google
          account email under Contact Information, accept the data policy, and
          finish creating the configuration.
        </p>
      </SetupStep>

      <SetupStep
        imageAlt="Google Auth Data Access page showing the full Gmail scope under restricted scopes"
        imageSrc={gmailScopeImage}
        number={5}
        title="Add the required scopes"
      >
        <p>
          Open <ExternalLink href={GOOGLE_SCOPES_URL}>Data Access</ExternalLink>
          {" and "}
          <strong className="text-foreground">Add or remove scopes</strong>.
          Select <code>openid</code>, <code>userinfo.email</code>, and{" "}
          <code>userinfo.profile</code>.
        </p>
        <p>
          Under Manually add scopes, paste
          <code className="text-foreground ml-1 break-all select-all">
            https://mail.google.com/
          </code>
          , then select{" "}
          <strong className="text-foreground">Add to table</strong>,{" "}
          <strong className="text-foreground">Update</strong>, and{" "}
          <strong className="text-foreground">Save</strong>.
        </p>
      </SetupStep>

      <SetupStep
        imageAlt="Google Auth client form with Desktop app selected as the application type"
        imageSrc={createDesktopClientImage}
        number={6}
        title="Create the Desktop client"
      >
        <p>
          Open <ExternalLink href={GOOGLE_CLIENTS_URL}>Clients</ExternalLink>,
          select <strong className="text-foreground">Create client</strong>, and
          choose <strong className="text-foreground">Desktop app</strong>. Name
          it <strong className="text-foreground">Kisa Desktop</strong> and
          create it.
        </p>
      </SetupStep>

      <SetupStep
        imageAlt="OAuth client created dialog with the Download JSON button visible and credentials redacted"
        imageSrc={downloadJsonImage}
        number={7}
        title="Download the JSON"
      >
        <p>
          In the success dialog, select{" "}
          <strong className="text-foreground">Download JSON</strong> before
          closing it. Return here and upload that file below.
        </p>
      </SetupStep>

      <SetupStep
        imageAlt="Google Auth Audience page showing Testing status and the Publish app button"
        imageSrc={publishAppImage}
        number={8}
        title="Publish the app"
      >
        <p>
          Finally, open{" "}
          <ExternalLink href={GOOGLE_AUDIENCE_URL}>Audience</ExternalLink>
          {" and select "}
          <strong className="text-foreground">Publish app</strong>. Confirm the
          prompt. The publishing status should change from Testing to{" "}
          <strong className="text-foreground">In production</strong>.
        </p>
      </SetupStep>
    </ol>

    <div className="bg-muted/50 text-muted-foreground flex gap-2 rounded-lg p-3">
      <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" />
      <p>
        Kisa has no servers. The selected file and Google tokens never enter the
        page. Electron encrypts the OAuth client once on this device and keeps
        each account&apos;s tokens separate.
      </p>
    </div>
  </div>
);

interface GoogleOAuthSetupDialogProps {
  readonly isUploading: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onUpload: () => Promise<boolean>;
  readonly open: boolean;
}

export const GoogleOAuthSetupDialog = ({
  isUploading,
  onOpenChange,
  onUpload,
  open,
}: GoogleOAuthSetupDialogProps) => {
  const handleUpload = async (): Promise<void> => {
    if (await onUpload()) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden [-webkit-app-region:no-drag] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Set up Google</DialogTitle>
          <DialogDescription>
            Follow these eight steps once. It usually takes about five minutes.
            Then upload the credentials JSON Google gives you.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-4 min-h-0 overflow-y-auto overscroll-contain px-4 select-text">
          <GoogleOAuthSetupSteps />
        </div>
        <DialogFooter className="-mx-4 -mb-4 gap-px overflow-hidden rounded-b-lg">
          <DialogClose
            disabled={isUploading}
            render={<Button size="footer" type="button" variant="outline" />}
          >
            Cancel
          </DialogClose>
          <Button
            disabled={isUploading}
            onClick={handleUpload}
            size="footer"
            type="button"
          >
            <FileJsonIcon />
            {isUploading ? "Uploading…" : "Upload credentials JSON"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
