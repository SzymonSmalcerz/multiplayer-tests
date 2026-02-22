// ─── Pure game logic ──────────────────────────────────────────────────────────
// Extracted from GameScene so it can be unit-tested without Phaser or Colyseus.

// ── XP ────────────────────────────────────────────────────────────────────────

// Single definition lives in src/shared/formulas.ts — re-exported here so
// GameScene and the existing tests keep their current import paths unchanged.
export { xpForNextLevel } from "../shared/formulas";

// ── Minimap ───────────────────────────────────────────────────────────────────

export const MINIMAP_SIZE  = 200;
export const VIEW_RADIUS   = 600;
export const MINIMAP_SCALE = MINIMAP_SIZE / (VIEW_RADIUS * 2); // ≈ 0.1667

/**
 * Convert a world-space offset relative to the local player into a
 * minimap pixel offset relative to the minimap centre dot.
 */
export function worldToMinimapOffset(dx: number, dy: number): { x: number; y: number } {
  return { x: dx * MINIMAP_SCALE, y: dy * MINIMAP_SCALE };
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

/**
 * Sort players by level descending, then by xp descending.
 * Returns a new array — does not mutate the input.
 */
export function sortLeaderboard<T extends { level: number; xp: number }>(players: T[]): T[] {
  return [...players].sort((a, b) =>
    b.level !== a.level ? b.level - a.level : b.xp - a.xp,
  );
}

// ── A* Pathfinding ────────────────────────────────────────────────────────────

/**
 * A* pathfinding on a flat Uint8Array nav-grid (1 = blocked, 0 = open).
 * Supports 8-directional movement.
 *
 * @param grid     Flat array of size cols×rows (row-major order).
 * @param cols     Number of columns.
 * @param rows     Number of rows.
 * @param cellSize World-space size of each cell in pixels.
 * @returns        Ordered list of world-space waypoints, or null if no path.
 */
export function findPath(
  grid: Uint8Array,
  cols: number,
  rows: number,
  cellSize: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number }[] | null {
  if (grid.length === 0) return null;

  const N  = cols * rows;
  const sc = Math.max(0, Math.min(cols - 1, Math.floor(fromX / cellSize)));
  const sr = Math.max(0, Math.min(rows - 1, Math.floor(fromY / cellSize)));
  const tc = Math.max(0, Math.min(cols - 1, Math.floor(toX   / cellSize)));
  const tr = Math.max(0, Math.min(rows - 1, Math.floor(toY   / cellSize)));

  if (grid[tr * cols + tc]) return null;

  const start = sr * cols + sc;
  const goal  = tr * cols + tc;

  if (start === goal) return [{ x: toX, y: toY }];

  const gScore = new Float32Array(N).fill(Infinity);
  const fScore = new Float32Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const inOpen = new Uint8Array(N);
  const closed = new Uint8Array(N);
  const open: number[] = [];

  const h = (c1: number, r1: number): number => {
    const dx = Math.abs(c1 - tc);
    const dy = Math.abs(r1 - tr);
    return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * cellSize;
  };

  gScore[start] = 0;
  fScore[start] = h(sc, sr);
  open.push(start);
  inOpen[start] = 1;

  const DC       = [-1,  0, 1, -1, 1, -1, 0, 1];
  const DR       = [-1, -1,-1,  0, 0,  1, 1, 1];
  const STEPCOST = [
    Math.SQRT2 * cellSize, cellSize, Math.SQRT2 * cellSize,
    cellSize,              cellSize,
    Math.SQRT2 * cellSize, cellSize, Math.SQRT2 * cellSize,
  ];

  while (open.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bestIdx]]) bestIdx = i;
    }
    const cur = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();
    inOpen[cur] = 0;

    if (cur === goal) {
      const path: { x: number; y: number }[] = [];
      let node = goal;
      while (node !== -1) {
        const c = node % cols;
        const r = Math.floor(node / cols);
        path.push({ x: c * cellSize + cellSize / 2, y: r * cellSize + cellSize / 2 });
        node = parent[node];
      }
      path.reverse();
      path[path.length - 1] = { x: toX, y: toY };
      return path;
    }

    closed[cur] = 1;
    const cc = cur % cols;
    const cr = Math.floor(cur / cols);

    for (let i = 0; i < 8; i++) {
      const nc = cc + DC[i];
      const nr = cr + DR[i];
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;

      const nb = nr * cols + nc;
      if (closed[nb] || grid[nb]) continue;

      const tg = gScore[cur] + STEPCOST[i];
      if (tg < gScore[nb]) {
        parent[nb] = cur;
        gScore[nb] = tg;
        fScore[nb] = tg + h(nc, nr);
        if (!inOpen[nb]) {
          open.push(nb);
          inOpen[nb] = 1;
        }
      }
    }
  }

  return null;
}
