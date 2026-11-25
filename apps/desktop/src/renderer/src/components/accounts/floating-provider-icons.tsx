import { AtSignIcon } from "lucide-react";
import {
  m,
  motionValue,
  useAnimate,
  useAnimationFrame,
  useReducedMotionConfig,
} from "motion/react";
import type { MotionValue } from "motion/react";
import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { easeInOut, NO_MOTION } from "@/lib/motion";
import type { AccountProvider } from "@/shared/ipc/accounts";

import AccountProviderIcon from "./account-provider-icon";
import {
  boopBody,
  holdBody,
  releaseBody,
  scatterBodies,
  stepBodies,
} from "./provider-tile-physics";
import type { Body, Point, Rect } from "./provider-tile-physics";

const PROVIDERS: readonly AccountProvider[] = [
  "gmail",
  "icloud",
  "outlook",
  "imap",
];

/** Half the 64px tile, to turn a body's centre into the tile's corner. */
const TILE_HALF = 32;

// Tiles stay out of the top strip, where the macOS traffic lights sit, and
// keep a little clear of the window's other edges and the sign-in block.
const FIELD_TOP_INSET = 48;
const FIELD_INSET = 16;
const BLOCK_MARGIN = 12;

// After a long frame (a hidden window, a busy main thread) the tiles step as
// though only a short one passed, so they never tunnel through each other.
const MAX_STEP_SECONDS = 1 / 30;
const SQUISH_SECONDS = 0.45;

// A press that travels less than this is a boop, not a drag.
const DRAG_THRESHOLD = 4;

// A flick's speed is the pointer's over its last stretch of movement; a
// pointer held still that long before letting go drops the tile instead.
const FLICK_WINDOW_MS = 80;

interface Tile {
  readonly provider: AccountProvider;
  readonly x: MotionValue<number>;
  readonly y: MotionValue<number>;
  readonly rotate: MotionValue<number>;
}

interface Sample extends Point {
  readonly time: number;
}

/** The pointer holding a tile, from press to release. */
interface Grab {
  readonly index: number;
  readonly pointerId: number;
  /** From the pointer to the tile's centre, kept as the pointer moves. */
  readonly offset: Point;
  readonly start: Point;
  dragged: boolean;
  samples: Sample[];
}

/** The pointer's speed over its last stretch of movement, in px a second. */
const flickVelocity = (samples: readonly Sample[], now: number): Point => {
  const recent = samples.filter(
    (sample) => now - sample.time <= FLICK_WINDOW_MS
  );

  const first = recent.at(0);
  const last = recent.at(-1);

  if (!first || !last || last.time === first.time) {
    return { x: 0, y: 0 };
  }

  const seconds = (last.time - first.time) / 1000;

  return {
    x: (last.x - first.x) / seconds,
    y: (last.y - first.y) / seconds,
  };
};

interface TileHandlers {
  readonly onPress: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /**
   * Ends the press: a drag flicks the tile, a press that never moved boops
   * it, and a cancelled one just drops it. True when it was a boop.
   */
  readonly onRelease: (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled: boolean
  ) => boolean;
}

const FloatingTile = ({
  handlers,
  placed,
  tile,
}: {
  readonly handlers: TileHandlers | null;
  readonly placed: boolean;
  readonly tile: Tile;
}) => {
  const shouldReduceMotion = useReducedMotionConfig();
  // The squish plays on the logo's own layer so it never fights the tile's
  // position and tilt, which the simulation owns.
  const [logo, animate] = useAnimate<HTMLDivElement>();

  return (
    <m.div
      animate={{ opacity: placed ? 1 : 0 }}
      className="bg-card ring-border/60 pointer-events-auto absolute top-0 left-0 flex size-16 cursor-grab touch-none items-center justify-center rounded-3xl shadow-md ring-1 [-webkit-app-region:no-drag] active:cursor-grabbing"
      initial={{ opacity: 0 }}
      onLostPointerCapture={(event) => {
        handlers?.onRelease(event, true);
      }}
      onPointerDown={(event) => {
        handlers?.onPress(event);
      }}
      onPointerMove={(event) => {
        handlers?.onMove(event);
      }}
      onPointerUp={(event) => {
        if (handlers?.onRelease(event, false)) {
          void animate(
            logo.current,
            { rotate: [0, -14, 10, 0], scale: [1, 0.8, 1.12, 1] },
            easeInOut(SQUISH_SECONDS)
          );
        }
      }}
      style={{ rotate: tile.rotate, x: tile.x, y: tile.y }}
      transition={
        shouldReduceMotion
          ? NO_MOTION
          : { opacity: easeInOut(0.4), scale: easeInOut(0.15) }
      }
      whileHover={{ scale: 1.05 }}
      // Picked up: the tile lifts a little while the pointer holds it.
      whileTap={{ scale: 1.1 }}
    >
      <div className="flex" ref={logo}>
        {tile.provider === "imap" ? (
          <AtSignIcon className="text-muted-foreground size-8" />
        ) : (
          <AccountProviderIcon className="size-8" provider={tile.provider} />
        )}
      </div>
    </m.div>
  );
};

/**
 * The providers Kisa signs in to, floating around the sign-in block: they
 * drift and bounce off each other, the block and the window's edges. A tap
 * boops one away from the pointer; a press grabs one to drag it into the
 * others or flick it across the window. They are a pointer-only toy: hidden
 * from assistive technology and never focusable, since the text names the
 * providers. Narrow windows, where the tiles would crowd the text, leave them
 * out; reduced motion scatters them and holds them still.
 *
 * The block fills this element, so its box is the obstacle and the origin of
 * the simulation; the window, less its insets, is the field.
 */
const FloatingProviderIcons = () => {
  const shouldReduceMotion = useReducedMotionConfig();
  const container = useRef<HTMLDivElement>(null);
  const bodies = useRef<Body[] | null>(null);
  const grab = useRef<Grab | null>(null);
  const [placed, setPlaced] = useState(false);

  const tiles = useMemo(
    () =>
      PROVIDERS.map((provider): Tile => ({
        provider,
        rotate: motionValue(0),
        x: motionValue(0),
        y: motionValue(0),
      })),
    []
  );

  useAnimationFrame((_time, delta) => {
    const box = container.current?.getBoundingClientRect();

    // Hidden in a narrow window: nothing to place or move until it widens.
    if (!box || box.width === 0) {
      return;
    }

    const field: Rect = {
      left: FIELD_INSET - box.left,
      top: FIELD_TOP_INSET - box.top,
      right: window.innerWidth - FIELD_INSET - box.left,
      bottom: window.innerHeight - FIELD_INSET - box.top,
    };

    const block: Rect = {
      left: -BLOCK_MARGIN,
      top: -BLOCK_MARGIN,
      right: box.width + BLOCK_MARGIN,
      bottom: box.height + BLOCK_MARGIN,
    };

    if (bodies.current === null) {
      bodies.current = scatterBodies(tiles.length, field, block);
      setPlaced(true);
    } else if (shouldReduceMotion) {
      return;
    } else {
      stepBodies(
        bodies.current,
        field,
        block,
        Math.min(delta / 1000, MAX_STEP_SECONDS)
      );
    }

    for (const [index, body] of bodies.current.entries()) {
      const tile = tiles[index];
      tile?.x.set(body.x - TILE_HALF);
      tile?.y.set(body.y - TILE_HALF);
      tile?.rotate.set(body.angle);
    }
  });

  /** A pointer event's position in the simulation's coordinates. */
  const pointOf = (event: ReactPointerEvent): Point | null => {
    const box = container.current?.getBoundingClientRect();

    return box
      ? { x: event.clientX - box.left, y: event.clientY - box.top }
      : null;
  };

  const handlersFor = (index: number): TileHandlers => ({
    onPress: (event) => {
      const body = bodies.current?.[index];
      const point = pointOf(event);

      if (!body || !point || grab.current || event.button !== 0) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      grab.current = {
        index,
        pointerId: event.pointerId,
        offset: { x: body.x - point.x, y: body.y - point.y },
        start: point,
        dragged: false,
        samples: [{ ...point, time: event.timeStamp }],
      };
      holdBody(body, body, { x: 0, y: 0 });
    },
    onMove: (event) => {
      const held = grab.current;
      const body = bodies.current?.[index];
      const point = pointOf(event);

      if (!held || held.pointerId !== event.pointerId || !body || !point) {
        return;
      }

      held.dragged ||=
        Math.hypot(point.x - held.start.x, point.y - held.start.y) >
        DRAG_THRESHOLD;
      held.samples = [
        ...held.samples.filter(
          (sample) => event.timeStamp - sample.time <= FLICK_WINDOW_MS
        ),
        { ...point, time: event.timeStamp },
      ];
      holdBody(
        body,
        { x: point.x + held.offset.x, y: point.y + held.offset.y },
        flickVelocity(held.samples, event.timeStamp)
      );
    },
    onRelease: (event, cancelled) => {
      const held = grab.current;
      const body = bodies.current?.[index];

      if (!held || held.pointerId !== event.pointerId || !body) {
        return false;
      }

      grab.current = null;

      if (held.dragged) {
        releaseBody(body, flickVelocity(held.samples, event.timeStamp));

        return false;
      }

      releaseBody(body, { x: 0, y: 0 });
      const point = pointOf(event);

      if (cancelled || !point) {
        return false;
      }

      boopBody(body, point);

      return true;
    },
  });

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 max-lg:hidden"
      ref={container}
    >
      {tiles.map((tile, index) => (
        <FloatingTile
          handlers={shouldReduceMotion ? null : handlersFor(index)}
          key={tile.provider}
          placed={placed}
          tile={tile}
        />
      ))}
    </div>
  );
};

export default FloatingProviderIcons;
