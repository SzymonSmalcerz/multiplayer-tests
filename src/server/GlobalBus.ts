/**
 * GlobalBus — process-wide singleton that bridges all active GameRoom instances.
 *
 * Responsibilities:
 *  - Cross-room chat relay: a message sent in room A is broadcast to every other room.
 *  - Global leaderboard: every 3 s collect all players from every room, sort, and
 *    broadcast the top-5 list to every room so clients can render a global ranking.
 */

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
}

class GlobalBus {
  private rooms             = new Map<string, RoomHandle>();
  private leaderboardTimer: ReturnType<typeof setInterval> | null = null;

  // ── Room registration ────────────────────────────────────────────────────────

  registerRoom(roomId: string, handle: RoomHandle): void {
    this.rooms.set(roomId, handle);
    if (!this.leaderboardTimer) {
      this.leaderboardTimer = setInterval(() => this.broadcastLeaderboard(), 3000);
    }
  }

  unregisterRoom(roomId: string): void {
    this.rooms.delete(roomId);
    if (this.rooms.size === 0 && this.leaderboardTimer) {
      clearInterval(this.leaderboardTimer);
      this.leaderboardTimer = null;
    }
  }

  // ── Cross-room chat ──────────────────────────────────────────────────────────

  /**
   * Relay a chat payload to every room except the one that originally sent it.
   * The source room already broadcast to its own clients.
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

  private broadcastLeaderboard(): void {
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

    this.rooms.forEach((handle) => {
      handle.broadcastFn("global_leaderboard", top5);
    });
  }
}

/** Singleton — import this from any GameRoom to access the shared bus. */
export const globalBus = new GlobalBus();
