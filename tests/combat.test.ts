import { describe, it, expect } from "vitest";
import { getHitbox, isInsideHitbox } from "../src/shared/combat";

// Direction encoding: 0 = down, 1 = left, 2 = up, 3 = right
// All sprites are 64×64 with the origin at the centre.

describe("getHitbox", () => {
  const cx = 100;
  const cy = 100;

  it("direction 0 (down): extends below the sprite centre", () => {
    const hb = getHitbox(cx, cy, 0);
    expect(hb).toEqual({ x0: 68, y0: 100, x1: 132, y1: 132 });
  });

  it("direction 1 (left): extends to the left of the sprite centre", () => {
    const hb = getHitbox(cx, cy, 1);
    expect(hb).toEqual({ x0: 68, y0: 68, x1: 100, y1: 132 });
  });

  it("direction 2 (up): extends above the sprite centre", () => {
    const hb = getHitbox(cx, cy, 2);
    expect(hb).toEqual({ x0: 68, y0: 68, x1: 132, y1: 100 });
  });

  it("direction 3 (right): extends to the right of the sprite centre", () => {
    const hb = getHitbox(cx, cy, 3);
    expect(hb).toEqual({ x0: 100, y0: 68, x1: 132, y1: 132 });
  });

  it("default (unknown direction): falls back to right-side box", () => {
    const hb = getHitbox(cx, cy, 99);
    expect(hb).toEqual({ x0: 100, y0: 68, x1: 132, y1: 132 });
  });

  it("expand pushes only the far (attack) edge outward for direction 0 (down)", () => {
    const hb = getHitbox(cx, cy, 0, 20);
    // Near edge (y0) unchanged; far edge (y1) pushed down by 20
    expect(hb.y0).toBe(100);
    expect(hb.y1).toBe(152);
    expect(hb.x0).toBe(68);
    expect(hb.x1).toBe(132);
  });

  it("expand pushes only the far (attack) edge outward for direction 3 (right)", () => {
    const hb = getHitbox(cx, cy, 3, 10);
    expect(hb.x0).toBe(100);
    expect(hb.x1).toBe(142);  // 132 + 10
    expect(hb.y0).toBe(68);
    expect(hb.y1).toBe(132);
  });

  it("expand of 0 is identical to no expand argument", () => {
    expect(getHitbox(cx, cy, 2, 0)).toEqual(getHitbox(cx, cy, 2));
  });
});

describe("isInsideHitbox", () => {
  const cx = 200;
  const cy = 200;

  it("returns true when target is squarely inside the down hitbox", () => {
    // Down hitbox: x ∈ [168,232], y ∈ [200,232]
    expect(isInsideHitbox(cx, cy, 0, 200, 216)).toBe(true);
  });

  it("returns false when target is above the down hitbox boundary", () => {
    expect(isInsideHitbox(cx, cy, 0, 200, 199)).toBe(false);
  });

  it("returns true when target is exactly on the hitbox boundary (inclusive)", () => {
    // Right boundary of right hitbox: x1 = cx + 32 = 232
    expect(isInsideHitbox(cx, cy, 3, 232, 200)).toBe(true);
  });

  it("returns false when target is one pixel beyond the hitbox boundary", () => {
    expect(isInsideHitbox(cx, cy, 3, 233, 200)).toBe(false);
  });

  it("returns true inside left hitbox", () => {
    // Left hitbox: x ∈ [168,200], y ∈ [168,232]
    expect(isInsideHitbox(cx, cy, 1, 180, 200)).toBe(true);
  });

  it("returns false outside left hitbox (wrong side)", () => {
    expect(isInsideHitbox(cx, cy, 1, 210, 200)).toBe(false);
  });

  it("expand widens the hitbox so a previously-missing target now hits", () => {
    // Without expand, target at (cx + 40, cy + 16) is outside right hitbox (x1=232)
    expect(isInsideHitbox(cx, cy, 3, 240, 210)).toBe(false);
    // With expand=10, x1 becomes 242 — target at 240 is now inside
    expect(isInsideHitbox(cx, cy, 3, 240, 210, 10)).toBe(true);
  });
});
