// ─── Pure quiz geometry ───────────────────────────────────────────────────────
// No Phaser or Colyseus dependencies — imported by both server and client.

export const QUIZ_PAD_OFFSET_X = 130;  // px left/right of map centre
export const QUIZ_PAD_OFFSET_Y = 105;  // px above/below map centre
export const QUIZ_HIT_HALF_W   = 100;  // half-width of answer zone
export const QUIZ_HIT_HALF_H   = 75;   // half-height of answer zone

/** Returns world-space positions of the four answer pads (A=0 … D=3). */
export function getAnswerPadPositions(
  mapWidth: number,
  mapHeight: number,
): [{ x: number; y: number }, { x: number; y: number },
    { x: number; y: number }, { x: number; y: number }] {
  const cx = mapWidth  / 2;
  const cy = mapHeight / 2;
  return [
    { x: cx - QUIZ_PAD_OFFSET_X, y: cy - QUIZ_PAD_OFFSET_Y }, // A top-left
    { x: cx + QUIZ_PAD_OFFSET_X, y: cy - QUIZ_PAD_OFFSET_Y }, // B top-right
    { x: cx - QUIZ_PAD_OFFSET_X, y: cy + QUIZ_PAD_OFFSET_Y }, // C bottom-left
    { x: cx + QUIZ_PAD_OFFSET_X, y: cy + QUIZ_PAD_OFFSET_Y }, // D bottom-right
  ];
}

/** Returns true if (px, py) is inside the answer zone centred at (padX, padY). */
export function isPlayerOnPad(
  px: number, py: number,
  padX: number, padY: number,
): boolean {
  return Math.abs(px - padX) <= QUIZ_HIT_HALF_W &&
         Math.abs(py - padY) <= QUIZ_HIT_HALF_H;
}
