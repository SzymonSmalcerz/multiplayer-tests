// ─── Shared game formulas ─────────────────────────────────────────────────────
// Used by both the client (logic.ts → GameScene) and the server (GameRoom).
// Keep this file free of Phaser and Colyseus dependencies.

/**
 * XP required to advance from `level` to `level + 1`.
 * Single source of truth — previously duplicated between client and server.
 */
export function xpForNextLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.1, level - 1));
}

export function getTotalXp(level: number, currentXp: number): number {
  let total = currentXp;
  for (let i = 1; i < level; i++) total += xpForNextLevel(i);
  return total;
}

export function getLevelAndXpFromTotal(totalXp: number): { level: number; xp: number } {
  let lvl = 1;
  let xp = totalXp;
  while (xp >= xpForNextLevel(lvl)) { xp -= xpForNextLevel(lvl); lvl++; }
  return { level: lvl, xp };
}
