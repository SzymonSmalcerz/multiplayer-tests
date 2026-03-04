import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { globalBus, PlayerProfile, QuizQuestion } from "../src/server/GlobalBus";

// Helper to build a minimal RoomHandle for registration
function makeHandle(passcode: string, overrides: Partial<{
  broadcastFn: (type: string, msg: unknown) => void;
  getPlayersFn: () => Array<{ nickname: string; level: number; xp: number; gold: number; kills: number; partyName: string; isDead: boolean }>;
  endSessionFn: () => void;
  sendToPlayerFn: (pid: string, type: string, msg: unknown) => boolean;
}> = {}) {
  return {
    passcode,
    broadcastFn:         overrides.broadcastFn    ?? vi.fn(),
    getPlayersFn:        overrides.getPlayersFn   ?? (() => []),
    endSessionFn:        overrides.endSessionFn   ?? vi.fn(),
    sendToPlayerFn:      overrides.sendToPlayerFn ?? (() => false),
    unstuckPlayerFn:     (_nickname: string) => false,
    getPlayerPositionFn: (_nickname: string) => undefined,
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
  ["T1A", "T1B", "T2A", "T2B", "T3A", "PA1", "SS1", "TT1"].forEach((pc) => {
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

describe("GlobalBus — Party Management", () => {
  it("createParty returns partyId; party exists with owner as sole member", () => {
    globalBus.createSession("PA1", "Party Session", 300);

    const partyId = globalBus.createParty("PA1", "owner1", "Alice");

    expect(partyId).toBe("owner1");
    const party = globalBus.getParty("PA1", partyId);
    expect(party).toBeDefined();
    expect(party!.members.has("owner1")).toBe(true);
    expect(party!.members.size).toBe(1);

    globalBus.destroySession("PA1");
  });

  it("joinParty allows up to 5 total members; 6th call returns false", () => {
    globalBus.createSession("PA1", "Party Session", 300);
    const partyId = globalBus.createParty("PA1", "owner1", "Alice");

    // Join 4 more (total = 5)
    expect(globalBus.joinParty("PA1", partyId, "p2")).toBe(true);
    expect(globalBus.joinParty("PA1", partyId, "p3")).toBe(true);
    expect(globalBus.joinParty("PA1", partyId, "p4")).toBe(true);
    expect(globalBus.joinParty("PA1", partyId, "p5")).toBe(true);
    expect(globalBus.getParty("PA1", partyId)!.members.size).toBe(5);

    // 6th join attempt should fail
    expect(globalBus.joinParty("PA1", partyId, "p6")).toBe(false);
    expect(globalBus.getParty("PA1", partyId)!.members.size).toBe(5);

    globalBus.destroySession("PA1");
  });

  it("leaveParty removes a member; party survives when ≥2 members remain", () => {
    globalBus.createSession("PA1", "Party Session", 300);
    const partyId = globalBus.createParty("PA1", "owner1", "Alice");
    globalBus.joinParty("PA1", partyId, "p2");
    globalBus.joinParty("PA1", partyId, "p3");

    globalBus.leaveParty("PA1", partyId, "p3");

    const party = globalBus.getParty("PA1", partyId);
    expect(party).toBeDefined();
    expect(party!.members.has("p3")).toBe(false);
    expect(party!.members.size).toBe(2);

    globalBus.destroySession("PA1");
  });

  it("leaveParty auto-disbands when member count drops to 1", () => {
    globalBus.createSession("PA1", "Party Session", 300);
    const partyId = globalBus.createParty("PA1", "owner1", "Alice");
    globalBus.joinParty("PA1", partyId, "p2");

    // p2 leaves → only owner1 remains (size=1) → auto-disband
    globalBus.leaveParty("PA1", partyId, "p2");

    expect(globalBus.getParty("PA1", partyId)).toBeUndefined();

    globalBus.destroySession("PA1");
  });

  it("leaveParty auto-disbands when last member leaves (count drops to 0)", () => {
    globalBus.createSession("PA1", "Party Session", 300);
    const partyId = globalBus.createParty("PA1", "owner1", "Alice");

    // Owner leaves a solo party → size drops to 0 → auto-disband
    globalBus.leaveParty("PA1", partyId, "owner1");

    expect(globalBus.getParty("PA1", partyId)).toBeUndefined();

    globalBus.destroySession("PA1");
  });
});

describe("GlobalBus — Session Stages & Quiz", () => {
  it("createSession with questions → getSessionQuestions returns the same array", () => {
    const questions: QuizQuestion[] = [
      { text: "Q1", answers: ["A", "B", "C", "D"], correctIndex: 0, time: 20 },
      { text: "Q2", answers: ["W", "X", "Y", "Z"], correctIndex: 2, time: 15, xp: 100 },
    ];

    globalBus.createSession("SS1", "Quiz Session", 300, questions);

    expect(globalBus.getSessionQuestions("SS1")).toEqual(questions);

    globalBus.destroySession("SS1");
  });

  it("getSessionStage defaults to 'waiting' on a fresh session", () => {
    globalBus.createSession("SS1", "Quiz Session", 300);

    expect(globalBus.getSessionStage("SS1")).toBe("waiting");

    globalBus.destroySession("SS1");
  });

  it("setSessionStage('quiz') → getSessionStage returns 'quiz'", () => {
    globalBus.createSession("SS1", "Quiz Session", 300);

    globalBus.setSessionStage("SS1", "quiz");

    expect(globalBus.getSessionStage("SS1")).toBe("quiz");

    globalBus.destroySession("SS1");
  });

  it("setSessionStage('m1') → getSessionStage returns 'm1'", () => {
    globalBus.createSession("SS1", "Quiz Session", 300);

    globalBus.setSessionStage("SS1", "m1");

    expect(globalBus.getSessionStage("SS1")).toBe("m1");

    globalBus.destroySession("SS1");
  });
});

describe("GlobalBus — Timed Sessions", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("scheduleSessionEnd broadcasts session_timer_start immediately with durationSeconds", () => {
    globalBus.createSession("TT1", "Timed Session", 60);
    const broadcastFn = vi.fn();
    const getPlayersFn = () => [
      { nickname: "Alice", level: 5, xp: 400, gold: 100, kills: 3, partyName: "", isDead: false },
    ];
    globalBus.registerRoom("roomTT1", "TT1", makeHandle("TT1", { broadcastFn, getPlayersFn }));

    globalBus.scheduleSessionEnd("TT1");

    expect(broadcastFn).toHaveBeenCalledWith("session_timer_start", { durationSeconds: 60 });

    globalBus.unregisterRoom("roomTT1");
    globalBus.destroySession("TT1");
  });

  it("broadcasts timer_end with rankings after durationSeconds elapses", () => {
    globalBus.createSession("TT1", "Timed Session", 60);
    const broadcastFn = vi.fn();
    const getPlayersFn = () => [
      { nickname: "Alice", level: 5, xp: 400, gold: 100, kills: 3, partyName: "", isDead: false },
    ];
    const endSessionFn = vi.fn();
    globalBus.registerRoom("roomTT1", "TT1", makeHandle("TT1", { broadcastFn, getPlayersFn, endSessionFn }));

    globalBus.scheduleSessionEnd("TT1");
    broadcastFn.mockClear();

    vi.advanceTimersByTime(60 * 1000);

    const timerEndCall = broadcastFn.mock.calls.find(([type]) => type === "timer_end");
    expect(timerEndCall).toBeDefined();
    expect(timerEndCall![1]).toMatchObject({ rankings: expect.any(Array) });
    expect((timerEndCall![1] as { rankings: unknown[] }).rankings.length).toBeGreaterThan(0);

    globalBus.unregisterRoom("roomTT1");
    // destroySession may be called by the timer — guard before calling
    if (globalBus.isValidSession("TT1")) globalBus.destroySession("TT1");
  });

  it("calls endSessionFn and invalidates session 3 s after timer_end", () => {
    globalBus.createSession("TT1", "Timed Session", 60);
    const endSessionFn = vi.fn();
    const getPlayersFn = () => [
      { nickname: "Alice", level: 5, xp: 400, gold: 100, kills: 3, partyName: "", isDead: false },
    ];
    globalBus.registerRoom("roomTT1", "TT1", makeHandle("TT1", { endSessionFn, getPlayersFn }));

    globalBus.scheduleSessionEnd("TT1");

    vi.advanceTimersByTime(60 * 1000 + 3000);

    expect(endSessionFn).toHaveBeenCalledOnce();
    expect(globalBus.isValidSession("TT1")).toBe(false);

    globalBus.unregisterRoom("roomTT1");
  });
});
