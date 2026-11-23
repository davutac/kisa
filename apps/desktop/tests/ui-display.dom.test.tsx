import { act, fireEvent, render, screen } from "@testing-library/react";
import { settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CleanDraftVersion } from "../src/renderer/src/components/mail/clean-draft-history";
import CleanDraftHistoryStrip from "../src/renderer/src/components/mail/clean-draft-history-strip";
import MailMessageParticipants from "../src/renderer/src/components/mail/message-participants";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "../src/renderer/src/components/ui/avatar";
import { Badge } from "../src/renderer/src/components/ui/badge";
import { BreadcrumbLink } from "../src/renderer/src/components/ui/breadcrumb";
import { Button } from "../src/renderer/src/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "../src/renderer/src/components/ui/button-group";
import { Empty } from "../src/renderer/src/components/ui/empty";
import { Item } from "../src/renderer/src/components/ui/item";
import { Separator } from "../src/renderer/src/components/ui/separator";
import {
  SettingsRow,
  SettingsRows,
} from "../src/renderer/src/components/ui/settings";
import { Spinner } from "../src/renderer/src/components/ui/spinner";
import type { ThreadMessage } from "../src/shared/ipc/mail";

const agent = createAgent();

const message: ThreadMessage = {
  attachments: [],
  body: {},
  from: "Jane Doe <jane@example.com>",
  id: "message-1",
  labelIds: [],
  senderAuthenticated: false,
  sentAt: 0,
  snippet: "",
  subject: "Lunch",
  to: "me@example.com",
};

const versions: readonly CleanDraftVersion[] = [
  {
    body: "original",
    id: "original",
    label: "Original",
    status: "ready",
    subject: "Lunch",
  },
  {
    body: "clean",
    id: "clean-1",
    label: "#1 Clean",
    status: "ready",
    subject: "Lunch",
  },
];

const getImage = (container: HTMLElement): HTMLImageElement => {
  const image = container.querySelector("img");
  if (image === null) {
    throw new Error("The avatar image is missing");
  }
  return image;
};

const describeLine = (testId: string) => {
  const line = screen.getByTestId(testId);
  return [
    line.getAttribute("role"),
    line.getAttribute("aria-orientation"),
    line.dataset.orientation,
  ];
};

describe("render composition", () => {
  it("renders an item as the element it is given, keeping its slot, size, classes and ref", () => {
    const ref = createRef<HTMLDivElement>();
    const renderRef = createRef<HTMLElement>();
    render(
      <Item
        className="caller-class px-1"
        data-testid="row"
        ref={ref}
        render={<article className="from-render" ref={renderRef} />}
        size="sm"
      >
        Lunch
      </Item>
    );
    const row = screen.getByTestId("row");

    expect(row.tagName).toBe("ARTICLE");
    expect([ref.current, renderRef.current]).toStrictEqual([row, row]);
    expect({ ...row.dataset }).toMatchObject({
      size: "sm",
      slot: "item",
      variant: "default",
    });
    expect([...row.classList]).toStrictEqual(
      expect.arrayContaining([
        "group/item",
        "caller-class",
        "from-render",
        "px-1",
      ])
    );
    expect(row.classList.contains("px-3")).toBeFalsy();
  });

  it("lets a caller's class win over a badge's own size", () => {
    render(
      <Badge className="h-6" variant="secondary">
        Travel
      </Badge>
    );
    const badge = screen.getByText("Travel");

    expect({ ...badge.dataset }).toStrictEqual({
      slot: "badge",
      variant: "secondary",
    });
    expect(badge.classList.contains("h-6")).toBeTruthy();
    expect(badge.classList.contains("h-5")).toBeFalsy();
  });

  it("passes a part's props to a render function", () => {
    render(
      <BreadcrumbLink
        className="caller-class"
        render={(props) => <button type="button" {...props} />}
      >
        Inbox
      </BreadcrumbLink>
    );
    const link = screen.getByRole("button", { name: "Inbox" });

    expect(link.dataset.slot).toBe("breadcrumb-link");
    expect([...link.classList]).toStrictEqual(
      expect.arrayContaining(["caller-class", "hover:text-foreground"])
    );
  });

  it("keeps settings rows as list items, in whatever element renders them", () => {
    render(
      <SettingsRows aria-label="Account">
        <SettingsRow>Notifications</SettingsRow>
        <SettingsRow role={undefined}>Signature</SettingsRow>
        <SettingsRow render={<article />}>Disconnect</SettingsRow>
      </SettingsRows>
    );
    const list = screen.getByRole("list", { name: "Account" });
    const rows = screen.getAllByRole("listitem");

    expect(list.dataset.slot).toBe("settings-rows");
    expect(
      rows.map((row) => [row.tagName, row.dataset.slot, row.textContent])
    ).toStrictEqual([
      ["DIV", "settings-row", "Notifications"],
      ["DIV", "settings-row", "Signature"],
      ["ARTICLE", "settings-row", "Disconnect"],
    ]);
  });

  it("names an empty state rendered as a landmark", () => {
    render(<Empty render={<section aria-label="No scheduled mail" />} />);

    expect(
      screen.getByRole("region", { name: "No scheduled mail" }).dataset.slot
    ).toBe("empty");
  });
});

describe("avatar", () => {
  it("shows its fallback without an image, and keeps it when the image fails", async () => {
    const { container } = render(
      <>
        <Avatar data-testid="plain">
          <AvatarFallback>J</AvatarFallback>
        </Avatar>
        <Avatar data-testid="broken" size="lg">
          <AvatarImage alt="" src="https://example.invalid/jane.png" />
          <AvatarFallback>D</AvatarFallback>
        </Avatar>
      </>
    );

    fireEvent.error(getImage(container));
    await act(settle);

    expect(screen.getByTestId("plain").textContent).toBe("J");
    const broken = screen.getByTestId("broken");
    expect(broken.dataset).toMatchObject({
      loadingStatus: "error",
      size: "lg",
    });
    expect(broken.textContent).toBe("D");
  });

  it("replaces its fallback once the image loads", async () => {
    const { container } = render(
      <Avatar data-testid="loaded">
        <AvatarImage alt="" src="https://example.invalid/jane.png" />
        <AvatarFallback>J</AvatarFallback>
      </Avatar>
    );
    const image = getImage(container);

    Object.defineProperty(image, "naturalWidth", { value: 32 });
    fireEvent.load(image);
    await act(settle);

    const avatar = screen.getByTestId("loaded");
    expect(avatar.dataset.loadingStatus).toBe("loaded");
    expect(avatar.textContent).toBe("");
    expect(avatar.querySelector('[data-slot="avatar-image"]')).toBe(image);
  });
});

describe("separator", () => {
  it("is announced with its orientation, and hidden when decorative", () => {
    render(
      <>
        <Separator data-testid="rule" />
        <ButtonGroupSeparator data-testid="divider" />
        <Separator data-testid="line" decorative />
      </>
    );

    expect(describeLine("rule")).toStrictEqual([
      "separator",
      "horizontal",
      "horizontal",
    ]);
    expect(describeLine("divider")).toStrictEqual([
      "separator",
      "vertical",
      "vertical",
    ]);
    expect(describeLine("line")).toStrictEqual(["none", null, "horizontal"]);
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });
});

describe("spinner", () => {
  it("stays out of the way of the text beside it", () => {
    render(
      <>
        <Button>
          <Spinner />
          Download
        </Button>
        <Spinner aria-label="Closing" />
      </>
    );

    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    const status = screen.getByRole("status", { name: "Closing" });
    expect(status.hasAttribute("aria-hidden")).toBeFalsy();
    expect(screen.getAllByRole("status")).toStrictEqual([status]);
  });
});

describe("agent", () => {
  it("finds every control by name and skips the decorative sender avatar", async () => {
    const onSelect = vi.fn<(version: CleanDraftVersion) => void>();
    render(
      <>
        <MailMessageParticipants
          fallbackRecipient="me@example.com"
          message={message}
        />
        <ButtonGroup aria-label="Reply actions">
          <Button>Shorten</Button>
          <Button>Proofread</Button>
        </ButtonGroup>
        <CleanDraftHistoryStrip
          disabled={false}
          onDismiss={() => null}
          onSelect={onSelect}
          selectedVersionId="original"
          versions={versions}
        />
      </>
    );
    await act(settle);

    const entries = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more");
    expect(entries.filter((entry) => !entry.label)).toStrictEqual([]);
    expect(entries.map((entry) => entry.label)).toStrictEqual([
      "Copy jane@example.com",
      "Copy me@example.com",
      "Shorten",
      "Proofread",
      "Use Original draft",
      "Use #1 Clean draft",
      "Dismiss #1 Clean draft",
      "Draft version",
      "Draft history",
    ]);
    expect(
      screen.getByRole("group", { name: "Reply actions" }).dataset.slot
    ).toBe("button-group");

    const result = await agent.act({
      steps: [
        { action: "setPressed", args: [true], ref: "Use #1 Clean draft" },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    expect(onSelect).toHaveBeenCalledWith(versions[1]);
  });
});
