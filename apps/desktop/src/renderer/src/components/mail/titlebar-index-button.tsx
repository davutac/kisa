import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRemaining } from "@/mail/mail-index-eta";
import { useMailIndexState } from "@/mail/use-mail-index-progress";
import type { GmailIndexProgress } from "@/shared/ipc/mail";

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const NUMBER_FORMAT = new Intl.NumberFormat();

/**
 * Gmail's own total is an estimate, and the indexer re-walks a day of overlap
 * on every resume, so the ratio is clamped rather than trusted to stay under 1.
 */
const toRatio = (entry: GmailIndexProgress): number | undefined =>
  entry.estimatedThreads === undefined || entry.estimatedThreads <= 0
    ? undefined
    : Math.min(1, entry.indexedThreads / entry.estimatedThreads);

const toCounts = (entry: GmailIndexProgress): string =>
  entry.estimatedThreads === undefined
    ? `${NUMBER_FORMAT.format(entry.indexedThreads)} conversations`
    : `${NUMBER_FORMAT.format(entry.indexedThreads)} of ~${NUMBER_FORMAT.format(
        entry.estimatedThreads
      )}`;

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
  // Queued counts as active: an account waiting its turn is still work in
  // flight, and hiding it makes the indicator disappear the moment a third
  // account is connected.
  const active = progress.filter(
    (entry) => entry.status === "running" || entry.status === "queued"
  );

  if (active.length === 0) {
    return null;
  }

  const ratios = active
    .map((entry) => toRatio(entry))
    .filter((value): value is number => value !== undefined);
  const overall =
    ratios.length === 0
      ? undefined
      : ratios.reduce((total, value) => total + value, 0) / ratios.length;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-live="polite"
            className="app-titlebar-interactive gap-1.5 px-2"
            type="button"
            variant="ghost"
          >
            <span
              aria-hidden="true"
              className="relative grid size-4 shrink-0 place-items-center"
            >
              <span className="border-muted-foreground/25 absolute inset-0 rounded-full border-2" />
              {/*
                `closest-side` matters: the default `farthest-corner` puts the
                gradient's 100% at the box corner, so the mask stop lands
                outside the circle and the ring renders invisible.
              */}
              <span
                className="absolute inset-0 rounded-full"
                style={{
                  WebkitMask:
                    "radial-gradient(circle closest-side, transparent 60%, black 62%)",
                  background:
                    overall === undefined
                      ? "conic-gradient(currentColor 0deg, currentColor 90deg, transparent 90deg)"
                      : `conic-gradient(currentColor ${overall * 360}deg, transparent 0deg)`,
                  mask: "radial-gradient(circle closest-side, transparent 60%, black 62%)",
                }}
              />
            </span>
            <span className="text-xs tabular-nums">
              {overall === undefined
                ? "Indexing"
                : `${Math.round(overall * 100)}%`}
            </span>
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
            const ratio = toRatio(entry);
            const eta = etas.get(entry.accountId);
            const isQueued = entry.status === "queued";

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
                    {isQueued || ratio === undefined
                      ? ""
                      : `${Math.round(ratio * 100)}%`}
                    {eta === undefined ? "" : ` · ${formatRemaining(eta)}`}
                  </span>
                </span>
                <span className="bg-background/20 h-0.5 w-full overflow-hidden rounded-full">
                  <span
                    className="bg-background block h-full rounded-full"
                    style={{ width: `${(isQueued ? 0 : (ratio ?? 0)) * 100}%` }}
                  />
                </span>
                <span className="opacity-60">
                  {isQueued ? "Waiting its turn" : toCounts(entry)}
                  {isQueued || entry.oldestIndexedAt === undefined
                    ? ""
                    : ` · back to ${MONTH_FORMAT.format(new Date(entry.oldestIndexedAt))}`}
                </span>
              </span>
            );
          })}
        </span>
        <span className="opacity-60">
          You can keep reading while this runs.
        </span>
      </TooltipContent>
    </Tooltip>
  );
};

export default TitlebarIndexButton;
