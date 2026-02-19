/**
 * Complete list of all available player skins.
 * Used by the avatar picker (HomeScene) and the Phaser preloader (GameScene).
 * Format: "{gender}/{filename-without-extension}"
 */

const MALE_VARIANTS = [
  "1lvl",
  "5lvl_blond",  "5lvl_bold",  "5lvl_green",  "5lvl_grey",  "5lvl_pink",  "5lvl_white",
  "10lvl_blond", "10lvl_bold", "10lvl_green", "10lvl_grey", "10lvl_pink", "10lvl_white",
  "15lvl_blond", "15lvl_bold", "15lvl_green", "15lvl_grey", "15lvl_pink", "15lvl_white",
  "20lvl_blond", "20lvl_bold", "20lvl_green", "20lvl_grey", "20lvl_pink", "20lvl_white",
  "25lvl_blond", "25lvl_bold", "25lvl_green", "25lvl_grey", "25lvl_pink", "25lvl_white",
  "30lvl_blond", "30lvl_bold", "30lvl_green", "30lvl_grey", "30lvl_pink", "30lvl_white",
  "35lvl_blond", "35lvl_bold", "35lvl_green", "35lvl_grey", "35lvl_pink", "35lvl_white",
];

const FEMALE_VARIANTS = [
  "1lvl",
  "5lvl_black",  "5lvl_blond",  "5lvl_brown",  "5lvl_purple",  "5lvl_red",
  "10lvl_black", "10lvl_blond", "10lvl_brown", "10lvl_purple", "10lvl_red",
  "15lvl_black", "15lvl_blond", "15lvl_brown", "15lvl_purple", "15lvl_red",
  "20lvl_black", "20lvl_blond", "20lvl_brown", "20lvl_purple", "20lvl_red",
  "25lvl_black", "25lvl_blond", "25lvl_brown", "25lvl_purple", "25lvl_red",
  "30lvl_black", "30lvl_blond", "30lvl_brown", "30lvl_purple", "30lvl_red",
  "35lvl_black", "35lvl_blond", "35lvl_brown", "35lvl_purple", "35lvl_red",
];

export const MALE_SKINS  = MALE_VARIANTS.map(v => `male/${v}`);
export const FEMALE_SKINS = FEMALE_VARIANTS.map(v => `female/${v}`);
export const ALL_SKINS   = [...MALE_SKINS, ...FEMALE_SKINS];

// ── Sprite-sheet frame constants ────────────────────────────────────────────
export const FRAME_W  = 64;   // px per frame
export const FRAME_H  = 64;
export const SHEET_W  = 576;  // total spritesheet width
export const SHEET_H  = 256;  // total spritesheet height

/**
 * Row 2 (0-indexed) is the "walk down" row according to the corrected spec.
 * Background-position Y for row 2: -(2 * FRAME_H) = -128 px (at 1x scale)
 */
export const PREVIEW_ROW = 2;
