// ─── Pure economy helpers ─────────────────────────────────────────────────────
// Extracted from GameRoom so gold-split and XP-share logic can be tested.
// No Phaser or Colyseus dependencies.

import { getTotalXp, getLevelAndXpFromTotal } from "./formulas";

export interface PositionedPlayer {
  id: string;
  x: number;
  y: number;
  partyId: string;
}

/**
 * From a list of active (non-dead) players, finds those within `collectRange`
 * of the coin position and tied for nearest (within `epsilon` px of each other).
 *
 * Returns an empty array when no player is close enough.
 */
export function findNearestPlayers(
  coinX: number,
  coinY: number,
  players: PositionedPlayer[],
  collectRange: number,
  epsilon = 1,
): Array<PositionedPlayer & { dist: number }> {
  const candidates = players
    .map(p => ({ ...p, dist: Math.sqrt((p.x - coinX) ** 2 + (p.y - coinY) ** 2) }))
    .filter(c => c.dist <= collectRange);

  if (candidates.length === 0) return [];

  const minDist = Math.min(...candidates.map(c => c.dist));
  return candidates.filter(c => c.dist <= minDist + epsilon);
}

/**
 * Returns the IDs of party members who are alive and within `shareRange` of
 * the event position (enemy kill site or coin drop). Used for both XP and gold
 * party-sharing.
 */
/**
 * Applies the enemy-death penalty to a player: -5% gold (floored), -5% total XP (floored).
 * Gold never goes below 0. XP loss may cause de-leveling.
 * Values vanish — there is no recipient.
 */
export function applyDeathPenalty(
  gold: number,
  level: number,
  xp: number,
): { gold: number; level: number; xp: number } {
  const newGold = Math.max(0, gold - Math.floor(gold * 0.05));
  const totalXp = getTotalXp(level, xp);
  const xpLost  = Math.floor(totalXp * 0.05);
  const { level: newLevel, xp: newXp } = getLevelAndXpFromTotal(Math.max(0, totalXp - xpLost));
  return { gold: newGold, level: newLevel, xp: newXp };
}

export function getShareRecipients(
  eventX: number,
  eventY: number,
  members: Array<{ id: string; x: number; y: number; isDead: boolean }>,
  shareRange: number,
): string[] {
  return members
    .filter(m => !m.isDead)
    .filter(m => Math.sqrt((m.x - eventX) ** 2 + (m.y - eventY) ** 2) <= shareRange)
    .map(m => m.id);
}
