import { describe, it, expect } from "vitest";
import { getTotalXp, getLevelAndXpFromTotal } from "../src/shared/formulas";
import {
  xpForNextLevel,
  worldToMinimapOffset,
  sortLeaderboard,
  findPath,
  MINIMAP_SIZE,
  VIEW_RADIUS,
  MINIMAP_SCALE,
} from "../src/client/logic";

// ── xpForNextLevel ────────────────────────────────────────────────────────────

describe("xpForNextLevel", () => {
  it("level 1 requires exactly 100 XP", () => {
    expect(xpForNextLevel(1)).toBe(100);
  });

  it("level 2 requires more XP than level 1", () => {
    expect(xpForNextLevel(2)).toBeGreaterThan(xpForNextLevel(1));
  });

  it("matches the server formula: floor(100 * 1.1^(level-1))", () => {
    for (let level = 1; level <= 20; level++) {
      expect(xpForNextLevel(level)).toBe(Math.floor(100 * Math.pow(1.1, level - 1)));
    }
  });

  it("is strictly increasing", () => {
    for (let level = 1; level < 20; level++) {
      expect(xpForNextLevel(level + 1)).toBeGreaterThan(xpForNextLevel(level));
    }
  });

  it("returns an integer (floor applied)", () => {
    for (let level = 1; level <= 20; level++) {
      expect(xpForNextLevel(level) % 1).toBe(0);
    }
  });
});

// ── worldToMinimapOffset ──────────────────────────────────────────────────────

describe("worldToMinimapOffset", () => {
  it("MINIMAP_SCALE constant is correct", () => {
    expect(MINIMAP_SCALE).toBeCloseTo(MINIMAP_SIZE / (VIEW_RADIUS * 2));
  });

  it("zero offset stays at minimap centre", () => {
    expect(worldToMinimapOffset(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("VIEW_RADIUS distance maps to exactly half the minimap size", () => {
    const { x } = worldToMinimapOffset(VIEW_RADIUS, 0);
    expect(x).toBeCloseTo(MINIMAP_SIZE / 2);
  });

  it("negative dx maps to negative x offset", () => {
    const { x } = worldToMinimapOffset(-VIEW_RADIUS, 0);
    expect(x).toBeCloseTo(-(MINIMAP_SIZE / 2));
  });

  it("x and y are independent", () => {
    const { x, y } = worldToMinimapOffset(300, 150);
    expect(x).toBeCloseTo(300 * MINIMAP_SCALE);
    expect(y).toBeCloseTo(150 * MINIMAP_SCALE);
  });

  it("a player at VIEW_RADIUS + 1 maps beyond the minimap edge", () => {
    const { x } = worldToMinimapOffset(VIEW_RADIUS + 1, 0);
    expect(x).toBeGreaterThan(MINIMAP_SIZE / 2);
  });
});

// ── sortLeaderboard ───────────────────────────────────────────────────────────

type Player = { nickname: string; level: number; xp: number };

function p(nickname: string, level: number, xp: number): Player {
  return { nickname, level, xp };
}

describe("sortLeaderboard", () => {
  it("sorts by level descending", () => {
    const players = [p("A", 1, 50), p("B", 3, 10), p("C", 2, 80)];
    const result = sortLeaderboard(players);
    expect(result.map((r) => r.nickname)).toEqual(["B", "C", "A"]);
  });

  it("breaks level ties by xp descending", () => {
    const players = [p("A", 2, 30), p("B", 2, 90)];
    const result = sortLeaderboard(players);
    expect(result.map((r) => r.nickname)).toEqual(["B", "A"]);
  });

  it("does not mutate the original array", () => {
    const players = [p("A", 1, 0), p("B", 3, 0)];
    const original = [...players];
    sortLeaderboard(players);
    expect(players).toEqual(original);
  });

  it("handles a single player", () => {
    const players = [p("A", 5, 50)];
    expect(sortLeaderboard(players)).toEqual(players);
  });

  it("handles an empty array", () => {
    expect(sortLeaderboard([])).toEqual([]);
  });

  it("top-5 slice gives the correct leaders out of 8", () => {
    // 8 players with decreasing levels — top 5 should be the first 5
    const players = Array.from({ length: 8 }, (_, i) =>
      p(`P${i}`, 8 - i, 0),
    );
    const top5 = sortLeaderboard(players).slice(0, 5);
    expect(top5.map((r) => r.nickname)).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });
});

// ── findPath ─────────────────────────────────────────────────────────────────

function clearGrid(cols: number, rows: number): Uint8Array {
  return new Uint8Array(cols * rows); // all zeros = open
}

const CELL = 16;

describe("findPath", () => {
  it("returns null for an empty grid", () => {
    expect(findPath(new Uint8Array(0), 0, 0, CELL, 0, 0, 100, 100)).toBeNull();
  });

  it("returns a single waypoint when start and destination are in the same cell", () => {
    const grid = clearGrid(10, 10);
    const path = findPath(grid, 10, 10, CELL, 8, 8, 10, 10);
    expect(path).toHaveLength(1);
    expect(path![0]).toEqual({ x: 10, y: 10 });
  });

  it("finds a path on a fully open grid", () => {
    const grid = clearGrid(10, 10);
    const path = findPath(grid, 10, 10, CELL, 8, 8, 120, 8);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
  });

  it("last waypoint is exactly the requested destination", () => {
    const grid = clearGrid(10, 10);
    const path = findPath(grid, 10, 10, CELL, 8, 8, 120, 8);
    expect(path![path!.length - 1]).toEqual({ x: 120, y: 8 });
  });

  it("returns null when the destination cell is blocked", () => {
    const grid = clearGrid(10, 10);
    grid[5 * 10 + 5] = 1; // block cell at col=5, row=5
    const path = findPath(grid, 10, 10, CELL, 8, 8, 5 * CELL + 1, 5 * CELL + 1);
    expect(path).toBeNull();
  });

  it("navigates around a vertical wall", () => {
    // 7×7 grid; block col=3 for rows 0-5, leaving row 6 open as the gap
    const cols = 7, rows = 7;
    const grid = clearGrid(cols, rows);
    for (let r = 0; r < 6; r++) grid[r * cols + 3] = 1;

    const fromX = 1 * CELL + 8; // left side
    const fromY = 1 * CELL + 8;
    const toX   = 5 * CELL + 8; // right side
    const toY   = 1 * CELL + 8;

    const path = findPath(grid, cols, rows, CELL, fromX, fromY, toX, toY);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: toX, y: toY });
  });

  it("returns null when no path exists (destination fully walled off)", () => {
    const cols = 7, rows = 7;
    const grid = clearGrid(cols, rows);
    // complete vertical wall across the entire grid at col=3
    for (let r = 0; r < rows; r++) grid[r * cols + 3] = 1;

    const path = findPath(grid, cols, rows, CELL, 8, 8, 5 * CELL + 8, 8);
    expect(path).toBeNull();
  });

  it("returns null when the start cell is blocked", () => {
    // 3×3 grid, start cell (0,0) is a wall
    const grid = new Uint8Array([1, 0, 0,  0, 0, 0,  0, 0, 0]);
    const result = findPath(grid, 3, 3, CELL, 0, 0, 20, 20);
    expect(result).toBeNull();
  });

  it("returns path to closest reachable cell when destination is surrounded by walls", () => {
    // 5×5 grid with right column and bottom row walled off
    const grid = new Uint8Array(25).fill(0);
    for (let r = 0; r < 5; r++) grid[r * 5 + 4] = 1;
    for (let c = 0; c < 5; c++) grid[4 * 5 + c] = 1;
    const result = findPath(grid, 5, 5, CELL, 5, 5, 45, 45);
    // Can't reach (4,4) but should return a partial path (not null, not empty)
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
  });

  it("waypoints are ordered from start to destination", () => {
    const grid = clearGrid(10, 10);
    // straight right — x should be non-decreasing
    const path = findPath(grid, 10, 10, CELL, 8, 8, 120, 8)!;
    for (let i = 1; i < path.length; i++) {
      expect(path[i].x).toBeGreaterThanOrEqual(path[i - 1].x);
    }
  });
});

// ── XP Math ───────────────────────────────────────────────────────────────────

describe("XP Math", () => {
  it("getTotalXp level 1 returns currentXp unchanged", () => {
    expect(getTotalXp(1, 50)).toBe(50);
  });

  it("getTotalXp level 2 adds level-1 threshold (100 XP)", () => {
    expect(getTotalXp(2, 10)).toBe(110);
  });

  it("getLevelAndXpFromTotal round-trips correctly", () => {
    expect(getLevelAndXpFromTotal(110)).toEqual({ level: 2, xp: 10 });
  });

  it("getLevelAndXpFromTotal(0) gives level 1 with 0 XP", () => {
    expect(getLevelAndXpFromTotal(0)).toEqual({ level: 1, xp: 0 });
  });

  it("getLevelAndXpFromTotal returns level 1 with 0 xp for negative input", () => {
    const result = getLevelAndXpFromTotal(-500);
    expect(result.level).toBe(1);
    expect(result.xp).toBe(0);
  });
});
