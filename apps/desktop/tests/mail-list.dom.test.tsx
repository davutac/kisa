import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { checkPattern, setPlatform, settle } from "@ui-sdk/core/testing";
import { createAgent } from "@ui-sdk/react/agent";
import { LazyMotion, MotionConfig, domMax } from "motion/react";
import { createRef, useImperativeHandle, useState } from "react";
import type { ReactNode, Ref } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ConfirmDialogProvider } from "../src/renderer/src/components/confirm-dialog";
import MailThreadList from "../src/renderer/src/components/mail/thread-list";
import type { MailThreadListProps } from "../src/renderer/src/components/mail/thread-list";
import { Toaster } from "../src/renderer/src/components/ui/toast";
import { AppHotkeysProvider } from "../src/renderer/src/hotkeys";
import type { ThreadActions } from "../src/renderer/src/mail/use-thread-actions";
import type { ScheduledMailApi } from "../src/renderer/src/platform/desktop";
import { Route as ScheduledRouteDefinition } from "../src/renderer/src/routes/scheduled/route";
import { AccountsProvider } from "../src/renderer/src/state/accounts";
import { LabelsProvider } from "../src/renderer/src/state/labels";
import { useMailboxStore } from "../src/renderer/src/state/mailbox";
import type { MailThreadSummary } from "../src/shared/ipc/mail";
import type { ScheduledMailSummary } from "../src/shared/ipc/scheduled-mail";

// Each conversation row draws its date once per render, so counting dates
// counts row renders.
const dateRenders = new Map<number, number>();

vi.mock(import("../src/renderer/src/components/mail/mail-date"), () => ({
  default: ({ timestamp }: { readonly timestamp: number }) => {
    dateRenders.set(timestamp, (dateRenders.get(timestamp) ?? 0) + 1);
    return <time>{timestamp}</time>;
  },
}));

const SCHEDULED: readonly ScheduledMailSummary[] = ["One", "Two", "Three"].map(
  (subject, index) => ({
    accountId: "ana@example.com",
    attachments: [],
    deliveryState: "scheduled",
    draftId: `draft-${index + 1}`,
    preview: `Preview ${subject}`,
    recipients: ["friend@example.com"],
    revision: 1,
    scheduledAt: new Date(2030, 4, 20 + index, 13).getTime(),
    subject,
  })
);

const scheduledApi: ScheduledMailApi = {
  beginEdit: vi.fn<ScheduledMailApi["beginEdit"]>(() =>
    Promise.resolve({ error: "Not in this test", ok: false })
  ),
  cancelToStash: vi.fn<ScheduledMailApi["cancelToStash"]>(() =>
    Promise.resolve({ data: undefined, ok: true })
  ),
  discard: vi.fn<ScheduledMailApi["discard"]>(() =>
    Promise.resolve({ data: undefined, ok: true })
  ),
  finishEdit: vi.fn<ScheduledMailApi["finishEdit"]>(),
  getAttentionCount: vi.fn<ScheduledMailApi["getAttentionCount"]>(),
  listPage: vi.fn<ScheduledMailApi["listPage"]>(() =>
    Promise.resolve({ data: { items: [...SCHEDULED] }, ok: true })
  ),
  onChanged: vi.fn<ScheduledMailApi["onChanged"]>(() => () => null),
  onOutcome: vi.fn<ScheduledMailApi["onOutcome"]>(() => () => null),
  schedule: vi.fn<ScheduledMailApi["schedule"]>(),
  sendNow: vi.fn<ScheduledMailApi["sendNow"]>(),
};

vi.mock(
  import("../src/renderer/src/platform/desktop"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    getScheduledMailApi: () => scheduledApi,
  })
);

const ROW_HEIGHT = 88;
const LIST_HEIGHT = 800;

type ThreadRef = Pick<MailThreadSummary, "accountId" | "threadId">;

const keyOf = ({ accountId, threadId }: ThreadRef): string =>
  `${accountId}:${threadId}`;

const thread = (
  accountId: string,
  threadId: string,
  subject: string,
  overrides: Partial<MailThreadSummary> = {}
): MailThreadSummary => ({
  accountId,
  attachments: [],
  from: "Ada Lovelace <ada@example.com>",
  hasAttachments: false,
  isUnread: false,
  labels: ["INBOX"],
  latestAt: new Date(2026, 0, 2, 9, 30).getTime(),
  messageCount: 1,
  snippet: `About ${subject}`,
  subject,
  threadId,
  ...overrides,
});

const INBOX = [
  thread("ana@example.com", "t1", "Alpha"),
  thread("ana@example.com", "t2", "Bravo"),
  thread("ana@example.com", "t3", "Charlie"),
  thread("ana@example.com", "t4", "Delta"),
  thread("ana@example.com", "t5", "Echo"),
];

const COLLIDING = [
  thread("ana@example.com", "same", "Lunch"),
  thread("ben@example.com", "same", "Lunch"),
  thread("ana@example.com", "other", "Notes"),
];

interface MailboxHandle {
  prepend: (threads: readonly MailThreadSummary[]) => void;
  remove: (threads: readonly ThreadRef[]) => void;
}

// Actions that do what the app's optimistic actions do to the list: a
// trashed conversation leaves it at once.
const fakeActions = (list: { readonly current: MailboxHandle | null }) => ({
  bulkDeleteForever: vi.fn<ThreadActions["bulkDeleteForever"]>(),
  bulkSetLabel: vi.fn<ThreadActions["bulkSetLabel"]>(),
  bulkSetReadState: vi.fn<ThreadActions["bulkSetReadState"]>(),
  bulkTrash: vi.fn<ThreadActions["bulkTrash"]>((threads) => {
    list.current?.remove(threads);
  }),
  deleteForever: vi.fn<ThreadActions["deleteForever"]>(),
  notSpam: vi.fn<ThreadActions["notSpam"]>(),
  setLabel: vi.fn<ThreadActions["setLabel"]>(),
  toggleRead: vi.fn<ThreadActions["toggleRead"]>(),
  trash: vi.fn<ThreadActions["trash"]>((target) => {
    list.current?.remove([target]);
  }),
});

const Providers = ({
  animated = false,
  children,
}: {
  readonly animated?: boolean;
  readonly children: ReactNode;
}) => (
  <AppHotkeysProvider>
    <ConfirmDialogProvider>
      <AccountsProvider
        accounts={[
          { email: "ana@example.com", provider: "gmail" },
          { email: "ben@example.com", provider: "gmail" },
        ]}
        onReorder={vi.fn<() => Promise<void>>()}
      >
        <LabelsProvider accountIds={[]}>
          <LazyMotion features={domMax}>
            <MotionConfig reducedMotion={animated ? "never" : "always"}>
              {children}
              <Toaster />
            </MotionConfig>
          </LazyMotion>
        </LabelsProvider>
      </AccountsProvider>
    </ConfirmDialogProvider>
  </AppHotkeysProvider>
);

const Mailbox = ({
  handle,
  initial,
  ...props
}: Omit<MailThreadListProps, "threads"> & {
  readonly handle: Ref<MailboxHandle>;
  readonly initial: readonly MailThreadSummary[];
}) => {
  const [threads, setThreads] = useState(initial);
  useImperativeHandle(handle, () => ({
    prepend: (added) => {
      setThreads((current) => [...added, ...current]);
    },
    remove: (removed) => {
      const gone = new Set(removed.map(keyOf));
      setThreads((current) => current.filter((item) => !gone.has(keyOf(item))));
    },
  }));
  return <MailThreadList threads={threads} {...props} />;
};

const renderMailbox = async (
  initial: readonly MailThreadSummary[] = INBOX,
  props: Partial<MailThreadListProps> = {},
  animated = false
) => {
  const handle = createRef<MailboxHandle>();
  const actions = fakeActions(handle);
  render(
    <Providers animated={animated}>
      <Mailbox
        actions={actions}
        emptyMessage="Nothing here"
        handle={handle}
        initial={initial}
        isInitialLoading={false}
        scrollResetKey="inbox"
        {...props}
      />
    </Providers>
  );
  await act(settle);
  return { actions, handle };
};

const ScheduledRoute = ScheduledRouteDefinition.options.component;

const renderScheduled = async (animated = false) => {
  if (ScheduledRoute === undefined) {
    throw new Error("The Scheduled route has no component");
  }
  render(
    <Providers animated={animated}>
      <ScheduledRoute />
    </Providers>
  );
  await act(settle);
  await act(settle);
};

const store = () => useMailboxStore.getState();

const KEYS = {
  ArrowDown: "{ArrowDown}",
  ArrowLeft: "{ArrowLeft}",
  ArrowRight: "{ArrowRight}",
  ArrowUp: "{ArrowUp}",
  Enter: "{Enter}",
  Escape: "{Escape}",
  Space: "[Space]",
  Tab: "{Tab}",
} as const;

const isNamedKey = (key: string): key is keyof typeof KEYS => key in KEYS;

// Presses keys the way a person does, so a focused button turns Enter into a
// click as the browser does.
const press = async (
  key: string,
  { metaKey = false, shiftKey = false } = {},
  times = 1
) => {
  const user = userEvent.setup({ document, skipHover: true });
  const name = (isNamedKey(key) ? KEYS[key] : key).repeat(times);
  const held = `${metaKey ? "{Meta>}" : ""}${shiftKey ? "{Shift>}" : ""}`;
  const released = `${shiftKey ? "{/Shift}" : ""}${metaKey ? "{/Meta}" : ""}`;
  await act(async () => {
    await user.keyboard(`${held}${name}${released}`);
    await settle();
  });
};

// The open control: the full-row button named after its conversation.
const openControl = (subject: string): HTMLElement =>
  screen.getByRole("button", { name: new RegExp(`^${subject},`, "u") });

const region = (name: string): HTMLElement =>
  screen.getByRole("region", { name });

const rowElementOf = (subject: string): HTMLElement => {
  const row = openControl(subject).closest<HTMLElement>('[role="row"]');
  if (row === null) {
    throw new Error(`No row for ${subject}`);
  }
  return row;
};

const topOf = (subject: string): number =>
  Number(rowElementOf(subject).style.top.replace("px", ""));

const focusedName = (): string | null =>
  document.activeElement?.getAttribute("aria-label") ?? null;

// jsdom lays nothing out: rows stack ROW_HEIGHT apart in a list
// LIST_HEIGHT tall, and the row under a point is the one at its height. A
// row whose subject is in `tallRows` measures TALL_ROW_HEIGHT.
const TALL_ROW_HEIGHT = 200;
const tallRows = new Set<string>();

const heightOf = (element: Element): number => {
  if (element.tagName === "SECTION") {
    return LIST_HEIGHT;
  }
  if (element.getAttribute("role") !== "row") {
    return 0;
  }
  const subject = element
    .querySelector('[data-slot="mail-list-open"]')
    ?.getAttribute("aria-label")
    ?.split(",")[0];
  return subject !== undefined && tallRows.has(subject)
    ? TALL_ROW_HEIGHT
    : ROW_HEIGHT;
};

const getBoundingClientRect = function getBoundingClientRect(
  this: Element
): DOMRect {
  return DOMRect.fromRect({ height: heightOf(this), width: 600, x: 0, y: 0 });
};

const rowsOnScreen = (): HTMLElement[] =>
  screen
    .queryAllByRole("button")
    .filter((element) => element.dataset.slot === "mail-list-open");

const elementsAtHeight = (_x: number, y: number): Element[] => {
  const row = rowsOnScreen()[Math.floor(y / ROW_HEIGHT)];
  return row === undefined ? [] : [row];
};

// jsdom neither scrolls nor keeps a scroll position.
const scrollTops = new WeakMap<Element, number>();
const scrollBehaviors: (ScrollBehavior | undefined)[] = [];

const scrollTo = function scrollTo(
  this: HTMLElement,
  options?: ScrollToOptions
): void {
  if (options?.top !== undefined) {
    scrollBehaviors.push(options.behavior);
    this.scrollTop = options.top;
  }
};

const ignore = (): void => {
  // A test needs no pointer capture.
};

const originalRect = Element.prototype.getBoundingClientRect;

const pointer = (
  type: "pointerdown" | "pointermove" | "pointerup",
  target: Element | Document,
  y: number
) => {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      cancelable: true,
      clientX: 40,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
    })
  );
};

const drag = async (from: HTMLElement, [start = 0, ...moves]: number[]) => {
  await act(async () => {
    pointer("pointerdown", from, start);
    await settle();
  });
  for (const y of moves) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each move lands before the next, as a pointer's do.
    await act(async () => {
      pointer("pointermove", document, y);
      await settle();
    });
  }
  await act(async () => {
    pointer("pointerup", document, moves.at(-1) ?? start);
    fireEvent.click(from, { detail: 1 });
    await settle();
  });
};

// At most rows 1 and 2, the rows that lose and gain mailbox focus, each
// once. React Compiler, in the app, can skip even their dates.
const twoRowsAtMost = (renders: Record<string, number>): boolean =>
  Object.entries(renders).every(
    ([row, count]) => ["1", "2"].includes(row) && count === 1
  );

let approve = false;
const agent = createAgent({ allow: (step) => !step.confirm || approve });

const onPage = () =>
  agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== "more");

describe("mail lists", () => {
  beforeAll(() => {
    setPlatform("apple");
    for (const name of ["clientHeight", "offsetHeight"] as const) {
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement) {
          return heightOf(this);
        },
      });
    }
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get(this: HTMLElement) {
        return scrollTops.get(this) ?? 0;
      },
      set(this: HTMLElement, top: number) {
        scrollTops.set(this, Math.max(0, top));
        this.dispatchEvent(new Event("scroll"));
      },
    });
    Object.defineProperty(Element.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    Element.prototype.getBoundingClientRect = getBoundingClientRect;
    Element.prototype.setPointerCapture = ignore;
    Element.prototype.releasePointerCapture = ignore;
  });

  beforeEach(() => {
    approve = false;
    dateRenders.clear();
    tallRows.clear();
    scrollBehaviors.length = 0;
    useMailboxStore.setState({
      checkedThreadIds: new Set(),
      openThreadId: null,
      selectedThreadId: null,
    });
    document.elementsFromPoint = elementsAtHeight;
  });

  afterEach(() => {
    document.elementsFromPoint = () => [];
  });

  afterAll(() => {
    setPlatform("other");
    for (const name of ["clientHeight", "offsetHeight", "scrollTop"]) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
    Element.prototype.getBoundingClientRect = originalRect;
  });

  describe("mailbox keyboard", () => {
    it("moves mailbox focus with J, K and the arrows", async () => {
      await renderMailbox();
      const seen: (string | null)[] = [];
      for (const key of ["j", "j", "ArrowDown", "k", "ArrowUp", "ArrowUp"]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each press finishes before the next.
        await press(key);
        seen.push(store().selectedThreadId);
      }
      expect(seen).toStrictEqual(
        [0, 1, 2, 1, 0, 0].map((index) => keyOf(INBOX[index]))
      );
    });

    it("moves mailbox focus with Tab and Shift+Tab", async () => {
      await renderMailbox();
      await press("j");
      await press("Tab");
      const afterTab = store().selectedThreadId;
      await press("Tab", { shiftKey: true });
      expect([afterTab, store().selectedThreadId]).toStrictEqual([
        keyOf(INBOX[1]),
        keyOf(INBOX[0]),
      ]);
    });

    it("toggles the focused conversation with X and clears with Escape", async () => {
      await renderMailbox();
      await press("j", {}, 2);
      await press("x");
      const checked = [...store().checkedThreadIds];
      await press("x");
      const unchecked = store().checkedThreadIds.size;
      await press("x");
      await press("Escape");
      expect({
        checked,
        cleared: store().checkedThreadIds.size,
        selected: store().selectedThreadId,
        unchecked,
      }).toStrictEqual({
        checked: [keyOf(INBOX[1])],
        cleared: 0,
        selected: null,
        unchecked: 0,
      });
    });

    it("opens the focused conversation with Enter, but not while some are checked", async () => {
      await renderMailbox();
      await press("j", {}, 2);
      await press("x");
      await press("Enter");
      const whileChecked = {
        checked: [...store().checkedThreadIds],
        open: store().openThreadId,
      };
      await press("x");
      await press("Enter");
      expect({ open: store().openThreadId, whileChecked }).toStrictEqual({
        open: keyOf(INBOX[1]),
        whileChecked: { checked: [keyOf(INBOX[1])], open: null },
      });
    });

    it("moves mailbox focus to the row that takes the trashed one's place", async () => {
      const { actions } = await renderMailbox();
      await press("j", {}, 2);
      await press("d", { metaKey: true });
      const replacement = store().selectedThreadId;
      await press("j", {}, INBOX.length);
      await press("d", { metaKey: true });
      expect({
        atEnd: store().selectedThreadId,
        replacement,
        trashed: actions.trash.mock.calls.map(([target]) => keyOf(target)),
      }).toStrictEqual({
        atEnd: keyOf(INBOX[3]),
        replacement: keyOf(INBOX[2]),
        trashed: [keyOf(INBOX[1]), keyOf(INBOX[4])],
      });
    });
  });

  describe("mailbox focus", () => {
    it("moves focus with mailbox focus and keeps one tab stop in the list", async () => {
      await renderMailbox();
      await press("j", {}, 2);
      const focused = document.activeElement;
      await press("ArrowDown");
      expect({
        afterArrow: document.activeElement,
        current: openControl("Charlie").getAttribute("aria-current"),
        focused,
        others: openControl("Bravo").getAttribute("aria-current"),
        tabStops: INBOX.map((item) =>
          openControl(item.subject).getAttribute("tabindex")
        ),
      }).toStrictEqual({
        afterArrow: openControl("Charlie"),
        current: "true",
        focused: openControl("Bravo"),
        others: null,
        tabStops: ["-1", "-1", "0", "-1", "-1"],
      });
    });

    it("steps from a row to its quick actions with Right, and back with Left", async () => {
      await renderMailbox();
      await press("j");
      const visited: (string | null)[] = [];
      for (const key of [
        "ArrowRight",
        "ArrowRight",
        "ArrowRight",
        "ArrowLeft",
        "ArrowLeft",
      ]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each press finishes before the next.
        await press(key);
        visited.push(focusedName());
      }
      expect(visited).toStrictEqual([
        "Mark Alpha as unread",
        "Trash Alpha",
        "Trash Alpha",
        "Mark Alpha as unread",
        expect.stringMatching(/^Alpha,/u),
      ]);
    });

    it("swaps Left and Right in a right-to-left layout", async () => {
      await renderMailbox();
      await press("j");
      document.documentElement.dir = "rtl";
      await press("ArrowLeft");
      document.documentElement.dir = "";
      expect(focusedName()).toBe("Mark Alpha as unread");
    });

    it("moves focus to the conversation that takes a trashed one's place", async () => {
      await renderMailbox();
      await press("j", {}, 2);
      await press("d", { metaKey: true });
      await act(settle);
      expect({
        current: openControl("Charlie").getAttribute("aria-current"),
        focused: document.activeElement,
      }).toStrictEqual({ current: "true", focused: openControl("Charlie") });
    });

    it("moves focus to the replacement while the trashed row fades out", async () => {
      await renderMailbox(INBOX, {}, true);
      await press("j", {}, 2);
      await press("d", { metaKey: true });
      expect(document.activeElement).toBe(openControl("Charlie"));
      await waitFor(() => {
        expect(
          screen.queryAllByRole("button", { name: /^Bravo,/u })
        ).toHaveLength(0);
      });
    });

    it("returns focus to the list itself on Escape", async () => {
      await renderMailbox();
      await press("j");
      await press("Escape");
      expect({
        current: openControl("Alpha").getAttribute("aria-current"),
        focused: document.activeElement,
      }).toStrictEqual({ current: null, focused: region("Inbox") });
    });

    it("checks the focused conversation with Space on its checkbox", async () => {
      await renderMailbox();
      await press("j");
      act(() => {
        screen.getByRole("checkbox", { name: "Select Alpha" }).focus();
      });
      await press("Space");
      const checked = {
        ids: [...store().checkedThreadIds],
        row: rowElementOf("Alpha").getAttribute("aria-selected"),
      };
      await press("Space");
      expect({ checked, cleared: store().checkedThreadIds.size }).toStrictEqual(
        {
          checked: { ids: [keyOf(INBOX[0])], row: "true" },
          cleared: 0,
        }
      );
    });

    it("keeps the list out of reach while a conversation is read over it", async () => {
      await renderMailbox();
      const before = region("Inbox").hasAttribute("inert");
      act(() => {
        store().openThread(keyOf(INBOX[1]));
      });
      expect({
        after: screen
          .getByRole("region", { hidden: true, name: "Inbox" })
          .hasAttribute("inert"),
        before,
      }).toStrictEqual({ after: true, before: false });
    });
  });

  describe("mailbox pointer", () => {
    it("opens a conversation on click, and checks it instead while others are checked", async () => {
      await renderMailbox();
      fireEvent.click(openControl("Charlie"), { detail: 1 });
      const opened = store().openThreadId;
      act(() => {
        store().closeThread();
        store().checkThread(keyOf(INBOX[0]), true);
      });
      fireEvent.click(openControl("Delta"), { detail: 1 });
      expect({
        checked: [...store().checkedThreadIds].toSorted(),
        open: store().openThreadId,
        opened,
        selected: store().selectedThreadId,
      }).toStrictEqual({
        checked: [keyOf(INBOX[0]), keyOf(INBOX[3])],
        open: null,
        opened: keyOf(INBOX[2]),
        selected: keyOf(INBOX[3]),
      });
    });

    it("keeps a press that moves less than 15 pixels a click", async () => {
      await renderMailbox();
      await drag(openControl("Bravo"), [ROW_HEIGHT + 10, ROW_HEIGHT + 24]);
      expect({
        checked: store().checkedThreadIds.size,
        open: store().openThreadId,
      }).toStrictEqual({ checked: 0, open: keyOf(INBOX[1]) });
    });

    it("paints a row that a press drags just past the tolerance, without opening it", async () => {
      await renderMailbox();
      await drag(openControl("Bravo"), [ROW_HEIGHT + 10, ROW_HEIGHT + 26]);
      expect({
        checked: [...store().checkedThreadIds],
        open: store().openThreadId,
      }).toStrictEqual({ checked: [keyOf(INBOX[1])], open: null });
    });

    it("paints checked state across the rows a drag crosses, and restores rows on the way back", async () => {
      await renderMailbox();
      const checkedAt = async (y: number) => {
        await act(async () => {
          pointer("pointermove", document, y);
          await settle();
        });
        return [...store().checkedThreadIds].toSorted();
      };
      const from = openControl("Bravo");
      const y = ROW_HEIGHT + 10;
      await act(async () => {
        pointer("pointerdown", from, y);
        await settle();
      });
      const started = await checkedAt(y + 16);
      const crossed = await checkedAt(y + ROW_HEIGHT * 2);
      const reversed = await checkedAt(y + ROW_HEIGHT);
      await act(async () => {
        pointer("pointerup", document, y + ROW_HEIGHT);
        fireEvent.click(from, { detail: 1 });
        await settle();
      });
      expect({
        crossed,
        open: store().openThreadId,
        reversed,
        selected: store().selectedThreadId,
        started,
      }).toStrictEqual({
        crossed: [INBOX[1], INBOX[2], INBOX[3]].map(keyOf),
        open: null,
        reversed: [INBOX[1], INBOX[2]].map(keyOf),
        selected: keyOf(INBOX[2]),
        started: [keyOf(INBOX[1])],
      });
    });

    it("paints unchecked state when the drag starts on a checked row", async () => {
      await renderMailbox();
      act(() => {
        store().setCheckedThreads(new Set(INBOX.map(keyOf)));
      });
      await drag(openControl("Alpha"), [10, 30, ROW_HEIGHT * 2 + 10]);
      expect([...store().checkedThreadIds].toSorted()).toStrictEqual(
        [INBOX[3], INBOX[4]].map(keyOf)
      );
    });

    it("paints from a checkbox at once and announces the selection", async () => {
      await renderMailbox();
      await press("j");
      await drag(screen.getByRole("checkbox", { name: "Select Alpha" }), [
        10,
        ROW_HEIGHT + 10,
      ]);
      expect({
        checked: [...store().checkedThreadIds].toSorted(),
        open: store().openThreadId,
      }).toStrictEqual({
        checked: [INBOX[0], INBOX[1]].map(keyOf),
        open: null,
      });
      await waitFor(() => {
        expect(
          document.querySelector("[data-ui-sdk-announcer]")?.textContent
        ).toContain("2 conversations selected");
      });
    });
  });

  describe("accounts with colliding thread ids", () => {
    it("keeps each account's row apart in focus, checks and removal", async () => {
      const { actions } = await renderMailbox(COLLIDING, { showAccount: true });
      await press("j", {}, 2);
      const focused = store().selectedThreadId;
      await press("x");
      const checked = [...store().checkedThreadIds];
      await press("Escape");
      await press("j", {}, 2);
      await press("d", { metaKey: true });
      expect({
        checked,
        focused,
        lunchRows: screen.getAllByRole("button", { name: /^Lunch,/u }).length,
        replacement: store().selectedThreadId,
        trashed: actions.trash.mock.calls.map(([target]) => keyOf(target)),
      }).toStrictEqual({
        checked: ["ben@example.com:same"],
        focused: "ben@example.com:same",
        lunchRows: 1,
        replacement: "ana@example.com:other",
        trashed: ["ben@example.com:same"],
      });
    });
  });

  describe("selection bar", () => {
    it("acts on the checked conversations", async () => {
      const { actions } = await renderMailbox();
      await press("j");
      await press("x");
      await press("j");
      await press("x");
      fireEvent.click(
        screen.getByRole("button", {
          name: "Mark selected conversations as read",
        })
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "Move selected conversations to trash",
        })
      );
      await act(settle);
      expect({
        checked: store().checkedThreadIds.size,
        read: actions.bulkSetReadState.mock.calls,
        trashed: actions.bulkTrash.mock.calls,
      }).toStrictEqual({
        checked: 0,
        read: [[[INBOX[0], INBOX[1]], false]],
        trashed: [[[INBOX[0], INBOX[1]]]],
      });
    });

    it("describes each action in a tooltip", async () => {
      await renderMailbox();
      await press("j");
      await press("x");
      await act(settle);
      const described = [
        ["Clear conversation selection", /^Clear selection/u],
        ["Mark selected conversations as read", /^Mark as read$/u],
        ["Mark selected conversations as unread", /^Mark as unread$/u],
        ["Add or remove labels", /^Labels/u],
        ["Move selected conversations to trash", /^Move to trash$/u],
      ] as const;
      expect(
        described.filter(
          ([name, description]) =>
            screen.queryByRole("button", { description, name }) === null
        )
      ).toStrictEqual([]);
      expect(
        screen
          .getByRole("toolbar", { name: "Selected conversation actions" })
          .querySelectorAll("[title]")
      ).toHaveLength(0);
    });

    it("keeps its buttons focusable, for their tooltips, while Delete forever waits for an answer", async () => {
      await renderMailbox([
        thread("ana@example.com", "trashed", "Old", { labels: ["TRASH"] }),
      ]);
      await press("j");
      await press("x");
      fireEvent.click(
        screen.getByRole("button", {
          name: "Permanently delete selected conversations",
        })
      );
      await act(settle);
      const bar = screen.getByRole("toolbar", {
        name: "Selected conversation actions",
      });
      const buttons = [...bar.querySelectorAll("button")];
      expect({
        asking: screen.queryByRole("alertdialog") !== null,
        ariaDisabled: buttons.filter(
          (button) => button.getAttribute("aria-disabled") === "true"
        ).length,
        count: buttons.length,
        nativelyDisabled: buttons.filter((button) => button.disabled).length,
      }).toStrictEqual({
        ariaDisabled: 5,
        asking: true,
        count: 5,
        nativelyDisabled: 0,
      });
    });

    it("opens its label menu with Mod+L", async () => {
      await renderMailbox();
      await press("j");
      await press("x");
      await press("l", { metaKey: true });
      expect(screen.getByRole("menu")).toBeTruthy();
    });

    it("follows the toolbar pattern", async () => {
      await renderMailbox();
      await press("j");
      await press("x");
      await expect(
        checkPattern(
          screen.getByRole("toolbar", {
            name: "Selected conversation actions",
          }),
          "toolbar"
        )
      ).resolves.toBeUndefined();
    });
  });

  describe("mailbox paging", () => {
    const PAGE = Array.from({ length: 40 }, (_, index) =>
      thread("ana@example.com", `page-${index}`, `Page ${index}`)
    );
    const scrollToEnd = async () => {
      await act(async () => {
        region("Inbox").scrollTop = PAGE.length * ROW_HEIGHT - LIST_HEIGHT;
        await settle();
      });
    };

    it("asks for the next page near the end", async () => {
      const loadNextPage = vi.fn<() => Promise<boolean>>(() =>
        Promise.resolve(true)
      );
      await renderMailbox(PAGE, { hasNextPage: true, loadNextPage });
      const atTop = loadNextPage.mock.calls.length;
      await scrollToEnd();
      expect([atTop, loadNextPage.mock.calls.length]).toStrictEqual([0, 1]);
    });

    it("waits for a retry after a failed page", async () => {
      const loadNextPage = vi.fn<() => Promise<boolean>>(() =>
        Promise.resolve(true)
      );
      await renderMailbox(PAGE, {
        hasNextPage: true,
        loadError: "Offline",
        loadNextPage,
        onRetryLoad: vi.fn<() => void>(),
      });
      await scrollToEnd();
      expect({
        loads: loadNextPage.mock.calls.length,
        retry: screen.queryAllByRole("button", { name: "Try again" }).length,
      }).toStrictEqual({ loads: 0, retry: 1 });
    });
  });

  describe("mailbox scroll position", () => {
    const MANY = Array.from({ length: 200 }, (_, index) =>
      thread("ana@example.com", `scroll-${index}`, `Scroll ${index}`)
    );

    it("keeps the rows in view in place when mail arrives above them", async () => {
      const { handle } = await renderMailbox(MANY);
      await act(async () => {
        region("Inbox").scrollTop = 5000;
        await settle();
      });
      await press("j");
      const current = store().selectedThreadId;
      const { scrollTop } = region("Inbox");
      const offset = topOf("Scroll 56") - scrollTop;
      await act(async () => {
        handle.current?.prepend([thread("ana@example.com", "new", "Fresh")]);
        await settle();
      });
      expect({
        current: store().selectedThreadId,
        height: screen.getByRole("grid").style.height,
        offset: topOf("Scroll 56") - region("Inbox").scrollTop,
        scrollTop: region("Inbox").scrollTop,
      }).toStrictEqual({
        current,
        height: `${(MANY.length + 1) * ROW_HEIGHT}px`,
        offset,
        scrollTop: scrollTop + ROW_HEIGHT,
      });
    });

    it("places the rows below a row that measures taller than estimated", async () => {
      tallRows.add("Bravo");
      await renderMailbox();
      expect([topOf("Alpha"), topOf("Bravo"), topOf("Charlie")]).toStrictEqual([
        0,
        ROW_HEIGHT,
        ROW_HEIGHT + TALL_ROW_HEIGHT,
      ]);
    });

    it("keeps the rows in view in place when a row above them measures taller", async () => {
      tallRows.add("Scroll 50");
      await renderMailbox(MANY);
      await act(async () => {
        region("Inbox").scrollTop = 5000;
        await settle();
      });
      expect({
        offset: topOf("Scroll 56") - region("Inbox").scrollTop,
        scrollTop: region("Inbox").scrollTop,
      }).toStrictEqual({
        offset: 56 * ROW_HEIGHT - 5000,
        scrollTop: 5000 + TALL_ROW_HEIGHT - ROW_HEIGHT,
      });
    });

    it("centers ordinary moves smoothly and quick ones at once", async () => {
      let now = 1000;
      const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
      await renderMailbox(MANY);
      scrollBehaviors.length = 0;
      await press("j");
      now += 100;
      await press("j");
      now += 400;
      await press("j");
      clock.mockRestore();
      expect(scrollBehaviors).toStrictEqual(["smooth", "auto", "smooth"]);
    });

    it("shows new mail at the top of a list scrolled to its top", async () => {
      const { handle } = await renderMailbox(MANY);
      await act(async () => {
        handle.current?.prepend([thread("ana@example.com", "new", "Fresh")]);
        await settle();
      });
      expect([region("Inbox").scrollTop, topOf("Fresh")]).toStrictEqual([0, 0]);
    });
  });

  describe("mailbox at scale", () => {
    const MANY = Array.from({ length: 10_000 }, (_, index) =>
      thread("ana@example.com", `bulk-${index}`, `Bulk ${index}`, {
        latestAt: index,
      })
    );

    it("renders only the rows in view and a few past them", async () => {
      await renderMailbox(MANY);
      const rendered = screen.getAllByRole("row").length;
      expect([
        rendered >= LIST_HEIGHT / ROW_HEIGHT,
        rendered <= 30,
      ]).toStrictEqual([true, true]);
    });

    it("re-renders only the rows that gain or lose mailbox focus", async () => {
      await renderMailbox(MANY);
      await press("j", {}, 2);
      dateRenders.clear();
      await press("j");
      const down = Object.fromEntries(dateRenders);
      dateRenders.clear();
      await press("k");
      const up = Object.fromEntries(dateRenders);
      expect({
        down: twoRowsAtMost(down),
        rows: Object.keys(down).length + Object.keys(up).length <= 4,
        up: twoRowsAtMost(up),
      }).toStrictEqual({ down: true, rows: true, up: true });
    });
  });

  describe("agents", () => {
    it("finds every control by a name of its own", async () => {
      await renderMailbox(COLLIDING, { showAccount: true });
      await press("j");
      act(() => {
        store().checkThread("ben@example.com:same", true);
      });
      const labels = onPage().map((entry) => entry.label);
      expect({
        duplicates: labels.filter(
          (label, index) => labels.indexOf(label) !== index
        ),
        rowTrash: screen.getByRole("button", {
          name: "Trash Lunch in ana@example.com",
        }).dataset.agentConfirm,
        listed: [
          "Inbox",
          "Select Lunch in ana@example.com",
          "Mark Lunch in ana@example.com as unread",
          "Trash Lunch in ana@example.com",
          "Move selected conversations to trash",
        ].filter((label) => labels.includes(label)).length,
        unnamed: onPage()
          .filter((entry) => !entry.label)
          .map((entry) => `${entry.component} ${entry.ref}`),
      }).toStrictEqual({
        duplicates: [],
        listed: 5,
        rowTrash: "Moves “Lunch” to Trash",
        unnamed: [],
      });
    });

    it("opens and checks a conversation", async () => {
      await renderMailbox(COLLIDING, { showAccount: true });
      const ambiguous = await agent.act({
        steps: [{ action: "open", args: ["Lunch"], ref: "Inbox" }],
      });
      const opened = await agent.act({
        steps: [{ action: "open", args: ["Notes"], ref: "Inbox" }],
      });
      const open = store().openThreadId;
      act(() => {
        store().closeThread();
      });
      const toggled = await agent.act({
        steps: [
          { action: "toggle", args: ["ben@example.com:same"], ref: "Inbox" },
        ],
      });
      expect({
        ambiguous: ambiguous.error?.message,
        checked: [...store().checkedThreadIds],
        open,
        opened: opened.error?.message,
        toggled: toggled.error?.message,
      }).toStrictEqual({
        ambiguous: expect.stringContaining('"Lunch" names 2 items'),
        checked: ["ben@example.com:same"],
        open: "ana@example.com:other",
        opened: undefined,
        toggled: undefined,
      });
    });

    it("trashes conversations only with a person's approval", async () => {
      const { actions } = await renderMailbox(COLLIDING, { showAccount: true });
      act(() => {
        store().checkThread("ben@example.com:same", true);
      });
      const trash = {
        steps: [
          { action: "press", ref: "Move selected conversations to trash" },
        ],
      };
      const refused = await agent.act(trash);
      const before = actions.bulkTrash.mock.calls.length;
      approve = true;
      const allowed = await agent.act(trash);
      expect({
        allowed: allowed.error?.message,
        before,
        refused: refused.error === undefined,
        trashed: actions.bulkTrash.mock.calls,
      }).toStrictEqual({
        allowed: undefined,
        before: 0,
        refused: false,
        trashed: [[[COLLIDING[1]]]],
      });
    });
  });

  describe("scheduled list", () => {
    beforeEach(() => {
      vi.mocked(scheduledApi.beginEdit).mockClear();
      vi.mocked(scheduledApi.cancelToStash).mockClear();
      vi.mocked(scheduledApi.discard).mockClear();
    });

    it("moves the active row and focus with Tab, J, K and the arrows", async () => {
      await renderScheduled();
      const visited: (string | null)[] = [];
      for (const [key, shiftKey] of [
        ["j", false],
        ["Tab", false],
        ["ArrowDown", false],
        ["k", false],
        ["Tab", true],
      ] as const) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each press finishes before the next.
        await press(key, { shiftKey });
        visited.push(focusedName()?.split(",")[0] ?? null);
      }
      expect({
        current: screen
          .getByRole("button", { name: /^Edit scheduled email: One,/u })
          .getAttribute("aria-current"),
        visited,
      }).toStrictEqual({
        current: "true",
        visited: [
          "Edit scheduled email: One",
          "Edit scheduled email: Two",
          "Edit scheduled email: Three",
          "Edit scheduled email: Two",
          "Edit scheduled email: One",
        ],
      });
    });

    it("opens, cancels and discards the focused scheduled email", async () => {
      await renderScheduled();
      await press("j", {}, 2);
      await press("Enter");
      await press("s", { metaKey: true });
      await act(settle);
      const focusedAfterCancel = focusedName()?.split(",")[0];
      await press("d", { metaKey: true });
      fireEvent.click(
        await screen.findByRole("button", { name: "Discard email" })
      );
      await act(settle);
      expect({
        canceled: vi.mocked(scheduledApi.cancelToStash).mock.calls,
        discarded: vi.mocked(scheduledApi.discard).mock.calls,
        focusedAfterCancel,
        opened: vi.mocked(scheduledApi.beginEdit).mock.calls,
      }).toStrictEqual({
        canceled: [[{ accountId: "ana@example.com", draftId: "draft-2" }]],
        discarded: [[{ accountId: "ana@example.com", draftId: "draft-3" }]],
        focusedAfterCancel: "Edit scheduled email: Three",
        opened: [[{ accountId: "ana@example.com", draftId: "draft-2" }]],
      });
    });

    it("moves focus on while a canceled row fades out, and ignores the row meanwhile", async () => {
      await renderScheduled(true);
      await press("j", {}, 2);
      await press("s", { metaKey: true });
      await act(settle);
      const fading = screen
        .queryAllByRole("row")
        .filter((row) => row.textContent?.includes("Two") === true);
      expect({
        canceled: vi.mocked(scheduledApi.cancelToStash).mock.calls,
        fadingInert: fading.every((row) => row.hasAttribute("inert")),
        focused: focusedName()?.split(",")[0],
      }).toStrictEqual({
        canceled: [[{ accountId: "ana@example.com", draftId: "draft-2" }]],
        fadingInert: true,
        focused: "Edit scheduled email: Three",
      });
      await waitFor(() => {
        expect(
          screen.queryAllByRole("button", {
            name: /^Edit scheduled email: Two,/u,
          })
        ).toHaveLength(0);
      });
    });

    it("clears the active row with Escape and keeps focus in the list", async () => {
      await renderScheduled();
      await press("j");
      await press("Escape");
      await press("x");
      expect({
        checkboxes: screen.queryAllByRole("checkbox").length,
        current: screen
          .getByRole("button", { name: /^Edit scheduled email: One,/u })
          .getAttribute("aria-current"),
        focused: document.activeElement,
      }).toStrictEqual({
        checkboxes: 0,
        current: null,
        focused: region("Scheduled emails"),
      });
    });

    it("names every control and opens an email for an agent", async () => {
      await renderScheduled();
      await press("j");
      const labels = onPage().map((entry) => entry.label);
      const opened = await agent.act({
        steps: [{ action: "open", args: ["Three"], ref: "Scheduled emails" }],
      });
      expect({
        duplicates: labels.filter(
          (label, index) => labels.indexOf(label) !== index
        ),
        opened: opened.error?.message,
        request: vi.mocked(scheduledApi.beginEdit).mock.calls,
      }).toStrictEqual({
        duplicates: [],
        opened: undefined,
        request: [[{ accountId: "ana@example.com", draftId: "draft-3" }]],
      });
    });
  });
});
