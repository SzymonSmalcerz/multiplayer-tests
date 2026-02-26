/**
 * Player skin system.
 *
 * A player's "skin choice" is their gender + hairstyle, e.g. "male/blond".
 * The actual sprite file displayed depends on their current level — it is
 * resolved at render time via getSkinForLevel().
 *
 * Sprite files on disk follow the pattern:
 *   public/assets/player/{gender}/{tier}lvl_{hairstyle}.png
 */

// ── Hairstyle choices ────────────────────────────────────────────────────────

const MALE_HAIR   = ["blond", "bold", "green", "grey", "pink", "white"] as const;
const FEMALE_HAIR = ["black", "blond", "brown", "purple", "red"]        as const;

/** Skin choices shown in the avatar picker: "male/blond", "male/bold", … */
export const MALE_SKINS   = MALE_HAIR.map(h   => `male/${h}`);
export const FEMALE_SKINS = FEMALE_HAIR.map(h => `female/${h}`);
export const ALL_SKINS    = [...MALE_SKINS, ...FEMALE_SKINS];

// ── Level tiers ──────────────────────────────────────────────────────────────

/** Sprite upgrade thresholds. Levels below 10 use the 5lvl sprite. */
const LEVEL_TIERS = [5, 10, 15, 20, 25, 30, 35] as const;

/**
 * Resolves a skin choice + player level to the actual sprite path.
 *
 * @param skinChoice  e.g. "male/blond"
 * @param level       current player level (1+)
 * @returns           e.g. "male/5lvl_blond" (levels 1-9), "male/10lvl_blond" (10-14), …
 */
export function getSkinForLevel(skinChoice: string, level: number): string {
  const [gender, hairstyle] = skinChoice.split("/");
  let tier = LEVEL_TIERS[0];
  for (const t of LEVEL_TIERS) {
    if (level >= t) tier = t;
    else break;
  }
  return `${gender}/${tier}lvl_${hairstyle}`;
}

/**
 * Returns true if the given level sits at a tier boundary that warrants a
 * sprite swap (i.e. getSkinForLevel would return a different result at
 * level-1 vs level).
 */
export function isTierBoundary(level: number): boolean {
  return (LEVEL_TIERS as readonly number[]).includes(level);
}

// ── Full list of sprite files to preload ─────────────────────────────────────

function buildSkinFiles(): string[] {
  const files: string[] = [];
  for (const tier of LEVEL_TIERS) {
    for (const h of MALE_HAIR)   files.push(`male/${tier}lvl_${h}`);
    for (const h of FEMALE_HAIR) files.push(`female/${tier}lvl_${h}`);
  }
  return files;
}

/** Every actual sprite file — used by GameScene for preloading and animation creation. */
export const SKINS_TO_LOAD = buildSkinFiles();

// ── Sprite-sheet frame constants ─────────────────────────────────────────────

export const FRAME_W  = 64;
export const FRAME_H  = 64;
export const SHEET_W  = 576;
export const SHEET_H  = 256;

/** Row used for avatar picker thumbnail (walk-down row). */
export const PREVIEW_ROW = 2;
