/**
 * GlobalBus — process-wide singleton that bridges all active GameRoom instances.
 * All state is scoped by passcode so separate private sessions are fully isolated.
 */

export interface PlayerProfile {
  nickname: string;
  skin: string;
  level: number;
  xp: number;
  gold: number;
  hp: number;
  maxHp: number;
  weapon: string;
  potions: number;
  potionHealRemaining: number;
  partyId: string;
  isPartyOwner: boolean;
  partyName: string;
}

export interface GlobalParty {
  id: string; // owner's persistentId
  name: string;
  members: Set<string>; // set of persistentIds
}

type BroadcastFn  = (type: string, message: unknown) => void;
type GetPlayersFn = () => Array<{
  nickname:  string;
  level:     number;
  xp:        number;
  partyName: string;
  isDead:    boolean;
}>;

interface RoomHandle {
  passcode:       string;
  broadcastFn:    BroadcastFn;
  getPlayersFn:   GetPlayersFn;
  onPartyUpdate?: (partyId: string) => void;
  /** Try to send a typed message to one specific player (by persistentId). Returns true if found. */
  sendToPlayerFn: (pid: string, type: string, msg: unknown) => boolean;
  /** Broadcasts "session_ended" to all clients and disconnects the room. */
  endSessionFn:   () => void;
}

class GlobalBus {
  private rooms = new Map<string, RoomHandle>();
  private leaderboardTimer: ReturnType<typeof setInterval> | null = null;

  // ── Session registry ─────────────────────────────────────────────────────────
  /** passcode → session metadata */
  private activeSessions = new Map<string, { name: string }>();

  // ── Per-session state ────────────────────────────────────────────────────────
  /** passcode → persistentId → PlayerProfile */
  private profiles = new Map<string, Map<string, PlayerProfile>>();
  /** passcode → partyId (owner persistentId) → GlobalParty */
  private parties  = new Map<string, Map<string, GlobalParty>>();

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private getSessionProfiles(passcode: string): Map<string, PlayerProfile> {
    let m = this.profiles.get(passcode);
    if (!m) { m = new Map(); this.profiles.set(passcode, m); }
    return m;
  }

  private getSessionParties(passcode: string): Map<string, GlobalParty> {
    let m = this.parties.get(passcode);
    if (!m) { m = new Map(); this.parties.set(passcode, m); }
    return m;
  }

  // ── Session lifecycle ────────────────────────────────────────────────────────

  createSession(passcode: string, name: string): void {
    this.activeSessions.set(passcode, { name });
    // Pre-initialize empty maps for this session
    this.profiles.set(passcode, new Map());
    this.parties.set(passcode, new Map());
  }

  destroySession(passcode: string): void {
    // Notify and disconnect every room in this session
    this.rooms.forEach((handle) => {
      if (handle.passcode === passcode) {
        handle.endSessionFn();
      }
    });

    // Purge all session-scoped data
    this.activeSessions.delete(passcode);
    this.profiles.delete(passcode);
    this.parties.delete(passcode);
  }

  isValidSession(passcode: string): boolean {
    return this.activeSessions.has(passcode);
  }

  getSessionName(passcode: string): string {
    return this.activeSessions.get(passcode)?.name ?? "";
  }

  // ── Room registration ────────────────────────────────────────────────────────

  registerRoom(roomId: string, passcode: string, handle: RoomHandle): void {
    this.rooms.set(roomId, { ...handle, passcode });
    if (!this.leaderboardTimer) {
      this.leaderboardTimer = setInterval(() => this.broadcastLeaderboard(), 3000);
    }
    // Broadcast immediately so new rooms get data right away
    this.broadcastLeaderboard();
  }

  unregisterRoom(roomId: string): void {
    this.rooms.delete(roomId);
    if (this.rooms.size === 0 && this.leaderboardTimer) {
      clearInterval(this.leaderboardTimer);
      this.leaderboardTimer = null;
    }
  }

  // ── Profile Management ───────────────────────────────────────────────────────

  getProfile(passcode: string, persistentId: string): PlayerProfile | undefined {
    return this.getSessionProfiles(passcode).get(persistentId);
  }

  saveProfile(passcode: string, persistentId: string, profile: PlayerProfile): void {
    this.getSessionProfiles(passcode).set(persistentId, profile);
  }

  deleteProfile(passcode: string, persistentId: string): void {
    this.getSessionProfiles(passcode).delete(persistentId);
  }

  // ── Party Management ─────────────────────────────────────────────────────────

  getParty(passcode: string, partyId: string): GlobalParty | undefined {
    return this.getSessionParties(passcode).get(partyId);
  }

  createParty(passcode: string, ownerPid: string, ownerNickname: string): string {
    const partyId = ownerPid;
    const name = `${ownerNickname.slice(0, 10)}'s party`;
    this.getSessionParties(passcode).set(partyId, {
      id: partyId,
      name: name,
      members: new Set([ownerPid]),
    });
    this.publishPartyUpdate(passcode, partyId);
    return partyId;
  }

  disbandParty(passcode: string, partyId: string): void {
    this.getSessionParties(passcode).delete(partyId);
    this.publishPartyUpdate(passcode, partyId);
  }

  joinParty(passcode: string, partyId: string, memberPid: string): boolean {
    const party = this.getSessionParties(passcode).get(partyId);
    if (party && party.members.size < 5) {
      party.members.add(memberPid);
      this.publishPartyUpdate(passcode, partyId);
      return true;
    }
    return false;
  }

  leaveParty(passcode: string, partyId: string, memberPid: string): void {
    const party = this.getSessionParties(passcode).get(partyId);
    if (party) {
      party.members.delete(memberPid);
      if (party.members.size <= 1) {
        this.disbandParty(passcode, partyId);
      } else {
        this.publishPartyUpdate(passcode, partyId);
      }
    }
  }

  renameParty(passcode: string, partyId: string, newName: string): void {
    const party = this.getSessionParties(passcode).get(partyId);
    if (party) {
      party.name = newName;
      this.publishPartyUpdate(passcode, partyId);
    }
  }

  private publishPartyUpdate(passcode: string, partyId: string): void {
    this.rooms.forEach((handle) => {
      if (handle.passcode === passcode && handle.onPartyUpdate) {
        handle.onPartyUpdate(partyId);
      }
    });
  }

  /** Force a cross-room roster refresh for an active party (e.g. after live HP sync). */
  refreshParty(passcode: string, partyId: string): void {
    this.publishPartyUpdate(passcode, partyId);
  }

  /**
   * Send a typed message to a specific player identified by persistentId,
   * searching only rooms in the same passcode session.
   */
  sendToPlayer(passcode: string, targetPid: string, type: string, msg: unknown): void {
    for (const handle of this.rooms.values()) {
      if (handle.passcode === passcode) {
        if (handle.sendToPlayerFn(targetPid, type, msg)) return;
      }
    }
  }

  getPartyRoster(passcode: string, partyId: string): Array<{ pid: string; nickname: string; level: number; hp: number; maxHp: number }> {
    const party = this.getSessionParties(passcode).get(partyId);
    if (!party) return [];

    const sessionProfiles = this.getSessionProfiles(passcode);
    const roster: Array<{ pid: string; nickname: string; level: number; hp: number; maxHp: number }> = [];
    party.members.forEach((pid) => {
      const profile = sessionProfiles.get(pid);
      if (profile) {
        roster.push({
          pid,
          nickname: profile.nickname,
          level:    profile.level,
          hp:       profile.hp,
          maxHp:    profile.maxHp,
        });
      } else {
        roster.push({
          pid,
          nickname: "Unknown",
          level:    1,
          hp:       0,
          maxHp:    100,
        });
      }
    });
    return roster;
  }

  // ── Cross-room chat ──────────────────────────────────────────────────────────

  /**
   * Relay a chat payload to every room in the same session except the source.
   */
  publishChat(
    payload: { sessionId: string; nickname: string; message: string },
    sourceRoomId: string,
  ): void {
    const sourceHandle = this.rooms.get(sourceRoomId);
    if (!sourceHandle) return;
    const passcode = sourceHandle.passcode;

    this.rooms.forEach((handle, id) => {
      if (id !== sourceRoomId && handle.passcode === passcode) {
        handle.broadcastFn("chat", payload);
      }
    });
  }

  // ── Per-session leaderboard ──────────────────────────────────────────────────

  broadcastLeaderboard(): void {
    // Group rooms by passcode
    const byPasscode = new Map<string, RoomHandle[]>();
    this.rooms.forEach((handle) => {
      const pc = handle.passcode;
      if (!byPasscode.has(pc)) byPasscode.set(pc, []);
      byPasscode.get(pc)!.push(handle);
    });

    byPasscode.forEach((handles) => {
      const allPlayers: Array<{ nickname: string; level: number; xp: number; partyName: string }> = [];

      for (const handle of handles) {
        for (const p of handle.getPlayersFn()) {
          if (!p.isDead) {
            allPlayers.push({ nickname: p.nickname, level: p.level, xp: p.xp, partyName: p.partyName });
          }
        }
      }

      allPlayers.sort((a, b) => b.level !== a.level ? b.level - a.level : b.xp - a.xp);
      const top5 = allPlayers.slice(0, 5);

      if (top5.length === 0) return;

      for (const handle of handles) {
        handle.broadcastFn("global_leaderboard", top5);
      }
    });
  }
}

/** Singleton — import this from any GameRoom to access the shared bus. */
export const globalBus = new GlobalBus();
