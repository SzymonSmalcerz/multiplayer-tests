import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";

// ─── Schema ───────────────────────────────────────────────────────────────────

export class PlayerState extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") nickname: string = "";
  @type("string") skin: string = "male/1lvl";
  @type("number") direction: number = 0; // 0=down 1=left 2=up 3=right
}

export class GameState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const MAX_SPEED_PX_PER_S = 300;
const SPEED_TOLERANCE = 1.6; // allow 60% over to absorb lag spikes

const TREE_SPRITES = [
  "tree1", "tree2", "tree3", "tree4", "tree_pink_1", "tree_pink_2",
];

// ─── Shared interfaces ────────────────────────────────────────────────────────

export interface TreeData {
  x: number;
  y: number;
  sprite: string;
}

interface MoveMessage {
  x: number;
  y: number;
  direction: number;
  timestamp: number;
}

interface LastPos {
  x: number;
  y: number;
  time: number;
}

// ─── Room ─────────────────────────────────────────────────────────────────────

export class GameRoom extends Room<GameState> {
  maxClients = 50;

  /** Generated once for the lifetime of this room, sent to every joining player */
  private treeData: TreeData[] = [];

  /** Track the last validated position per session for speed checks */
  private lastPositions = new Map<string, LastPos>();

  onCreate(): void {
    this.setState(new GameState());
    this.setPatchRate(1000 / 20); // 20 Hz state broadcast

    // Generate 100 random trees once
    for (let i = 0; i < 100; i++) {
      this.treeData.push({
        x: 80 + Math.random() * (MAP_WIDTH - 160),
        y: 80 + Math.random() * (MAP_HEIGHT - 160),
        sprite: TREE_SPRITES[Math.floor(Math.random() * TREE_SPRITES.length)],
      });
    }

    // Handle movement messages from clients
    this.onMessage<MoveMessage>("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const now = Date.now();
      const last = this.lastPositions.get(client.sessionId);

      let newX = Number(data.x);
      let newY = Number(data.y);
      const direction = Math.floor(Number(data.direction));

      // Validate inputs are finite numbers
      if (!isFinite(newX) || !isFinite(newY)) return;

      // Speed-hack validation
      if (last) {
        const dtSec = Math.max(0.001, (now - last.time) / 1000);
        const dx = newX - last.x;
        const dy = newY - last.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = MAX_SPEED_PX_PER_S * dtSec * SPEED_TOLERANCE;

        if (dist > maxDist) {
          // Clamp back to the allowed distance
          const ratio = maxDist / dist;
          newX = last.x + dx * ratio;
          newY = last.y + dy * ratio;
        }
      }

      // Clamp to world bounds
      newX = Math.max(32, Math.min(MAP_WIDTH - 32, newX));
      newY = Math.max(32, Math.min(MAP_HEIGHT - 32, newY));

      player.x = newX;
      player.y = newY;
      player.direction = direction >= 0 && direction <= 3 ? direction : 0;

      this.lastPositions.set(client.sessionId, { x: newX, y: newY, time: now });
    });
  }

  onJoin(client: Client, options: { nickname?: string; skin?: string }): void {
    const player = new PlayerState();
    player.x = 100 + Math.random() * (MAP_WIDTH - 200);
    player.y = 100 + Math.random() * (MAP_HEIGHT - 200);
    player.nickname = String(options.nickname ?? "Player").slice(0, 20);
    player.skin = String(options.skin ?? "male/1lvl");

    this.state.players.set(client.sessionId, player);
    this.lastPositions.set(client.sessionId, {
      x: player.x,
      y: player.y,
      time: Date.now(),
    });

    // Send the full map layout to the newly joined player
    client.send("map_data", { trees: this.treeData });

    console.log(`[Room] ${player.nickname} (${client.sessionId}) joined. Players: ${this.state.players.size}`);
  }

  onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const name = player?.nickname ?? client.sessionId;
    this.state.players.delete(client.sessionId);
    this.lastPositions.delete(client.sessionId);
    console.log(`[Room] ${name} left. Players: ${this.state.players.size}`);
  }

  onDispose(): void {
    console.log("[Room] Disposed.");
  }
}
