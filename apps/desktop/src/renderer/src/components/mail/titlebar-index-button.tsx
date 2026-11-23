import { Button } from "@/components/ui/button";
import {
  Progress,
  ProgressIndicator,
  ProgressRing,
  ProgressTrack,
  ProgressValue,
} from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRemaining } from "@/mail/mail-index-eta";
import { useMailIndexState } from "@/mail/use-mail-index-progress";
import type { MailIndexProgress } from "@/shared/ipc/mail";
import {
  toMailIndexRatio,
  toOverallMailIndexRatio,
} from "@/shared/mail-index-progress";

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const NUMBER_FORMAT = new Intl.NumberFormat();

const formatIndexedMessages = (entry: MailIndexProgress): string =>
  entry.estimatedMessages === undefined || entry.estimatedMessages <= 0
    ? "Checking the mailbox total…"
    : `${NUMBER_FORMAT.format(entry.indexedMessages)} / ~${NUMBER_FORMAT.format(
        entry.estimatedMessages
      )} emails indexed`;

/**
 * Titlebar indicator for the full-account mail index.
 *
 * The per-account avatar ring is easy to miss on a 28px circle, and it says
 * nothing about how far along the work is. This is the honest surface: it only
 * exists while indexing is running, and hovering explains what "running" means
 * for each account rather than leaving a mystery spinner in the chrome.
 */
const TitlebarIndexButton = () => {
  const { accounts: progress, etas } = useMailIndexState();
  const active = progress.filter((entry) => entry.status === "running");

  if (active.length === 0) {
    return null;
  }

  const overall = toOverallMailIndexRatio(active);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // A fixed name, so the moving value is never read as the name; the
          // tooltip, its description, gives each account's share.
          <Button
            aria-label="Indexing mail"
            className="app-titlebar-interactive px-2"
            type="button"
            variant="ghost"
          >
            <Progress
              aria-label="Indexing mail"
              max={1}
              value={overall ?? null}
            >
              <ProgressRing />
              <ProgressValue>{({ text }) => text || "Indexing"}</ProgressValue>
            </Progress>
          </Button>
        }
      />
      {/*
        The base tooltip is `items-center` with `max-w-xs`, which centres every
        line and wraps the counts mid-phrase. A fixed width and `items-start`
        give each account a stable block instead — wide enough that an address
        and its "56% · ~1 h 20 min left" sit on one line without the address
        truncating away to nothing.
      */}
      <TooltipContent
        className="w-88 max-w-none flex-col items-start gap-3 px-3 py-2.5"
        side="bottom"
      >
        <span className="font-medium">Indexing your mail</span>
        <span className="flex w-full flex-col gap-2.5">
          {active.map((entry) => {
            const ratio = toMailIndexRatio(entry);
            const eta = etas.get(entry.accountId);

            return (
              <span
                className="flex w-full flex-col gap-1"
                key={entry.accountId}
              >
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span className="truncate">{entry.accountId}</span>
                  {/*
                    Percentage and remaining time answer different questions —
                    how far in, and how much longer — so both earn their place.
                    The time appears a few seconds late, once enough throughput
                    has been observed to estimate it honestly.
                  */}
                  <span className="shrink-0 tabular-nums opacity-60">
                    {ratio === undefined ? "" : `${Math.round(ratio * 100)}%`}
                    {eta === undefined ? "" : ` · ${formatRemaining(eta)}`}
                  </span>
                </span>
                <Progress
                  aria-hidden="true"
                  aria-label="Indexing progress"
                  max={1}
                  value={ratio ?? 0}
                >
                  <ProgressTrack className="bg-background/20 h-0.5">
                    <ProgressIndicator className="bg-background" />
                  </ProgressTrack>
                </Progress>
                <span className="opacity-60">
                  {formatIndexedMessages(entry)}
                </span>
                <span className="opacity-60">
                  {NUMBER_FORMAT.format(entry.indexedThreads)} conversations
                  checked
                  {entry.oldestIndexedAt === undefined
                    ? ""
                    : ` · back to ${MONTH_FORMAT.format(new Date(entry.oldestIndexedAt))}`}
                </span>
              </span>
            );
          })}
        </span>
        <span className="opacity-60">
          Updating local mail and search. After the complete scan, mail removed
          from the server is cleared locally. You can keep reading while this
          runs.
        </span>
      </TooltipContent>
    </Tooltip>
  );
};

export default TitlebarIndexButton;
