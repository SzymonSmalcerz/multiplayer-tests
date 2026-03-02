import { describe, it, expect, vi, afterEach } from "vitest";
import { globalBus, PlayerProfile } from "../src/server/GlobalBus";

// Helper to build a minimal RoomHandle for registration
function makeHandle(passcode: string, overrides: Partial<{
  broadcastFn: (type: string, msg: unknown) => void;
  getPlayersFn: () => [];
  endSessionFn: () => void;
  sendToPlayerFn: (pid: string, type: string, msg: unknown) => boolean;
}> = {}) {
  return {
    passcode,
    broadcastFn:    overrides.broadcastFn    ?? vi.fn(),
    getPlayersFn:   overrides.getPlayersFn   ?? (() => []),
    endSessionFn:   overrides.endSessionFn   ?? vi.fn(),
    sendToPlayerFn: overrides.sendToPlayerFn ?? (() => false),
  };
}

const BLANK_PROFILE: PlayerProfile = {
  nickname: "TestUser",
  skin: "male/grey",
  level: 1,
  xp: 0,
  gold: 0,
  hp: 100,
  maxHp: 100,
  weapon: "sword",
  potions: 0,
  potionHealRemaining: 0,
  partyId: "",
  isPartyOwner: false,
  partyName: "",
};

// Use unique passcodes per test to avoid singleton state bleed
afterEach(() => {
  // Clean up any sessions that may not have been destroyed by tests
  ["T1A", "T1B", "T2A", "T2B", "T3A"].forEach((pc) => {
    if (globalBus.isValidSession(pc)) globalBus.destroySession(pc);
  });
});

describe("GlobalBus — session isolation", () => {
  it("party created in session A is not visible from session B", () => {
    globalBus.createSession("T1A", "Room A");
    globalBus.createSession("T1B", "Room B");

    const partyId = globalBus.createParty("T1A", "player1", "Alice");

    expect(globalBus.getParty("T1A", partyId)).toBeDefined();
    expect(globalBus.getParty("T1B", partyId)).toBeUndefined();

    globalBus.destroySession("T1A");
    globalBus.destroySession("T1B");
  });

  it("publishChat only broadcasts to rooms in the same session, excluding the source room", () => {
    globalBus.createSession("T2A", "Session A");
    globalBus.createSession("T2B", "Session B");

    const fnA = vi.fn();
    const fnB = vi.fn();

    globalBus.registerRoom("room2A", "T2A", makeHandle("T2A", { broadcastFn: fnA }));
    globalBus.registerRoom("room2B", "T2B", makeHandle("T2B", { broadcastFn: fnB }));

    // Chat from room2A — should not reach room2B (different session)
    // and should not call fnA for itself (source room excluded)
    globalBus.publishChat(
      { sessionId: "sess1", nickname: "Alice", message: "hi" },
      "room2A",
    );

    expect(fnA).not.toHaveBeenCalled(); // source room excluded
    expect(fnB).not.toHaveBeenCalled(); // different session

    globalBus.unregisterRoom("room2A");
    globalBus.unregisterRoom("room2B");
    globalBus.destroySession("T2A");
    globalBus.destroySession("T2B");
  });

  it("destroySession calls endSessionFn, clears profiles, and invalidates session", () => {
    globalBus.createSession("T3A", "Room C");

    const endFn = vi.fn();
    globalBus.registerRoom("room3A", "T3A", makeHandle("T3A", { endSessionFn: endFn }));

    globalBus.saveProfile("T3A", "user1", { ...BLANK_PROFILE, nickname: "Charlie" });
    expect(globalBus.getProfile("T3A", "user1")).toBeDefined();

    globalBus.destroySession("T3A");

    expect(endFn).toHaveBeenCalledOnce();
    expect(globalBus.getProfile("T3A", "user1")).toBeUndefined();
    expect(globalBus.isValidSession("T3A")).toBe(false);

    // Room still registered in internal map — unregister to keep state clean
    globalBus.unregisterRoom("room3A");
  });
});
