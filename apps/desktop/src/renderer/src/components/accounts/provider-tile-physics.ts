/**
 * The little physics behind the sign-in screen's floating provider tiles.
 * Tiles are equal discs that drift at a calm cruising speed, bounce off one
 * another, off the sign-in block they float around and off the window's
 * edges, and take a kick when booped. A tile the pointer holds follows the
 * pointer and shoves the others like an immovable wall; let go, it flies off
 * at the pointer's speed. Bodies are mutated in place: there are only a
 * handful, stepped once a frame.
 */

export interface Body {
  /** Centre, in the sign-in block's coordinates. */
  x: number;
  y: number;
  /** Velocity, in pixels a second. */
  vx: number;
  vy: number;
  /** Tilt in degrees, and how fast it is turning in degrees a second. */
  angle: number;
  spin: number;
  /** Held by the pointer: placed by it rather than by the simulation. */
  held: boolean;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Half a 64px tile, plus a hair so tilted corners don't overlap. */
export const TILE_RADIUS = 34;

const CRUISE_SPEED = 18;

// How quickly a tile's speed settles back to cruising after a kick or a
// slowdown, per second.
const SPEED_SETTLE_RATE = 1.2;

// How much a tile's heading wanders, in radians a second.
const HEADING_WANDER = 0.8;
const RESTITUTION = 0.9;
const BOOP_SPEED = 320;
const BOOP_SPIN = 240;

// A flick faster than this would cross the field before the eye follows it.
const MAX_FLICK_SPEED = 1400;

// A held tile that stops moving stops shoving others almost at once.
const HELD_SPEED_SETTLE_RATE = 12;

// How much of a glancing hit turns into spin.
const SPIN_FROM_GLANCE = 0.6;
const SPIN_SETTLE_RATE = 1.5;
const TILT_SETTLE_RATE = 0.4;

const random = (min: number, max: number) => min + Math.random() * (max - min);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const settle = (rate: number, seconds: number) => 1 - Math.exp(-rate * seconds);

const isClear = (
  x: number,
  y: number,
  block: Rect,
  bodies: readonly Body[]
) => {
  const insideBlock =
    x + TILE_RADIUS > block.left &&
    x - TILE_RADIUS < block.right &&
    y + TILE_RADIUS > block.top &&
    y - TILE_RADIUS < block.bottom;

  return (
    !insideBlock &&
    bodies.every(
      (other) => Math.hypot(other.x - x, other.y - y) > TILE_RADIUS * 2
    )
  );
};

/**
 * Scatters `count` tiles across the field, clear of the block and of each
 * other, each heading off in its own direction. A field too crowded to fit
 * them cleanly still places every tile; the first steps push them apart.
 */
export const scatterBodies = (
  count: number,
  field: Rect,
  block: Rect
): Body[] => {
  const bodies: Body[] = [];

  for (let index = 0; index < count; index += 1) {
    let x = 0;
    let y = 0;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      x = random(field.left + TILE_RADIUS, field.right - TILE_RADIUS);
      y = random(field.top + TILE_RADIUS, field.bottom - TILE_RADIUS);

      if (isClear(x, y, block, bodies)) {
        break;
      }
    }

    const heading = random(0, Math.PI * 2);
    bodies.push({
      x,
      y,
      vx: Math.cos(heading) * CRUISE_SPEED,
      vy: Math.sin(heading) * CRUISE_SPEED,
      angle: random(-10, 10),
      spin: 0,
      held: false,
    });
  }

  return bodies;
};

/** Kicks a tile straight away from `point`, or anywhere when hit dead on. */
export const boopBody = (body: Body, point: Point) => {
  const dx = body.x - point.x;
  const dy = body.y - point.y;

  const angle =
    dx === 0 && dy === 0 ? random(0, Math.PI * 2) : Math.atan2(dy, dx);

  body.vx += Math.cos(angle) * BOOP_SPEED;
  body.vy += Math.sin(angle) * BOOP_SPEED;
  body.spin += Math.random() < 0.5 ? -BOOP_SPIN : BOOP_SPIN;
};

/** Moves a held tile to where the pointer put it, at the pointer's speed. */
export const holdBody = (body: Body, centre: Point, velocity: Point) => {
  body.held = true;
  body.x = centre.x;
  body.y = centre.y;
  body.vx = velocity.x;
  body.vy = velocity.y;
};

/** Lets a held tile go, flying on at `velocity` up to a sane top speed. */
export const releaseBody = (body: Body, velocity: Point) => {
  body.held = false;
  const speed = Math.hypot(velocity.x, velocity.y);
  const scale = speed > MAX_FLICK_SPEED ? MAX_FLICK_SPEED / speed : 1;
  body.vx = velocity.x * scale;
  body.vy = velocity.y * scale;
};

const drift = (body: Body, seconds: number) => {
  body.spin -= body.spin * settle(SPIN_SETTLE_RATE, seconds);
  body.angle += body.spin * seconds;
  body.angle -= body.angle * settle(TILT_SETTLE_RATE, seconds);

  if (body.held) {
    const fade = 1 - settle(HELD_SPEED_SETTLE_RATE, seconds);
    body.vx *= fade;
    body.vy *= fade;

    return;
  }

  const speed = Math.hypot(body.vx, body.vy);

  const heading =
    (speed === 0 ? random(0, Math.PI * 2) : Math.atan2(body.vy, body.vx)) +
    random(-HEADING_WANDER, HEADING_WANDER) * seconds;

  const settled =
    speed + (CRUISE_SPEED - speed) * settle(SPEED_SETTLE_RATE, seconds);

  body.vx = Math.cos(heading) * settled;
  body.vy = Math.sin(heading) * settled;
  body.x += body.vx * seconds;
  body.y += body.vy * seconds;
};

/** Pushes a tile out along `normal` and reflects its velocity off it. */
const bounce = (body: Body, nx: number, ny: number) => {
  const along = body.vx * nx + body.vy * ny;

  if (along >= 0 || body.held) {
    return;
  }

  body.vx -= (1 + RESTITUTION) * along * nx;
  body.vy -= (1 + RESTITUTION) * along * ny;
  // The part of the motion that slid along the surface sets it turning.
  body.spin += (body.vx * -ny + body.vy * nx) * SPIN_FROM_GLANCE;
};

const collideBodies = (a: Body, b: Body) => {
  // A held tile is an immovable wall: the free one takes the whole hit.
  const shareA = a.held ? 0 : 1;
  const shareB = b.held ? 0 : 1;
  const shares = shareA + shareB;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);

  if (shares === 0 || distance >= TILE_RADIUS * 2 || distance === 0) {
    return;
  }

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = TILE_RADIUS * 2 - distance;
  a.x -= (nx * overlap * shareA) / shares;
  a.y -= (ny * overlap * shareA) / shares;
  b.x += (nx * overlap * shareB) / shares;
  b.y += (ny * overlap * shareB) / shares;

  const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;

  if (closing >= 0) {
    return;
  }

  const impulse = (-(1 + RESTITUTION) * closing) / shares;
  a.vx -= impulse * nx * shareA;
  a.vy -= impulse * ny * shareA;
  b.vx += impulse * nx * shareB;
  b.vy += impulse * ny * shareB;

  const glance = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
  a.spin += glance * SPIN_FROM_GLANCE * shareA;
  b.spin -= glance * SPIN_FROM_GLANCE * shareB;
};

/** The side of `block` closest to a point inside it, as an outward normal. */
const nearestExit = (body: Body, block: Rect) => {
  const exits = [
    { gap: body.x - block.left, nx: -1, ny: 0 },
    { gap: block.right - body.x, nx: 1, ny: 0 },
    { gap: body.y - block.top, nx: 0, ny: -1 },
    { gap: block.bottom - body.y, nx: 0, ny: 1 },
  ];

  let [closest] = exits;

  for (const exit of exits) {
    if (exit.gap < closest.gap) {
      closest = exit;
    }
  }

  return closest;
};

/** Keeps a tile out of the sign-in block, bouncing it off the nearest side. */
const collideBlock = (body: Body, block: Rect) => {
  const nearestX = clamp(body.x, block.left, block.right);
  const nearestY = clamp(body.y, block.top, block.bottom);
  const dx = body.x - nearestX;
  const dy = body.y - nearestY;
  const distance = Math.hypot(dx, dy);

  if (distance >= TILE_RADIUS) {
    return;
  }

  if (distance > 0) {
    const nx = dx / distance;
    const ny = dy / distance;
    body.x = nearestX + nx * TILE_RADIUS;
    body.y = nearestY + ny * TILE_RADIUS;
    bounce(body, nx, ny);

    return;
  }

  // The centre got inside: leave by the closest side.
  const exit = nearestExit(body, block);
  body.x += exit.nx * (exit.gap + TILE_RADIUS);
  body.y += exit.ny * (exit.gap + TILE_RADIUS);
  bounce(body, exit.nx, exit.ny);
};

/** Keeps a tile inside the field, bouncing it off whichever edge it met. */
const collideField = (body: Body, field: Rect) => {
  if (body.x - TILE_RADIUS < field.left) {
    body.x = field.left + TILE_RADIUS;
    bounce(body, 1, 0);
  } else if (body.x + TILE_RADIUS > field.right) {
    body.x = field.right - TILE_RADIUS;
    bounce(body, -1, 0);
  }

  if (body.y - TILE_RADIUS < field.top) {
    body.y = field.top + TILE_RADIUS;
    bounce(body, 0, 1);
  } else if (body.y + TILE_RADIUS > field.bottom) {
    body.y = field.bottom - TILE_RADIUS;
    bounce(body, 0, -1);
  }
};

/**
 * Advances every tile by `seconds`, resolving each kind of collision. A held
 * tile is still kept out of the block and inside the window, so dragging it
 * there leaves it at the edge until the pointer comes back.
 */
export const stepBodies = (
  bodies: readonly Body[],
  field: Rect,
  block: Rect,
  seconds: number
) => {
  for (const body of bodies) {
    drift(body, seconds);
  }

  for (let first = 0; first < bodies.length; first += 1) {
    for (let second = first + 1; second < bodies.length; second += 1) {
      collideBodies(bodies[first], bodies[second]);
    }
  }

  for (const body of bodies) {
    collideBlock(body, block);
    // The window's edges come last, so no push leaves a tile off screen.
    collideField(body, field);
  }
};
