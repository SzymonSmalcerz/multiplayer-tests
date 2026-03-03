import { describe, it, expect } from "vitest";
import {
  getAnswerPadPositions,
  isPlayerOnPad,
  QUIZ_PAD_OFFSET_X,
  QUIZ_PAD_OFFSET_Y,
  QUIZ_HIT_HALF_W,
  QUIZ_HIT_HALF_H,
} from "../src/shared/quiz";

describe("getAnswerPadPositions", () => {
  const [A, B, C, D] = getAnswerPadPositions(2000, 2000);

  it("returns exactly 4 pads", () => {
    expect(getAnswerPadPositions(2000, 2000)).toHaveLength(4);
  });

  it("A and C share the same x (left side)", () => {
    expect(A.x).toBe(C.x);
  });

  it("B and D share the same x (right side)", () => {
    expect(B.x).toBe(D.x);
  });

  it("A and B share the same y (top)", () => {
    expect(A.y).toBe(B.y);
  });

  it("C and D share the same y (bottom)", () => {
    expect(C.y).toBe(D.y);
  });

  it("pad A is at (mapW/2 − 130, mapH/2 − 105) for a 2000×2000 map", () => {
    expect(A.x).toBe(2000 / 2 - QUIZ_PAD_OFFSET_X);
    expect(A.y).toBe(2000 / 2 - QUIZ_PAD_OFFSET_Y);
  });

  it("pad D is at (mapW/2 + 130, mapH/2 + 105) for a 2000×2000 map", () => {
    expect(D.x).toBe(2000 / 2 + QUIZ_PAD_OFFSET_X);
    expect(D.y).toBe(2000 / 2 + QUIZ_PAD_OFFSET_Y);
  });

  it("works for non-square maps (3000×1500)", () => {
    const [a, b, c, d] = getAnswerPadPositions(3000, 1500);
    expect(a.x).toBe(3000 / 2 - QUIZ_PAD_OFFSET_X);
    expect(a.y).toBe(1500 / 2 - QUIZ_PAD_OFFSET_Y);
    expect(b.x).toBe(3000 / 2 + QUIZ_PAD_OFFSET_X);
    expect(b.y).toBe(1500 / 2 - QUIZ_PAD_OFFSET_Y);
    expect(c.x).toBe(3000 / 2 - QUIZ_PAD_OFFSET_X);
    expect(c.y).toBe(1500 / 2 + QUIZ_PAD_OFFSET_Y);
    expect(d.x).toBe(3000 / 2 + QUIZ_PAD_OFFSET_X);
    expect(d.y).toBe(1500 / 2 + QUIZ_PAD_OFFSET_Y);
  });
});

describe("isPlayerOnPad", () => {
  const padX = 1000;
  const padY = 1000;

  it("player exactly on pad centre → true", () => {
    expect(isPlayerOnPad(padX, padY, padX, padY)).toBe(true);
  });

  it("player at the x-boundary (+100) → true (inclusive)", () => {
    expect(isPlayerOnPad(padX + QUIZ_HIT_HALF_W, padY, padX, padY)).toBe(true);
  });

  it("player at x-boundary + 1 → false", () => {
    expect(isPlayerOnPad(padX + QUIZ_HIT_HALF_W + 1, padY, padX, padY)).toBe(false);
  });

  it("player at the y-boundary (+75) → true (inclusive)", () => {
    expect(isPlayerOnPad(padX, padY + QUIZ_HIT_HALF_H, padX, padY)).toBe(true);
  });

  it("player at y-boundary + 1 → false", () => {
    expect(isPlayerOnPad(padX, padY + QUIZ_HIT_HALF_H + 1, padX, padY)).toBe(false);
  });

  it("x in range, y out of range → false", () => {
    expect(isPlayerOnPad(padX + 50, padY + QUIZ_HIT_HALF_H + 1, padX, padY)).toBe(false);
  });

  it("y in range, x out of range → false", () => {
    expect(isPlayerOnPad(padX + QUIZ_HIT_HALF_W + 1, padY + 30, padX, padY)).toBe(false);
  });

  it("negative offset within range → true", () => {
    expect(isPlayerOnPad(padX - QUIZ_HIT_HALF_W, padY - QUIZ_HIT_HALF_H, padX, padY)).toBe(true);
  });

  it("player at exact corner (±100, ±75) → true", () => {
    expect(isPlayerOnPad(padX + QUIZ_HIT_HALF_W, padY + QUIZ_HIT_HALF_H, padX, padY)).toBe(true);
    expect(isPlayerOnPad(padX - QUIZ_HIT_HALF_W, padY + QUIZ_HIT_HALF_H, padX, padY)).toBe(true);
    expect(isPlayerOnPad(padX + QUIZ_HIT_HALF_W, padY - QUIZ_HIT_HALF_H, padX, padY)).toBe(true);
    expect(isPlayerOnPad(padX - QUIZ_HIT_HALF_W, padY - QUIZ_HIT_HALF_H, padX, padY)).toBe(true);
  });
});
