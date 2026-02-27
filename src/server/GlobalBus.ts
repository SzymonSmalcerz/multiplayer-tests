/**
 * GlobalBus — process-wide singleton that bridges all active GameRoom instances.
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
  broadcastFn:  BroadcastFn;
  getPlayersFn: GetPlayersFn;
  onPartyUpdate?: (partyId: string) => void;
}

class GlobalBus {
  private rooms             = new Map<string, RoomHandle>();
  private leaderboardTimer: ReturnType<typeof setInterval> | null = null;

  // ── Global State ─────────────────────────────────────────────────────────────
  /** persistentId -> PlayerProfile */
  private profiles = new Map<string, PlayerProfile>();
  /** partyId (owner persistentId) -> GlobalParty */
  private parties  = new Map<string, GlobalParty>();

  // ── Room registration ────────────────────────────────────────────────────────

  registerRoom(roomId: string, handle: RoomHandle): void {
    this.rooms.set(roomId, handle);
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

  getProfile(persistentId: string): PlayerProfile | undefined {
    return this.profiles.get(persistentId);
  }

  saveProfile(persistentId: string, profile: PlayerProfile): void {
    this.profiles.set(persistentId, profile);
  }

  // ── Party Management ─────────────────────────────────────────────────────────

  getParty(partyId: string): GlobalParty | undefined {
    return this.parties.get(partyId);
  }

  createParty(ownerPid: string, ownerNickname: string): string {
    const partyId = ownerPid;
    const name = `${ownerNickname.slice(0, 10)}'s party`;
    this.parties.set(partyId, {
      id: partyId,
      name: name,
      members: new Set([ownerPid]),
    });
    this.publishPartyUpdate(partyId);
    return partyId;
  }

  disbandParty(partyId: string): void {
    this.parties.delete(partyId);
    this.publishPartyUpdate(partyId);
  }

  joinParty(partyId: string, memberPid: string): boolean {
    const party = this.parties.get(partyId);
    if (party && party.members.size < 5) {
      party.members.add(memberPid);
      this.publishPartyUpdate(partyId);
      return true;
    }
    return false;
  }

  leaveParty(partyId: string, memberPid: string): void {
    const party = this.parties.get(partyId);
    if (party) {
      party.members.delete(memberPid);
      if (party.members.size <= 1) {
        this.disbandParty(partyId);
      } else {
        this.publishPartyUpdate(partyId);
      }
    }
  }

  renameParty(partyId: string, newName: string): void {
    const party = this.parties.get(partyId);
    if (party) {
      party.name = newName;
      this.publishPartyUpdate(partyId);
    }
  }

  private publishPartyUpdate(partyId: string): void {
    this.rooms.forEach((handle) => {
      if (handle.onPartyUpdate) {
        handle.onPartyUpdate(partyId);
      }
      handle.broadcastFn("party_update", { partyId });
    });
  }

  getPartyRoster(partyId: string): Array<{ pid: string; nickname: string; level: number; hp: number; maxHp: number }> {
    const party = this.parties.get(partyId);
    if (!party) return [];

    const roster: Array<{ pid: string; nickname: string; level: number; hp: number; maxHp: number }> = [];
    party.members.forEach((pid) => {
      const profile = this.profiles.get(pid);
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
   * Relay a chat payload to every room except the one that originally sent it.
   */
  publishChat(
    payload: { sessionId: string; nickname: string; message: string },
    sourceRoomId: string,
  ): void {
    this.rooms.forEach((handle, id) => {
      if (id !== sourceRoomId) {
        handle.broadcastFn("chat", payload);
      }
    });
  }

  // ── Global leaderboard ───────────────────────────────────────────────────────

  broadcastLeaderboard(): void {
    const allPlayers: Array<{ nickname: string; level: number; xp: number; partyName: string }> = [];

    this.rooms.forEach((handle) => {
      for (const p of handle.getPlayersFn()) {
        if (!p.isDead) {
          allPlayers.push({
            nickname:  p.nickname,
            level:     p.level,
            xp:        p.xp,
            partyName: p.partyName,
          });
        }
      }
    });

    allPlayers.sort((a, b) => b.level !== a.level ? b.level - a.level : b.xp - a.xp);
    const top5 = allPlayers.slice(0, 5);

    // Skip broadcast if empty to prevent overwriting client state during map transitions
    if (top5.length === 0) return;

    this.rooms.forEach((handle) => {
      handle.broadcastFn("global_leaderboard", top5);
    });
  }
}

/** Singleton — import this from any GameRoom to access the shared bus. */
export const globalBus = new GlobalBus();
