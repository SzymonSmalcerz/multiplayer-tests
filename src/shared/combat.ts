// ─── Pure combat geometry ─────────────────────────────────────────────────────
// Extracted from GameRoom so these functions can be unit-tested independently.
// No Phaser or Colyseus dependencies.

export interface Hitbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Returns the melee attack rectangle for a 64×64 sprite centred at (cx, cy).
 * `expand` pushes the far (attack) edge outward by that many pixels.
 *
 * Direction encoding: 0 = down, 1 = left, 2 = up, 3 = right.
 */
export function getHitbox(cx: number, cy: number, direction: number, expand = 0): Hitbox {
  switch (direction) {
    case 3: return { x0: cx,                y0: cy - 32, x1: cx + 32 + expand, y1: cy + 32 }; // right
    case 1: return { x0: cx - 32 - expand,  y0: cy - 32, x1: cx,               y1: cy + 32 }; // left
    case 2: return { x0: cx - 32, y0: cy - 32 - expand,  x1: cx + 32,          y1: cy      }; // up
    case 0: return { x0: cx - 32, y0: cy,                x1: cx + 32, y1: cy + 32 + expand }; // down
    default: return { x0: cx,    y0: cy - 32,             x1: cx + 32,          y1: cy + 32 };
  }
}

/**
 * Returns true if (targetX, targetY) falls inside the hitbox of a sprite
 * at (cx, cy) facing `direction`.
 */
export function isInsideHitbox(
  cx: number,
  cy: number,
  direction: number,
  targetX: number,
  targetY: number,
  expand = 0,
): boolean {
  const hb = getHitbox(cx, cy, direction, expand);
  return targetX >= hb.x0 && targetX <= hb.x1 &&
         targetY >= hb.y0 && targetY <= hb.y1;
}
