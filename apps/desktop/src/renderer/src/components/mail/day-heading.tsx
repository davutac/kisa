import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";
import { getPinnedDayHeading } from "@/mail/thread-day-headings";

// The band draws its own top line over its tint, a pixel above its row, where
// it covers the divider of the row before; that divider on the plain
// background would vanish against the tint. So a band takes 31 pixels of its
// row, and the pinned band hides its top line above the list.
const DAY_HEADING_ROW_SHARE = 31;

const bandClassName =
  "text-muted-foreground border-border/60 flex h-8 items-center border-y bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))] px-4 text-xs font-medium select-none";

/** The heading over the first conversation of a day, inside its row. */
export const DayHeading = ({ day }: { readonly day: string }) => (
  // The row's label already carries its date, so screen readers skip the
  // heading, and a grid row holds only cells.
  <div aria-hidden="true" className={cn(bandClassName, "-mt-px")}>
    {day}
  </div>
);

const readDayRows = (scroller: HTMLElement) =>
  [...scroller.querySelectorAll<HTMLElement>('[role="row"][data-day]')].map(
    (row) => ({
      day: row.dataset.day ?? "",
      height: row.offsetHeight,
      // The virtualizer's place for the row, which Motion's layout transform
      // leaves alone.
      top: Number(row.style.top.replace("px", "")),
    })
  );

/**
 * The heading of the day at the top of the list, pinned there while its
 * conversations scroll under it. Rows are positioned absolutely, so a heading
 * inside one can't stick past its own row; this one reads the rendered rows'
 * `data-day` on every scroll and moves itself without a React render.
 */
export const PinnedDayHeading = ({
  revision,
}: {
  /** Changes whenever the rows might have moved without a scroll. */
  readonly revision: unknown;
}) => {
  const bandRef = useRef<HTMLDivElement>(null);
  const [day, setDay] = useState<string>();

  const place = useCallback(() => {
    const band = bandRef.current;
    // The list's own ref attaches after this effect first runs, so the band
    // finds its scroller from where it sits.
    const scroller = band?.closest<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    );

    if (band === null || scroller === null || scroller === undefined) {
      return;
    }

    const grid = scroller.querySelector<HTMLElement>('[role="grid"]');
    const pinned = getPinnedDayHeading(
      readDayRows(scroller),
      scroller.scrollTop - (grid?.offsetTop ?? 0),
      DAY_HEADING_ROW_SHARE
    );

    band.style.transform = `translateY(${pinned?.offset ?? 0}px)`;
    setDay(pinned?.day);
  }, []);

  useLayoutEffect(place, [place, revision]);

  useEffect(() => {
    const scroller = bandRef.current?.closest(
      '[data-slot="scroll-area-viewport"]'
    );

    scroller?.addEventListener("scroll", place, { passive: true });
    return () => scroller?.removeEventListener("scroll", place);
  }, [place]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        bandClassName,
        "sticky -top-px z-20 -mt-px -mb-[31px]",
        day === undefined && "invisible"
      )}
      ref={bandRef}
    >
      {day}
    </div>
  );
};
