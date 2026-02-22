import { describe, it, expect } from "vitest";
import { findNearestPlayers, getShareRecipients } from "../src/shared/economy";

// ─── findNearestPlayers ───────────────────────────────────────────────────────

describe("findNearestPlayers", () => {
  const coin = { x: 100, y: 100 };
  const range = 20;

  it("returns empty array when no players exist", () => {
    expect(findNearestPlayers(coin.x, coin.y, [], range)).toEqual([]);
  });

  it("returns empty array when all players are outside collect range", () => {
    const players = [
      { id: "a", x: 200, y: 200, partyId: "" },
      { id: "b", x: 300, y: 100, partyId: "" },
    ];
    expect(findNearestPlayers(coin.x, coin.y, players, range)).toHaveLength(0);
  });

  it("returns the single player within range", () => {
    const players = [
      { id: "a", x: 110, y: 100, partyId: "" },  // dist = 10 ✓
      { id: "b", x: 200, y: 200, partyId: "" },  // dist ≈ 141 ✗
    ];
    const result = findNearestPlayers(coin.x, coin.y, players, range);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("when two players are in range, returns only the closer one", () => {
    const players = [
      { id: "near", x: 105, y: 100, partyId: "" },  // dist = 5
      { id: "far",  x: 118, y: 100, partyId: "" },  // dist = 18 (within range but farther)
    ];
    const result = findNearestPlayers(coin.x, coin.y, players, range);
    // minDist = 5, epsilon = 1, so threshold = 6. Only "near" qualifies.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("near");
  });

  it("returns multiple players when they are tied within epsilon of each other", () => {
    // Both at dist ≈ 10, within default epsilon=1 of each other
    const players = [
      { id: "a", x: 110, y: 100, partyId: "" },  // dist = 10
      { id: "b", x: 100, y: 110, partyId: "" },  // dist = 10
    ];
    const result = findNearestPlayers(coin.x, coin.y, players, range);
    expect(result).toHaveLength(2);
  });

  it("respects a custom epsilon to widen the tie-break window", () => {
    const players = [
      { id: "a", x: 106, y: 100, partyId: "" },  // dist = 6
      { id: "b", x: 113, y: 100, partyId: "" },  // dist = 13
    ];
    // default epsilon=1 → only "a"
    expect(findNearestPlayers(coin.x, coin.y, players, range, 1)).toHaveLength(1);
    // epsilon=8 → both qualify (13 ≤ 6 + 8)
    expect(findNearestPlayers(coin.x, coin.y, players, range, 8)).toHaveLength(2);
  });

  it("includes dist on each returned entry", () => {
    const players = [{ id: "a", x: 110, y: 100, partyId: "" }];
    const result = findNearestPlayers(coin.x, coin.y, players, range);
    expect(result[0].dist).toBeCloseTo(10, 5);
  });

  it("player exactly on collect range boundary is included", () => {
    const players = [{ id: "a", x: 120, y: 100, partyId: "" }]; // dist = 20 = range
    expect(findNearestPlayers(coin.x, coin.y, players, range)).toHaveLength(1);
  });

  it("player one pixel outside collect range is excluded", () => {
    const players = [{ id: "a", x: 121, y: 100, partyId: "" }]; // dist = 21 > range
    expect(findNearestPlayers(coin.x, coin.y, players, range)).toHaveLength(0);
  });
});

// ─── getShareRecipients ───────────────────────────────────────────────────────

describe("getShareRecipients", () => {
  const event = { x: 500, y: 500 };
  const range = 640;

  it("returns all members when all are within range and alive", () => {
    const members = [
      { id: "a", x: 500, y: 500, isDead: false },
      { id: "b", x: 600, y: 600, isDead: false },
      { id: "c", x: 400, y: 400, isDead: false },
    ];
    const result = getShareRecipients(event.x, event.y, members, range);
    expect(result).toHaveLength(3);
    expect(result).toContain("a");
    expect(result).toContain("b");
    expect(result).toContain("c");
  });

  it("excludes dead members", () => {
    const members = [
      { id: "alive", x: 500, y: 500, isDead: false },
      { id: "dead",  x: 500, y: 500, isDead: true  },
    ];
    const result = getShareRecipients(event.x, event.y, members, range);
    expect(result).toEqual(["alive"]);
  });

  it("excludes members outside share range", () => {
    const members = [
      { id: "close", x: 500,  y: 500,  isDead: false },  // dist = 0
      { id: "far",   x: 1200, y: 1200, isDead: false },  // dist ≈ 990 > 640
    ];
    const result = getShareRecipients(event.x, event.y, members, range);
    expect(result).toEqual(["close"]);
  });

  it("member exactly on range boundary is included", () => {
    // dist = 640 exactly
    const members = [{ id: "edge", x: 500 + 640, y: 500, isDead: false }];
    const result = getShareRecipients(event.x, event.y, members, range);
    expect(result).toEqual(["edge"]);
  });

  it("member one pixel outside range is excluded", () => {
    const members = [{ id: "just-out", x: 500 + 641, y: 500, isDead: false }];
    const result = getShareRecipients(event.x, event.y, members, range);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty member list", () => {
    expect(getShareRecipients(event.x, event.y, [], range)).toEqual([]);
  });

  it("returns only the alive, in-range subset when mixed conditions apply", () => {
    const members = [
      { id: "ok",       x: 500, y: 500,  isDead: false },
      { id: "dead-far", x: 999, y: 999,  isDead: true  },
      { id: "far-live", x: 1500, y: 500, isDead: false },
    ];
    const result = getShareRecipients(event.x, event.y, members, range);
    expect(result).toEqual(["ok"]);
  });
});
