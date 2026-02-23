import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import fs   from "fs";
import path from "path";
import { xpForNextLevel }                    from "../shared/formulas";
import { getHitbox, isInsideHitbox }          from "../shared/combat";
import { findNearestPlayers, getShareRecipients, PositionedPlayer } from "../shared/economy";
import { STATIC_OBJECT_REGISTRY }             from "../shared/staticObjects";

// ─── Schema ───────────────────────────────────────────────────────────────────

export class PlayerState extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") nickname: string = "";
  @type("string") skin: string = "male/1lvl";
  @type("number") direction: number = 0;    // 0=down 1=left 2=up 3=right
  @type("boolean") showWeapon: boolean = false;
  @type("number") hp: number = 100;
  @type("number") maxHp: number = 100;
  @type("number") level: number = 1;
  @type("number") xp: number = 0;
  @type("number") attackBonus: number = 0;  // extra DPS added to weapon
  @type("boolean") isAttacking: boolean = false;
  @type("number") attackDirection: number = 0;
  @type("boolean") isDead: boolean = false;
  @type("string")  partyId: string = "";
  @type("boolean") isPartyOwner: boolean = false;
  @type("string")  partyName: string = "";
  @type("number")  gold: number = 0;
  @type("string")  weapon: string = "axe";
}

export class EnemyState extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 0;
  @type("number") maxHp: number = 0;
  @type("number") direction: number = 0;
  @type("boolean") isAttacking: boolean = false;
  @type("number") attackDirection: number = 0;
  @type("boolean") isDead: boolean = false;
}

export class GameState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: EnemyState }) enemies = new MapSchema<EnemyState>();
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAP_WIDTH  = 2000;
const MAP_HEIGHT = 2000;
const MAX_SPEED_PX_PER_S = 300;
const SPEED_TOLERANCE    = 1.6;


// Enemy AI
const ENEMY_AGGRO_RANGE  = 320;  // px  (5 tiles × 64 px) — enemy gives up beyond this
const ENEMY_SPEED        = 100;  // px / s
const ENEMY_ATTACK_RANGE = 48;   // px — enter melee range
const ENEMY_COUNT        = 10;
const ENEMY_RESPAWN_MS   = 10_000;

// "hit" enemy stats
const HIT_ENEMY_HP           = 15;
const HIT_ENEMY_XP           = 100;
const HIT_ENEMY_DAMAGE       = 1;
const HIT_ATTACK_CD_MS       = 200;   // 1 dmg every 0.2 s = 5 DPS
const HIT_ENEMY_GOLD_AMOUNT  = 20;
const HIT_ENEMY_GOLD_CHANCE  = 0.3;   // 30% drop rate

// Player weapon
const AXE_ORBIT_RADIUS      = 15;   // px — matches client orbit radius
const WEAPON_SPRITE_RADIUS  = 33;   // px — bounding-circle radius of the attacking sprite
const WEAPON_HIT_CD_MS      = 1_000; // prevent hitting the same enemy twice in one swing
const PLAYER_ATTACK_ANIM_MS = 1_000; // 1-second orbit animation

/** All purchasable weapons. Key matches schema player.weapon value. */
const WEAPON_DATA: Record<string, { damage: number; cost: number }> = {
  axe:       { damage: 50,  cost: 0   }, // default, not sold
  great_axe: { damage: 100, cost: 200 },
  solid_axe: { damage: 75,  cost: 100 },
};

// ─── Shared interfaces ────────────────────────────────────────────────────────

interface EnemySpawnDef {
  id:          string;   // stable id assigned at load time, e.g. "map_enemy_0"
  type:        string;
  x:           number;   // original spawn X
  y:           number;   // original spawn Y
  respawnTime: number;   // milliseconds (pre-converted from JSON seconds)
}

interface MoveMessage {
  x: number;
  y: number;
  direction: number;
  timestamp: number;
}

interface AttackMessage {
  direction: number;
}

interface LastPos {
  x: number;
  y: number;
  time: number;
}

interface PendingCoin {
  id: string;
  x: number;
  y: number;
  amount: number;
  expiresAt: number;
}

// ─── XP / Levelling ──────────────────────────────────────────────────────────
// xpForNextLevel imported from ../shared/formulas

// ─── Combat helpers ───────────────────────────────────────────────────────────
// getHitbox / isInsideHitbox imported from ../shared/combat

// ─── Room ─────────────────────────────────────────────────────────────────────

export class GameRoom extends Room<GameState> {
  maxClients = 50;

  private objectData: Array<{ type: string; x: number; y: number }> = [];
  private npcData: Array<{ type: string; x: number; y: number }> = [];
  private mobData: Array<Record<string, unknown>> = [];
  private lastPositions = new Map<string, LastPos>();

  // ── Enemy bookkeeping ──────────────────────────────────────────────────────
  private enemyCounter    = 0;
  /** Spawn definitions loaded from the map JSON */
  private enemySpawnDefs: EnemySpawnDef[] = [];
  /** live enemyId → the spawn def it came from (for O(1) death lookup) */
  private enemyDefById    = new Map<string, EnemySpawnDef>();

  // ── Coin bookkeeping ───────────────────────────────────────────────────────
  private coinCounter  = 0;
  private pendingCoins = new Map<string, PendingCoin>();

  /** enemyId → Map<playerId, lastAttackTimestamp> */
  private enemyAttackCooldowns = new Map<string, Map<string, number>>();

  /** playerId → Map<enemyId, lastHitTimestamp> */
  private playerHitCooldowns = new Map<string, Map<string, number>>();

  /** playerId → attack start timestamp (present while the axe is orbiting) */
  private playerAttacks = new Map<string, number>();

  /** Enemies waiting to respawn */
  private respawnQueue: Array<{ def: EnemySpawnDef | null; type: string; spawnAt: number }> = [];

  // ── Party bookkeeping ──────────────────────────────────────────────────────
  /** targetSessionId → inviterSessionId */
  private pendingInvites = new Map<string, string>();
  /** partyId (= owner sessionId) → Set of member sessionIds */
  private partyMembers   = new Map<string, Set<string>>();
  /** partyId → party display name */
  private partyNames     = new Map<string, string>();


  // ──────────────────────────────────────────────────────────────────────────

  onCreate(): void {
    this.setState(new GameState());
    this.setPatchRate(1000 / 20); // 20 Hz state broadcast

    // ── Load fixed objects positions from test.json ─────────────────────────
    const mapFile  = path.resolve(__dirname, "../../public/assets/maps/placement/test.json");
    const mapJson  = JSON.parse(fs.readFileSync(mapFile, "utf-8")) as {
      objects:  Array<{ type: string; x: number; y: number }>;
      npcs?:    Array<{ type: string; x: number; y: number }>;
      mobs?:    Array<Record<string, unknown>>;
      enemies?: Array<{ type: string; x: number; y: number; respawnTime: number }>;
    };
    for (const obj of mapJson.objects) {
      if (STATIC_OBJECT_REGISTRY[obj.type]) {
        this.objectData.push({ type: obj.type, x: obj.x, y: obj.y });
      }
    }
    this.npcData = mapJson.npcs ?? [];
    this.mobData = mapJson.mobs ?? [];

    // ── Spawn enemies from map definition (or fall back to random placement) ──
    const rawEnemies = mapJson.enemies;
    if (rawEnemies && rawEnemies.length > 0) {
      rawEnemies.forEach((e, i) => {
        const def: EnemySpawnDef = {
          id:          `map_enemy_${i}`,
          type:        e.type,
          x:           Number(e.x),
          y:           Number(e.y),
          respawnTime: Number(e.respawnTime) * 1000,
        };
        this.enemySpawnDefs.push(def);
        this.spawnEnemyFromDef(def);
      });
    } else {
      // Legacy fallback for maps without an enemies array
      for (let i = 0; i < ENEMY_COUNT; i++) {
        this.spawnEnemy("hit");
      }
    }

    // ── AI simulation loop (20 Hz) ────────────────────────────────────────────
    this.setSimulationInterval((dt) => this.tickEnemyAI(dt), 50);

    // ── Message handlers ──────────────────────────────────────────────────────

    this.onMessage("get_map", (client) => {
      client.send("map_data", { objects: this.objectData, npcs: this.npcData, mobs: this.mobData });
    });

    this.onMessage("chat", (client, message: string) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !message || message.trim().length === 0) return;
      this.broadcast("chat", {
        sessionId: client.sessionId,
        nickname: player.nickname,
        message: message.slice(0, 100),
      });
    });

    this.onMessage("toggle_weapon", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.showWeapon = !player.showWeapon;
    });

    this.onMessage<MoveMessage>("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      const now  = Date.now();
      const last = this.lastPositions.get(client.sessionId);

      let newX = Number(data.x);
      let newY = Number(data.y);
      const direction = Math.floor(Number(data.direction));

      if (!isFinite(newX) || !isFinite(newY)) return;

      if (last) {
        const dtSec  = Math.max(0.001, (now - last.time) / 1000);
        const dx     = newX - last.x;
        const dy     = newY - last.y;
        const dist   = Math.sqrt(dx * dx + dy * dy);
        const maxDist = MAX_SPEED_PX_PER_S * dtSec * SPEED_TOLERANCE;

        if (dist > maxDist) {
          const ratio = maxDist / dist;
          newX = last.x + dx * ratio;
          newY = last.y + dy * ratio;
        }
      }

      newX = Math.max(32, Math.min(MAP_WIDTH  - 32, newX));
      newY = Math.max(32, Math.min(MAP_HEIGHT - 32, newY));

      player.x         = newX;
      player.y         = newY;
      player.direction = direction >= 0 && direction <= 3 ? direction : 0;

      this.lastPositions.set(client.sessionId, { x: newX, y: newY, time: now });
    });

    // ── Party handlers ────────────────────────────────────────────────────────

    this.onMessage("party_invite", (client, data: { targetId: string }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;

      // Only solo players or party owners may invite
      if (sender.partyId !== "" && !sender.isPartyOwner) return;

      const target = this.state.players.get(data.targetId);
      if (!target || target.partyId !== "") return; // target already in a party

      // If sender already has a party, check it isn't full
      if (sender.partyId !== "") {
        const members = this.partyMembers.get(sender.partyId);
        if (!members || members.size >= 5) return;
      }

      // Do NOT create the party yet — wait for acceptance
      this.pendingInvites.set(data.targetId, client.sessionId);
      const targetClient = this.clients.find(c => c.sessionId === data.targetId);
      if (targetClient) {
        targetClient.send("party_invite", {
          fromId: client.sessionId,
          fromNickname: sender.nickname,
        });
      }
    });

    this.onMessage("party_response", (client, data: { fromId: string; accept: boolean }) => {
      const storedInviterId = this.pendingInvites.get(client.sessionId);
      if (!storedInviterId || storedInviterId !== data.fromId) return;
      this.pendingInvites.delete(client.sessionId);

      if (!data.accept) return;

      const inviter = this.state.players.get(data.fromId);
      const joiner  = this.state.players.get(client.sessionId);
      if (!inviter || !joiner) return;

      // Inviter must still be solo or still the party owner
      if (inviter.partyId !== "" && !inviter.isPartyOwner) return;
      // Joiner must still be solo
      if (joiner.partyId !== "") return;

      // Create the party now if inviter is still solo
      if (inviter.partyId === "") {
        inviter.partyId      = data.fromId; // owner sessionId as partyId
        inviter.isPartyOwner = true;
        this.partyMembers.set(data.fromId, new Set([data.fromId]));
        const defaultName = `${inviter.nickname.slice(0, 10)}'s party`;
        this.partyNames.set(data.fromId, defaultName);
        inviter.partyName = defaultName;
      }

      const members = this.partyMembers.get(inviter.partyId);
      if (!members || members.size >= 5) return;

      members.add(client.sessionId);
      joiner.partyId      = inviter.partyId;
      joiner.isPartyOwner = false;
      joiner.partyName    = this.partyNames.get(inviter.partyId) ?? "";

      // Notify party members (including the new joiner) about the join
      this.sendPartyChat([...members], `${joiner.nickname} joined the party`);
    });

    this.onMessage("party_leave", (client) => {
      this.disbandOrLeaveParty(client.sessionId);
    });

    this.onMessage("party_rename", (client, data: { name: string }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender || !sender.isPartyOwner) return;
      const name = String(data.name ?? "").trim().slice(0, 20);
      if (name.length === 0) return;
      const members = this.partyMembers.get(sender.partyId);
      if (!members) return;
      this.partyNames.set(sender.partyId, name);
      members.forEach(memberId => {
        const member = this.state.players.get(memberId);
        if (member) member.partyName = name;
      });
    });

    this.onMessage("party_kick", (client, data: { targetId: string }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender || !sender.isPartyOwner) return;

      const target = this.state.players.get(data.targetId);
      if (!target || target.partyId !== sender.partyId) return;

      const partyId = sender.partyId;
      const members = this.partyMembers.get(partyId);
      if (!members) return;

      const kickedNickname = target.nickname;
      members.delete(data.targetId);
      target.partyId      = "";
      target.isPartyOwner = false;
      target.partyName    = "";

      // Tell the kicked player privately
      const kickedClient = this.clients.find(c => c.sessionId === data.targetId);
      kickedClient?.send("chat", { sessionId: "server", nickname: "Server",
        message: "You were kicked out of the party" });

      const remaining = [...members];
      if (remaining.length <= 1) {
        // Auto-disband — only owner left
        remaining.forEach(memberId => {
          const member = this.state.players.get(memberId);
          if (member) { member.partyId = ""; member.isPartyOwner = false; member.partyName = ""; }
        });
        this.partyMembers.delete(partyId);
        this.partyNames.delete(partyId);
        this.sendPartyChat(remaining, "Party was disbanded");
      } else {
        this.sendPartyChat(remaining, `${kickedNickname} was kicked from the party`);
      }
    });

    this.onMessage<AttackMessage>("attack", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      const direction = Math.floor(Number(data.direction));
      if (direction < 0 || direction > 3) return;

      // Ignore if already attacking (server-side gate)
      if (this.playerAttacks.has(client.sessionId)) return;

      // Auto-equip weapon if not equipped
      if (!player.showWeapon) player.showWeapon = true;

      player.isAttacking     = true;
      player.attackDirection = direction;

      // Record attack start — tickPlayerWeapons() drives hit detection each tick
      this.playerAttacks.set(client.sessionId, Date.now());

      // Clear the attacking flag once the animation finishes
      setTimeout(() => {
        const p = this.state.players.get(client.sessionId);
        if (p) p.isAttacking = false;
        this.playerAttacks.delete(client.sessionId);
      }, PLAYER_ATTACK_ANIM_MS);
    });

    this.onMessage("buy_weapon", (client, data: { weapon: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      const weaponKey = String(data.weapon ?? "");
      const info = WEAPON_DATA[weaponKey];

      // Must be a real purchasable weapon
      if (!info || info.cost === 0) return;
      if (player.gold < info.cost) return;

      player.gold   -= info.cost;
      player.weapon  = weaponKey;
      player.showWeapon = true; // auto-equip on purchase
    });
  }

  onJoin(client: Client, options: { nickname?: string; skin?: string }): void {
    const player = new PlayerState();
    player.x         = 100 + Math.random() * (MAP_WIDTH  - 200);
    player.y         = 100 + Math.random() * (MAP_HEIGHT - 200);
    player.nickname  = String(options.nickname ?? "Player").slice(0, 15);
    player.skin      = String(options.skin ?? "male/1lvl");
    player.hp        = 100;
    player.maxHp     = 100;
    player.level     = 1;
    player.xp        = 0;
    player.attackBonus = 0;
    player.gold      = 1000;

    this.state.players.set(client.sessionId, player);
    this.lastPositions.set(client.sessionId, { x: player.x, y: player.y, time: Date.now() });
    this.playerHitCooldowns.set(client.sessionId, new Map());

    this.broadcast("chat", {
      sessionId: "server",
      nickname: "Server",
      message: `${player.nickname} has joined the game`,
    });

    console.log(`[Room] ${player.nickname} (${client.sessionId}) joined. Players: ${this.state.players.size}`);
  }

  onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const name   = player?.nickname ?? client.sessionId;

    // Clean up party state before removing from schema
    this.disbandOrLeaveParty(client.sessionId);

    // Remove any pending invites FROM this client
    this.pendingInvites.forEach((_inviterId, targetId) => {
      if (_inviterId === client.sessionId) this.pendingInvites.delete(targetId);
    });
    this.pendingInvites.delete(client.sessionId);

    this.state.players.delete(client.sessionId);
    this.lastPositions.delete(client.sessionId);
    this.playerHitCooldowns.delete(client.sessionId);
    this.playerAttacks.delete(client.sessionId);
    console.log(`[Room] ${name} left. Players: ${this.state.players.size}`);
  }

  onDispose(): void {
    console.log("[Room] Disposed.");
  }

  // ── Enemy spawning ──────────────────────────────────────────────────────────

  private spawnEnemy(type: string): void {
    const id    = `enemy_${++this.enemyCounter}`;
    const enemy = new EnemyState();

    enemy.id        = id;
    enemy.type      = type;
    enemy.x         = 80 + Math.random() * (MAP_WIDTH  - 160);
    enemy.y         = 80 + Math.random() * (MAP_HEIGHT - 160);
    enemy.direction = 0;
    enemy.isDead    = false;

    if (type === "hit") {
      enemy.hp    = HIT_ENEMY_HP;
      enemy.maxHp = HIT_ENEMY_HP;
    }

    this.state.enemies.set(id, enemy);
    this.enemyAttackCooldowns.set(id, new Map());
  }

  private spawnEnemyFromDef(def: EnemySpawnDef): void {
    const id    = `enemy_${++this.enemyCounter}`;
    const enemy = new EnemyState();

    enemy.id        = id;
    enemy.type      = def.type;
    enemy.x         = def.x;
    enemy.y         = def.y;
    enemy.direction = 0;
    enemy.isDead    = false;

    if (def.type === "hit") {
      enemy.hp    = HIT_ENEMY_HP;
      enemy.maxHp = HIT_ENEMY_HP;
    }

    this.state.enemies.set(id, enemy);
    this.enemyAttackCooldowns.set(id, new Map());
    this.enemyDefById.set(id, def);
  }

  // ── AI game loop ─────────────────────────────────────────────────────────────

  private tickEnemyAI(dt: number): void {
    const now   = Date.now();
    const dtSec = dt / 1000;

    this.tickCoins(now);
    this.tickPlayerWeapons(now);

    // Process respawn queue
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const entry = this.respawnQueue[i];
      if (now >= entry.spawnAt) {
        if (entry.def) {
          this.spawnEnemyFromDef(entry.def);   // fixed-position respawn
        } else {
          this.spawnEnemy(entry.type);          // legacy random respawn
        }
        this.respawnQueue.splice(i, 1);
      }
    }

    // Collect living, non-dead players
    const players: Array<{ id: string; state: PlayerState }> = [];
    this.state.players.forEach((p, id) => {
      if (p.hp > 0 && !p.isDead) players.push({ id, state: p });
    });

    if (players.length === 0) return;

    // Update each living enemy
    this.state.enemies.forEach((enemy, enemyId) => {
      if (enemy.isDead) return;

      // Find nearest living player
      let nearestDist = Infinity;
      let nearest: { id: string; state: PlayerState } | null = null;

      for (const p of players) {
        const dx = p.state.x - enemy.x;
        const dy = p.state.y - enemy.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < nearestDist) { nearestDist = d; nearest = p; }
      }

      if (!nearest || nearestDist > ENEMY_AGGRO_RANGE) {
        enemy.isAttacking = false;
        return;
      }

      // Guard: player may have died this tick (killed by another enemy before us)
      if (nearest.state.isDead) {
        enemy.isAttacking = false;
        return;
      }

      const dx = nearest.state.x - enemy.x;
      const dy = nearest.state.y - enemy.y;

      if (nearestDist > ENEMY_ATTACK_RANGE) {
        // ── Move toward player ──────────────────────────────────────────────
        enemy.isAttacking = false;
        if (Math.abs(dx) >= Math.abs(dy)) {
          enemy.direction = dx > 0 ? 3 : 1;
        } else {
          enemy.direction = dy > 0 ? 0 : 2;
        }
        const speed = ENEMY_SPEED * dtSec;
        enemy.x = Math.max(32, Math.min(MAP_WIDTH  - 32, enemy.x + (dx / nearestDist) * speed));
        enemy.y = Math.max(32, Math.min(MAP_HEIGHT - 32, enemy.y + (dy / nearestDist) * speed));

      } else {
        // ── Attack player ───────────────────────────────────────────────────
        const atkDir = Math.abs(dx) >= Math.abs(dy)
          ? (dx > 0 ? 3 : 1)
          : (dy > 0 ? 0 : 2);

        enemy.direction       = atkDir;
        enemy.attackDirection = atkDir;
        enemy.isAttacking     = true;  // driven by proximity, looping on client

        const cdMap   = this.enemyAttackCooldowns.get(enemyId)!;
        const lastHit = cdMap.get(nearest.id) ?? 0;

        if (now - lastHit >= HIT_ATTACK_CD_MS) {
          if (isInsideHitbox(enemy.x, enemy.y, atkDir, nearest.state.x, nearest.state.y, 20)) {
            nearest.state.hp = Math.max(0, nearest.state.hp - HIT_ENEMY_DAMAGE);
            cdMap.set(nearest.id, now);

            if (nearest.state.hp <= 0) {
              this.handlePlayerDeath(nearest.id, nearest.state);
            }
          }
        }
      }
    });
  }

  // ── Player death & respawn ────────────────────────────────────────────────────

  private handlePlayerDeath(sessionId: string, player: PlayerState): void {
    if (player.isDead) return; // already processing death
    player.hp    = 0;
    player.isDead = true;

    this.broadcast("chat", {
      sessionId: "server",
      nickname: "Server",
      message: `${player.nickname} has been slain`,
    });

    // Respawn after 10 seconds
    setTimeout(() => {
      const p = this.state.players.get(sessionId);
      if (!p) return;
      p.hp    = p.maxHp;
      p.x     = 100 + Math.random() * (MAP_WIDTH  - 200);
      p.y     = 100 + Math.random() * (MAP_HEIGHT - 200);
      p.isDead = false;
    }, 10_000);
  }

  // ── Player attack ────────────────────────────────────────────────────────────

  /** Called every tick — checks the axe's current orbital position against all enemies. */
  private tickPlayerWeapons(now: number): void {
    this.playerAttacks.forEach((startTime, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player || player.isDead) return;

      const elapsed = now - startTime;
      if (elapsed >= PLAYER_ATTACK_ANIM_MS) return; // guard (setTimeout handles cleanup)

      const cdMap = this.playerHitCooldowns.get(sessionId);
      if (!cdMap) return;

      // Mirror client angle calculation: start at top (−π/2), sweep clockwise
      const progress  = elapsed / PLAYER_ATTACK_ANIM_MS;
      const angle     = -Math.PI / 2 + progress * 2 * Math.PI;
      const weaponX   = player.x + AXE_ORBIT_RADIUS * Math.cos(angle);
      const weaponY   = player.y + AXE_ORBIT_RADIUS * Math.sin(angle);
      const weaponInfo = WEAPON_DATA[player.weapon] ?? WEAPON_DATA["axe"];
      const totalDmg   = weaponInfo.damage + player.attackBonus;

      this.state.enemies.forEach((enemy, enemyId) => {
        if (enemy.isDead) return;

        // Hit if the enemy centre is within the weapon sprite's bounding circle
        const dx   = enemy.x - weaponX;
        const dy   = enemy.y - weaponY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > WEAPON_SPRITE_RADIUS) return;

        const lastHit = cdMap.get(enemyId) ?? 0;
        if (now - lastHit < WEAPON_HIT_CD_MS) return;

        cdMap.set(enemyId, now);
        enemy.hp = Math.max(0, enemy.hp - totalDmg);

        if (enemy.hp <= 0) {
          this.killEnemy(enemyId, sessionId);
        }
      });
    });
  }

  /** Send a server chat message to a specific set of connected clients. */
  private sendPartyChat(memberIds: string[], message: string): void {
    for (const memberId of memberIds) {
      const client = this.clients.find(c => c.sessionId === memberId);
      client?.send("chat", { sessionId: "server", nickname: "Server", message });
    }
  }

  private disbandOrLeaveParty(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player || player.partyId === "") return;

    const partyId = player.partyId;
    const members = this.partyMembers.get(partyId);

    if (player.isPartyOwner) {
      // Disband the whole party — notify all non-owner members
      const nonOwnerIds: string[] = [];
      if (members) {
        members.forEach(memberId => {
          if (memberId !== sessionId) nonOwnerIds.push(memberId);
          const member = this.state.players.get(memberId);
          if (member) { member.partyId = ""; member.isPartyOwner = false; member.partyName = ""; }
        });
        this.partyMembers.delete(partyId);
        this.partyNames.delete(partyId);
      } else {
        player.partyId = "";
        player.isPartyOwner = false;
        player.partyName = "";
      }
      this.sendPartyChat(nonOwnerIds, "Party was disbanded");
    } else {
      // Non-owner leaves
      const nickname = player.nickname;
      player.partyId      = "";
      player.isPartyOwner = false;
      player.partyName    = "";

      if (members) {
        members.delete(sessionId);
        const remaining = [...members];

        if (remaining.length <= 1) {
          // Only owner left — auto-disband
          remaining.forEach(memberId => {
            const member = this.state.players.get(memberId);
            if (member) { member.partyId = ""; member.isPartyOwner = false; member.partyName = ""; }
          });
          this.partyMembers.delete(partyId);
          this.partyNames.delete(partyId);
          this.sendPartyChat(remaining, "Party was disbanded");
        } else {
          this.sendPartyChat(remaining, `${nickname} has left the party`);
        }
      }
    }
  }

  private killEnemy(enemyId: string, killerSessionId: string): void {
    const enemy = this.state.enemies.get(enemyId);
    if (!enemy || enemy.isDead) return;

    enemy.isDead = true;

    // Remove from state after death animation window (500 ms)
    const spawnDef = this.enemyDefById.get(enemyId) ?? null;
    setTimeout(() => {
      this.state.enemies.delete(enemyId);
      this.enemyAttackCooldowns.delete(enemyId);
      this.enemyDefById.delete(enemyId);
    }, 500);

    // Queue respawn — use per-enemy respawn time if defined, else global constant
    const respawnDelay = spawnDef ? spawnDef.respawnTime : ENEMY_RESPAWN_MS;
    this.respawnQueue.push({ def: spawnDef, type: enemy.type, spawnAt: Date.now() + respawnDelay });

    // Award XP (with party sharing)
    this.awardXP(killerSessionId, HIT_ENEMY_XP, enemy.x, enemy.y);

    // Gold drop (type-specific) — create a persistent pickup for 15 s
    if (enemy.type === "hit" && Math.random() < HIT_ENEMY_GOLD_CHANCE) {
      const coinId = `coin_${++this.coinCounter}`;
      this.pendingCoins.set(coinId, {
        id: coinId,
        x: enemy.x,
        y: enemy.y,
        amount: HIT_ENEMY_GOLD_AMOUNT,
        expiresAt: Date.now() + 15_000,
      });
      this.broadcast("coin_drop", { id: coinId, x: enemy.x, y: enemy.y });
    }
  }

  private awardXP(killerSessionId: string, xpAmount: number, enemyX: number, enemyY: number): void {
    const killer = this.state.players.get(killerSessionId);
    if (!killer) return;

    if (killer.partyId === "") {
      killer.xp += xpAmount;
      this.checkLevelUp(killerSessionId);
      return;
    }

    // Party XP: split among members within 10 tiles (640 px) of the kill
    const SHARE_RANGE = 640;
    const members = this.partyMembers.get(killer.partyId);
    if (!members) { killer.xp += xpAmount; this.checkLevelUp(killerSessionId); return; }

    const memberPositions = [...members].flatMap(memberId => {
      const m = this.state.players.get(memberId);
      return m ? [{ id: memberId, x: m.x, y: m.y, isDead: m.isDead }] : [];
    });
    const eligible = getShareRecipients(enemyX, enemyY, memberPositions, SHARE_RANGE);

    if (eligible.length === 0) { killer.xp += xpAmount; this.checkLevelUp(killerSessionId); return; }

    const share = Math.floor(xpAmount / eligible.length);
    eligible.forEach(memberId => {
      const member = this.state.players.get(memberId);
      if (member) { member.xp += share; this.checkLevelUp(memberId); }
    });
  }

  /**
   * Process all pending coins each tick.
   * A coin is consumed when a qualifying player steps within range, or removed
   * silently when it expires after 15 s.
   */
  private tickCoins(now: number): void {
    const toProcess: PendingCoin[] = [];

    for (const coin of this.pendingCoins.values()) {
      const expired = now >= coin.expiresAt;
      if (expired || this.coinHasNearbyPlayer(coin)) {
        toProcess.push(coin);
      }
    }

    for (const coin of toProcess) {
      this.pendingCoins.delete(coin.id);
      this.broadcast("coin_collected", { id: coin.id });
      if (now < coin.expiresAt) {
        this.awardGold(coin.amount, coin.x, coin.y);
      }
    }
  }

  /** Returns true if any living player is within the 20 px collect radius. */
  private coinHasNearbyPlayer(coin: PendingCoin): boolean {
    const COLLECT_RANGE = 20;
    let found = false;
    this.state.players.forEach((p) => {
      if (found || p.isDead) return;
      const dx = p.x - coin.x;
      const dy = p.y - coin.y;
      if (Math.sqrt(dx * dx + dy * dy) <= COLLECT_RANGE) found = true;
    });
    return found;
  }

  /**
   * Award gold to any living player(s) whose center is within 20 px of the coin.
   * If nobody is close enough the coin animation plays but no gold is granted.
   * Among eligible players, the nearest one wins; ties split evenly (ceil).
   * If the winner is in a party, further splits with nearby party members.
   */
  private awardGold(amount: number, coinX: number, coinY: number): void {
    const COLLECT_RANGE = 20; // px

    const allPlayers: PositionedPlayer[] = [];
    this.state.players.forEach((p, id) => {
      if (!p.isDead) allPlayers.push({ id, x: p.x, y: p.y, partyId: p.partyId });
    });

    const nearest = findNearestPlayers(coinX, coinY, allPlayers, COLLECT_RANGE);
    if (nearest.length === 0) return;

    if (nearest.length === 1) {
      this.distributeGoldToParty(nearest[0].id, amount, coinX, coinY);
      return;
    }

    // Multiple equidistant players — group by party
    const inSameParty =
      nearest.every(c => c.partyId !== "" && c.partyId === nearest[0].partyId);

    if (inSameParty) {
      // Treat as a single party recipient (party split handled inside)
      this.distributeGoldToParty(nearest[0].id, amount, coinX, coinY);
    } else {
      // Different parties / solo — each gets ceil(amount / count)
      const share = Math.ceil(amount / nearest.length);
      for (const c of nearest) {
        this.distributeGoldToParty(c.id, share, coinX, coinY);
      }
    }
  }

  /**
   * Award gold to `recipientId`. If they are in a party, split with nearby
   * party members (≤640 px from coin) — same radius as XP sharing.
   * Each recipient receives ceil(amount / eligibleCount).
   */
  private distributeGoldToParty(recipientId: string, amount: number, coinX: number, coinY: number): void {
    const recipient = this.state.players.get(recipientId);
    if (!recipient) return;

    if (recipient.partyId === "") {
      recipient.gold += amount;
      this.sendGoldNotification(recipientId, amount);
      return;
    }

    const SHARE_RANGE = 640;
    const members = this.partyMembers.get(recipient.partyId);
    if (!members) {
      recipient.gold += amount;
      this.sendGoldNotification(recipientId, amount);
      return;
    }

    const memberPositions = [...members].flatMap(memberId => {
      const m = this.state.players.get(memberId);
      return m ? [{ id: memberId, x: m.x, y: m.y, isDead: m.isDead }] : [];
    });
    const eligible = getShareRecipients(coinX, coinY, memberPositions, SHARE_RANGE);

    if (eligible.length === 0) {
      recipient.gold += amount;
      this.sendGoldNotification(recipientId, amount);
      return;
    }

    const share = Math.ceil(amount / eligible.length);
    for (const memberId of eligible) {
      const member = this.state.players.get(memberId);
      if (member) {
        member.gold += share;
        this.sendGoldNotification(memberId, share);
      }
    }
  }

  private sendGoldNotification(sessionId: string, amount: number): void {
    const client = this.clients.find(c => c.sessionId === sessionId);
    client?.send("chat", {
      sessionId: "server",
      nickname: "Server",
      message: `You have gained ${amount} gold`,
    });
  }

  private checkLevelUp(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    while (player.xp >= xpForNextLevel(player.level)) {
      player.xp -= xpForNextLevel(player.level);
      player.level  += 1;
      player.maxHp  += 10;
      player.hp      = player.maxHp; // full heal on level-up
      player.attackBonus = parseFloat((player.attackBonus + 0.5).toFixed(1));
      this.broadcast("chat", {
        sessionId: "server",
        nickname: "Server",
        message: `${player.nickname} has reached level ${player.level}`,
      });
      console.log(`[Room] ${player.nickname} reached level ${player.level}!`);
    }
  }
}
