import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import fs   from "fs";
import path from "path";
import { xpForNextLevel }                    from "../shared/formulas";
import { getHitbox, isInsideHitbox }          from "../shared/combat";
import { findNearestPlayers, getShareRecipients, PositionedPlayer } from "../shared/economy";
import { OBJECT_REGISTRY }                    from "../shared/objects";
import { ENEMY_REGISTRY }                     from "../shared/enemies";
import { WEAPON_REGISTRY }                    from "../shared/weapons";
import { globalBus, PlayerProfile }           from "./GlobalBus";

// ─── Schema ───────────────────────────────────────────────────────────────────

export class PlayerState extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") nickname: string = "";
  @type("string") skin: string = "male/grey";
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
  @type("string")  partyRoster: string = "";
  @type("number")  gold: number = 0;
  @type("string")  weapon: string = "sword";
  @type("number")  potions: number = 0;
  @type("number")  potionHealRemaining: number = 0;
  @type("boolean") disconnected: boolean = false;
  @type("boolean") isGM: boolean = false;
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


// Enemy AI — per-enemy stats now come from ENEMY_REGISTRY; these are legacy fallbacks
const ENEMY_COUNT      = 10;
const ENEMY_RESPAWN_MS = 10_000;

// Player weapon
const WEAPON_HIT_CD_MS      = 1_000; // prevent hitting the same enemy twice in one swing
const PLAYER_ATTACK_ANIM_MS = 750;  // 0.75-second orbit animation
const DEFAULT_HIT_RADIUS    = 33;   // fallback if weapon not in registry
const DEFAULT_ORBIT_RADIUS  = 47;   // fallback orbit radius (sword: 74/2+10)

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

  private mapName: string = "m1";
  private objectData: Array<{ type: string; x: number; y: number }> = [];
  private npcData: Array<{ type: string; x: number; y: number }> = [];
  private mobData: Array<Record<string, unknown>> = [];
  private neutralZones: Array<{ x: number; y: number; width: number; height: number }> = [];
  private tileData: Array<{ type: string; x: number; y: number }> = [];
  private doorData: Array<{ id: string; x: number; y: number; targetMap: string; targetDoorId: string }> = [];
  private defaultTile: string = "grass_basic";
  private spawnPoint: { x: number; y: number } = { x: 100, y: 100 };
  private lastPositions = new Map<string, LastPos>();

  // ── Session persistence (reconnection) ────────────────────────────────────
  /** persistentId (localStorage UUID) → active sessionId */
  private persistentIdToSession = new Map<string, string>();
  /** sessionId → persistentId */
  private sessionToPersistentId = new Map<string, string>();

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

  /** playerId → attack start timestamp (present while the sword is orbiting) */
  private playerAttacks = new Map<string, number>();

  /** playerId → timestamp of last damage received (for regen cooldown) */
  private playerLastDamagedAt = new Map<string, number>();

  /** playerId → timestamp of last regen tick */
  private playerLastRegenAt = new Map<string, number>();

  /** Enemies waiting to respawn */
  private respawnQueue: Array<{ def: EnemySpawnDef | null; type: string; spawnAt: number }> = [];

  // ── Kick tracking ──────────────────────────────────────────────────────────
  /** Sessions being force-kicked: skip reconnect grace period and reset their profile */
  private kickedSessions = new Set<string>();

  // ── Party bookkeeping ──────────────────────────────────────────────────────
  /** targetSessionId → inviterSessionId */
  private pendingInvites = new Map<string, string>();

  /** Timestamp of last cross-room party HP sync (for away-member HP freshness) */
  private lastRosterSyncAt = 0;
  private static readonly ROSTER_SYNC_INTERVAL_MS = 5_000;

  // ──────────────────────────────────────────────────────────────────────────

  onCreate(options: Record<string, unknown> = {}): void {
    this.setState(new GameState());
    this.setPatchRate(1000 / 20); // 20 Hz state broadcast

    // ── Resolve map name from join options ────────────────────────────────────
    this.mapName = String(options.mapName ?? "m1").replace(/[^a-zA-Z0-9_-]/g, "") || "m1";

    // ── Load map JSON ─────────────────────────────────────────────────────────
    const mapFile  = path.resolve(__dirname, `../../public/assets/maps/placement/${this.mapName}.json`);
    const mapJson  = JSON.parse(fs.readFileSync(mapFile, "utf-8")) as {
      defaultTile?:  string;
      spawnPoint?:   { x: number; y: number };
      tiles?:        Array<{ type: string; x: number; y: number }>;
      objects:       Array<{ type: string; x: number; y: number }>;
      npcs?:         Array<{ type: string; x: number; y: number }>;
      mobs?:         Array<Record<string, unknown>>;
      enemies?:      Array<{ type: string; x: number; y: number; respawnTime: number }>;
      neutralZones?: Array<{ x: number; y: number; width: number; height: number }>;
      doors?:        Array<{ id: string; x: number; y: number; targetMap: string; targetDoorId: string }>;
    };
    for (const obj of mapJson.objects) {
      if (OBJECT_REGISTRY[obj.type]) {
        this.objectData.push({ type: obj.type, x: obj.x, y: obj.y });
      }
    }
    this.npcData      = mapJson.npcs  ?? [];
    this.mobData      = mapJson.mobs  ?? [];
    this.neutralZones = mapJson.neutralZones ?? [];
    this.tileData     = mapJson.tiles ?? [];
    this.doorData     = mapJson.doors ?? [];
    this.defaultTile  = mapJson.defaultTile ?? "grass_basic";
    this.spawnPoint   = mapJson.spawnPoint   ?? { x: 100, y: 100 };

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

    // ── Register with GlobalBus for cross-room chat and leaderboard ─────────────
    globalBus.registerRoom(this.roomId, {
      broadcastFn:   (type, msg) => this.broadcast(type, msg),
      onPartyUpdate: (partyId) => this.updatePartyMemberStates(partyId),
      sendToPlayerFn: (pid, type, msg) => {
        const sessionId = this.persistentIdToSession.get(pid);
        if (!sessionId) return false;
        const client = this.clients.find((c: Client) => c.sessionId === sessionId);
        if (!client) return false;
        client.send(type, msg);
        return true;
      },
      getPlayersFn: () => {
        const out: Array<{ nickname: string; level: number; xp: number; partyName: string; isDead: boolean }> = [];
        this.state.players.forEach(p => {
          if (!p.isGM) {
            out.push({ nickname: p.nickname, level: p.level, xp: p.xp, partyName: p.partyName, isDead: p.isDead });
          }
        });
        return out;
      },
    });

    this.onMessage("get_map", (client) => {
      client.send("map_data", {
        defaultTile: this.defaultTile,
        spawnPoint:  this.spawnPoint,
        tiles:       this.tileData,
        objects:     this.objectData,
        npcs:        this.npcData,
        mobs:        this.mobData,
        doors:       this.doorData,
      });
    });

    this.onMessage("use_door", (client, data: { doorId: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;

      const door = this.doorData.find(d => d.id === data.doorId);
      if (!door) {
        console.warn(`[Room] Door not found: ${data.doorId} in map ${this.mapName}`);
        return;
      }

      // Sanitize and resolve target map
      const targetMapName = door.targetMap.replace(/[^a-zA-Z0-9_-]/g, "");
      if (!targetMapName) {
        console.warn(`[Room] Invalid target map: ${door.targetMap}`);
        return;
      }

      try {
        const targetFile = path.resolve(
          __dirname, `../../public/assets/maps/placement/${targetMapName}.json`
        );
        if (!fs.existsSync(targetFile)) {
          console.warn(`[Room] Target map file not found: ${targetFile}`);
          return;
        }

        const targetJson = JSON.parse(fs.readFileSync(targetFile, "utf-8")) as {
          doors?: Array<{ id: string; x: number; y: number }>;
        };
        const targetDoor = (targetJson.doors ?? []).find(d => d.id === door.targetDoorId);
        if (!targetDoor) {
          console.warn(`[Room] Target door ${door.targetDoorId} not found in map ${targetMapName}`);
          return;
        }

        // Calculate arrival offset: if door is on the left, spawn to the right (+80); if on the right, spawn to the left (-80)
        // This ensures the player doesn't arrive exactly on top of the door or outside map bounds (MAP_WIDTH=2000).
        const offsetX = targetDoor.x < 1000 ? 80 : -80;
        const offsetY = 60;

        console.log(`[Room] Player ${player.nickname} traveling from ${this.mapName}:${door.id} to ${targetMapName}:${targetDoor.id}`);

        client.send("door_travel", {
          targetMap: targetMapName,
          spawnX:    targetDoor.x + offsetX,
          spawnY:    targetDoor.y + offsetY,
        });
      } catch (err) {
        console.error(`[Room] Door travel failed:`, err);
      }
    });

    this.onMessage("chat", (client, message: string) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !message || message.trim().length === 0) return;

      // Intercept GM slash commands
      if (player.isGM && message.trim().startsWith("/")) {
        this.handleGMCommand(client, player, message.trim());
        return;
      }

      const payload = {
        sessionId: client.sessionId,
        nickname:  player.nickname,
        message:   message.slice(0, 100),
      };
      this.broadcast("chat", payload);
      // Relay to players on other maps
      globalBus.publishChat(payload, this.roomId);
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

      // GM cannot participate in parties
      if (sender.isGM) return;

      // Only solo players or party owners may invite
      if (sender.partyId !== "" && !sender.isPartyOwner) return;

      const target = this.state.players.get(data.targetId);
      if (!target || target.partyId !== "") return; // target already in a party
      if (target.isGM) return; // cannot invite GM

      // If sender already has a party, check it isn't full
      if (sender.partyId !== "") {
        const party = globalBus.getParty(sender.partyId);
        if (!party || party.members.size >= 5) return;
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

      const inviterPid = this.sessionToPersistentId.get(data.fromId);
      const joinerPid  = this.sessionToPersistentId.get(client.sessionId);
      if (!inviterPid || !joinerPid) return;

      let partyId = inviter.partyId;
      if (partyId === "") {
        partyId = globalBus.createParty(inviterPid, inviter.nickname);
        inviter.partyId      = partyId;
        inviter.isPartyOwner = true;
      }

      const success = globalBus.joinParty(partyId, joinerPid);
      if (success) {
        // Schema fields (partyId, isPartyOwner, partyName, partyRoster) are already set
        // for all rooms by the publishPartyUpdate triggered inside joinParty.
        // Setting joiner fields here keeps the local state consistent without waiting
        // for the next Colyseus patch cycle.
        joiner.partyId      = partyId;
        joiner.isPartyOwner = false;
        this.sendPartyChat(partyId, `${joiner.nickname} joined the party`);
      }
    });

    this.onMessage("party_leave", (client) => {
      this.disbandOrLeaveParty(client.sessionId);
    });

    this.onMessage("party_rename", (client, data: { name: string }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender || !sender.isPartyOwner) return;
      const name = String(data.name ?? "").trim().slice(0, 20);
      if (name.length === 0) return;
      
      globalBus.renameParty(sender.partyId, name);
      this.updatePartyMemberStates(sender.partyId);
    });

    this.onMessage("party_kick", (client, data: { targetId?: string; targetPid?: string }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender || !sender.isPartyOwner || !sender.partyId) return;

      let targetPid = data.targetPid;
      let kickedNickname = "Unknown";

      // Support legacy targetId (sessionId)
      if (data.targetId && !targetPid) {
        targetPid = this.sessionToPersistentId.get(data.targetId);
        const target = this.state.players.get(data.targetId);
        if (target) kickedNickname = target.nickname;
      }

      if (!targetPid) return;

      const partyId = sender.partyId;
      const party = globalBus.getParty(partyId);
      if (!party || !party.members.has(targetPid)) return;

      // Fetch nickname from profile if we didn't get it from local state
      if (kickedNickname === "Unknown") {
        const profile = globalBus.getProfile(targetPid);
        if (profile) kickedNickname = profile.nickname;
      }
      
      globalBus.leaveParty(partyId, targetPid);
      // publishPartyUpdate is triggered inside leaveParty, so all rooms'
      // updatePartyMemberStates will clear the kicked player's party schema fields.

      // Personal notification — works cross-map via GlobalBus.sendToPlayer
      globalBus.sendToPlayer(targetPid, "chat", {
        sessionId: "server",
        nickname:  "Server",
        message:   "You were kicked from the party",
      });
      this.sendPartyChat(partyId, `${kickedNickname} was kicked from the party`);
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
      const info = WEAPON_REGISTRY[weaponKey];

      // Must be a real purchasable weapon
      if (!info || info.cost === 0) return;
      if (player.gold < info.cost) return;

      player.gold   -= info.cost;
      player.weapon  = weaponKey;
      player.showWeapon = true; // auto-equip on purchase
    });

    this.onMessage("buy_potion", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead) return;
      if (player.gold < 20) return;
      player.gold   -= 20;
      player.potions += 1;
    });

    this.onMessage("use_potion", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDead || player.potions <= 0) return;
      player.potions           -= 1;
      player.potionHealRemaining += Math.round(player.maxHp * 0.30);
    });
  }

  onJoin(client: Client, options: { nickname?: string; skin?: string; persistentId?: string; mapName?: string; spawnX?: number; spawnY?: number; login?: string; password?: string }): void {
    // ── GM authentication ─────────────────────────────────────────────────────
    const isGMLogin = typeof options.login === "string" || typeof options.password === "string";
    if (isGMLogin) {
      if (options.login !== "admin" || options.password !== "admin123") {
        throw new Error("logging failed");
      }
    }

    // ── Multi-window prevention ──────────────────────────────────────────────
    const pid = typeof options.persistentId === "string" ? options.persistentId.slice(0, 64) : "";
    if (pid) {
      const existingSessionId = this.persistentIdToSession.get(pid);
      if (existingSessionId && existingSessionId !== client.sessionId) {
        const existingPlayer = this.state.players.get(existingSessionId);
        // Only kick if the old session is currently active (not already in grace period)
        if (existingPlayer && !existingPlayer.disconnected) {
          const oldClient = this.clients.find((c: Client) => c.sessionId === existingSessionId);
          oldClient?.leave(4001); // 4001 = replaced by new window
        }
      }
      this.persistentIdToSession.set(pid, client.sessionId);
      this.sessionToPersistentId.set(client.sessionId, pid);
    }

    // Use override spawn if provided (e.g. from door teleport), else map default
    const rawSpawnX = typeof options.spawnX === "number" && isFinite(options.spawnX) ? options.spawnX : this.spawnPoint.x;
    const rawSpawnY = typeof options.spawnY === "number" && isFinite(options.spawnY) ? options.spawnY : this.spawnPoint.y;

    const player = new PlayerState();
    player.x         = Math.max(32, Math.min(MAP_WIDTH  - 32, rawSpawnX));
    player.y         = Math.max(32, Math.min(MAP_HEIGHT - 32, rawSpawnY));
    
    // ── Load Profile or Init Defaults ────────────────────────────────────────
    if (isGMLogin) {
      // GM setup — hardcoded state, no profile loading
      player.isGM       = true;
      player.nickname   = "admin";
      player.level      = 99;
      player.skin       = "gm";
      player.hp         = 9999;
      player.maxHp      = 9999;
      player.attackBonus = 0;
    } else {
      const profile = pid ? globalBus.getProfile(pid) : undefined;
      if (profile) {
        player.nickname            = profile.nickname;
        player.skin                = profile.skin;
        player.hp                  = profile.hp;
        player.maxHp               = profile.maxHp;
        player.level               = profile.level;
        player.xp                  = profile.xp;
        player.gold                = profile.gold;
        player.weapon              = profile.weapon;
        player.potions             = profile.potions;
        player.potionHealRemaining = profile.potionHealRemaining;
        player.attackBonus         = (player.level - 1) * 0.5; // recalculate bonus

        // Validate party still exists in GlobalBus (may have been disbanded in transit)
        if (profile.partyId) {
          const party = globalBus.getParty(profile.partyId);
          if (party && party.members.has(pid)) {
            player.partyId      = party.id;
            player.isPartyOwner = profile.isPartyOwner;
            player.partyName    = party.name; // live name in case it was renamed
          }
          // else: party gone or player removed — leave partyId as "" (default)
        }
      } else {
        player.nickname  = String(options.nickname ?? "Player").slice(0, 15);
        player.skin      = String(options.skin ?? "male/grey");
        player.hp        = 100;
        player.maxHp     = 100;
        player.level     = 1;
        player.xp        = 0;
        player.attackBonus = 0;
        player.gold      = 1000;
      }
    }

    this.state.players.set(client.sessionId, player);
    this.lastPositions.set(client.sessionId, { x: player.x, y: player.y, time: Date.now() });
    this.playerHitCooldowns.set(client.sessionId, new Map());

    // ── Update Global Profile immediately so party members see us ────────────
    if (pid && !player.isGM) {
      globalBus.saveProfile(pid, {
        nickname:            player.nickname,
        skin:                player.skin,
        level:               player.level,
        xp:                  player.xp,
        gold:                player.gold,
        hp:                  player.hp,
        maxHp:               player.maxHp,
        weapon:              player.weapon,
        potions:             player.potions,
        potionHealRemaining: player.potionHealRemaining,
        partyId:             player.partyId,
        isPartyOwner:        player.isPartyOwner,
        partyName:           player.partyName,
      });
    }

    // If player is in a party, sync HUD for all party members already in this room
    if (player.partyId) this.updatePartyMemberStates(player.partyId);

    // Refresh global leaderboard so the new player is immediately visible
    globalBus.broadcastLeaderboard();

    this.broadcast("chat", {
      sessionId: "server",
      nickname: "Server",
      message: `${player.nickname} has joined the game`,
    });

    console.log(`[Room] ${player.nickname} (${client.sessionId}) joined. Players: ${this.state.players.size}`);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    const name   = player?.nickname ?? client.sessionId;

    // Clean up pending invites in all cases
    this.pendingInvites.forEach((_inviterId, targetId) => {
      if (_inviterId === client.sessionId) this.pendingInvites.delete(targetId);
    });
    this.pendingInvites.delete(client.sessionId);

    const wasKicked = this.kickedSessions.has(client.sessionId);
    this.kickedSessions.delete(client.sessionId);

    if (consented || wasKicked) {
      if (wasKicked) {
        // Kicked: wipe profile so they start fresh on next join
        console.log(`[Room] ${name} was kicked — removing and resetting profile.`);
        this.cleanupPlayer(client.sessionId, true);
      } else {
        // Intentional leave (map teleport) — save profile intact, then clean up
        console.log(`[Room] ${name} left intentionally (consented).`);
        this.cleanupPlayer(client.sessionId);
      }
      return;
    }

    // Unintentional disconnect — mark as disconnected.
    // We only leave/disband the party if they fail to reconnect within the grace period.
    if (player) player.disconnected = true;

    console.log(`[Room] ${name} disconnected — holding slot for 60 s`);

    try {
      await this.allowReconnection(client, 60);
      // Player reconnected within the grace period
      if (player) player.disconnected = false;
      console.log(`[Room] ${name} reconnected`);
    } catch {
      // Grace period expired — leave party and clean up for real
      this.disbandOrLeaveParty(client.sessionId);
      this.cleanupPlayer(client.sessionId);
      console.log(`[Room] ${name} removed (grace period expired). Players: ${this.state.players.size}`);
    }
  }

  /** Centralized cleanup logic for player removal.
   *  @param resetProfile  When true (kick), delete the saved profile so the player starts fresh. */
  private cleanupPlayer(sessionId: string, resetProfile = false): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    // ── Save / reset profile before deleting (skip entirely for GM) ─────────
    const pid = this.sessionToPersistentId.get(sessionId);
    if (pid) {
      if (!player.isGM) {
        if (resetProfile) {
          globalBus.deleteProfile(pid);
        } else {
          const profile: PlayerProfile = {
            nickname:            player.nickname,
            skin:                player.skin,
            level:               player.level,
            xp:                  player.xp,
            gold:                player.gold,
            hp:                  player.hp,
            maxHp:               player.maxHp,
            weapon:              player.weapon,
            potions:             player.potions,
            potionHealRemaining: player.potionHealRemaining,
            partyId:             player.partyId,
            isPartyOwner:        player.isPartyOwner,
            partyName:           player.partyName,
          };
          globalBus.saveProfile(pid, profile);
        }
      }

      if (this.persistentIdToSession.get(pid) === sessionId) {
        this.persistentIdToSession.delete(pid);
      }
      this.sessionToPersistentId.delete(sessionId);
    }

    this.state.players.delete(sessionId);
    this.lastPositions.delete(sessionId);
    this.playerHitCooldowns.delete(sessionId);
    this.playerAttacks.delete(sessionId);
    this.playerLastDamagedAt.delete(sessionId);
    this.playerLastRegenAt.delete(sessionId);
  }

  onDispose(): void {
    globalBus.unregisterRoom(this.roomId);
    console.log("[Room] Disposed.");
  }

  // ── Enemy spawning ──────────────────────────────────────────────────────────

  private spawnEnemy(type: string): void {
    const regDef = ENEMY_REGISTRY[type];
    if (!regDef) { console.warn(`[Room] Unknown enemy type: ${type}`); return; }

    const id    = `enemy_${++this.enemyCounter}`;
    const enemy = new EnemyState();

    enemy.id        = id;
    enemy.type      = type;
    enemy.x         = 80 + Math.random() * (MAP_WIDTH  - 160);
    enemy.y         = 80 + Math.random() * (MAP_HEIGHT - 160);
    enemy.direction = 0;
    enemy.isDead    = false;
    enemy.hp        = regDef.hp;
    enemy.maxHp     = regDef.hp;

    this.state.enemies.set(id, enemy);
    this.enemyAttackCooldowns.set(id, new Map());
  }

  private spawnEnemyFromDef(def: EnemySpawnDef): void {
    const regDef = ENEMY_REGISTRY[def.type];
    if (!regDef) { console.warn(`[Room] Unknown enemy type: ${def.type}`); return; }

    const id    = `enemy_${++this.enemyCounter}`;
    const enemy = new EnemyState();

    enemy.id        = id;
    enemy.type      = def.type;
    enemy.x         = def.x;
    enemy.y         = def.y;
    enemy.direction = 0;
    enemy.isDead    = false;
    enemy.hp        = regDef.hp;
    enemy.maxHp     = regDef.hp;

    this.state.enemies.set(id, enemy);
    this.enemyAttackCooldowns.set(id, new Map());
    this.enemyDefById.set(id, def);
  }

  // ── Neutral zone helpers ──────────────────────────────────────────────────────

  private isInNeutralZone(px: number, py: number): boolean {
    return this.neutralZones.some(z =>
      px >= z.x && px <= z.x + z.width &&
      py >= z.y && py <= z.y + z.height
    );
  }

  // ── AI game loop ─────────────────────────────────────────────────────────────

  private tickEnemyAI(dt: number): void {
    const now   = Date.now();
    const dtSec = dt / 1000;

    this.tickCoins(now);
    this.tickPlayerWeapons(now);
    this.tickPlayerRegen(now, dtSec);
    this.tickPotionHealing(dtSec);
    this.tickPartyRosterSync(now);

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

    // Collect living, non-dead, non-GM players (GM is invisible to enemies)
    const players: Array<{ id: string; state: PlayerState }> = [];
    this.state.players.forEach((p, id) => {
      if (p.hp > 0 && !p.isDead && !p.isGM) players.push({ id, state: p });
    });

    if (players.length === 0) return;

    // Update each living enemy
    this.state.enemies.forEach((enemy, enemyId) => {
      if (enemy.isDead) return;

      // Find nearest living player
      let nearestDist = Infinity;
      let nearest: { id: string; state: PlayerState } | null = null;

      for (const p of players) {
        if (this.isInNeutralZone(p.state.x, p.state.y)) continue; // invisible to enemies
        const dx = p.state.x - enemy.x;
        const dy = p.state.y - enemy.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < nearestDist) { nearestDist = d; nearest = p; }
      }

      const regDef = ENEMY_REGISTRY[enemy.type];
      if (!regDef) return;

      if (!nearest || nearestDist > regDef.aggroRange) {
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

      if (nearestDist > regDef.attackRange) {
        // ── Move toward player ──────────────────────────────────────────────
        enemy.isAttacking = false;
        if (Math.abs(dx) >= Math.abs(dy)) {
          enemy.direction = dx > 0 ? 3 : 1;
        } else {
          enemy.direction = dy > 0 ? 0 : 2;
        }
        const speed = regDef.speed * dtSec;
        const newX = Math.max(32, Math.min(MAP_WIDTH  - 32, enemy.x + (dx / nearestDist) * speed));
        const newY = Math.max(32, Math.min(MAP_HEIGHT - 32, enemy.y + (dy / nearestDist) * speed));
        if (!this.isInNeutralZone(newX, newY)) {
          enemy.x = newX;
          enemy.y = newY;
        }
        // else: enemy stops at zone boundary

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

        if (now - lastHit >= regDef.attackCooldownMs) {
          if (isInsideHitbox(enemy.x, enemy.y, atkDir, nearest.state.x, nearest.state.y, 20)) {
            nearest.state.hp = Math.max(0, nearest.state.hp - regDef.damage);
            cdMap.set(nearest.id, now);
            this.playerLastDamagedAt.set(nearest.id, now);

            if (nearest.state.hp <= 0) {
              this.handlePlayerDeath(nearest.id, nearest.state);
            }
          }
        }
      }
    });
  }

  // ── Player health regeneration ────────────────────────────────────────────────

  private static readonly REGEN_COOLDOWN_MS  = 5_000; // ms without damage before regen starts
  private static readonly REGEN_INTERVAL_MS  = 2_000; // heal pulse every 2 s
  private static readonly REGEN_PCT_PER_TICK = 0.05;  // 5% of maxHp per pulse

  private tickPlayerRegen(now: number, _dtSec: number): void {
    this.state.players.forEach((player, id) => {
      if (player.isDead || player.hp <= 0 || player.hp >= player.maxHp) return;

      const lastDamaged = this.playerLastDamagedAt.get(id) ?? 0;
      if (now - lastDamaged < GameRoom.REGEN_COOLDOWN_MS) return;

      const lastRegen = this.playerLastRegenAt.get(id) ?? 0;
      if (now - lastRegen < GameRoom.REGEN_INTERVAL_MS) return;

      const healAmount = Math.floor(player.maxHp * GameRoom.REGEN_PCT_PER_TICK);
      player.hp = Math.min(player.maxHp, player.hp + healAmount);
      this.playerLastRegenAt.set(id, now);
    });
  }

  // ── Potion healing ────────────────────────────────────────────────────────────

  private tickPotionHealing(dtSec: number): void {
    this.state.players.forEach((player) => {
      if (player.potionHealRemaining <= 0) return;
      // Once fully healed, discard the remaining pool immediately
      if (player.hp >= player.maxHp) {
        player.potionHealRemaining = 0;
        return;
      }
      const healRate   = player.maxHp * 0.03 * dtSec;
      const toApply    = Math.min(healRate, player.potionHealRemaining);
      const actualHeal = Math.min(toApply, player.maxHp - player.hp);
      player.hp                  += actualHeal;
      player.potionHealRemaining  = Math.max(0, player.potionHealRemaining - actualHeal);
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
      p.hp                   = p.maxHp;
      p.potionHealRemaining  = 0;
      p.x      = this.spawnPoint.x;
      p.y      = this.spawnPoint.y;
      p.isDead = false;
      // Reset lastPositions so the speed check anchors from the spawn point,
      // not the death location (which could be 10+ seconds old).
      this.lastPositions.set(sessionId, { x: this.spawnPoint.x, y: this.spawnPoint.y, time: Date.now() });
    }, 10_000);
  }

  // ── Player attack ────────────────────────────────────────────────────────────

  /** Called every tick — checks the sword's current orbital position against all enemies and players. */
  private tickPlayerWeapons(now: number): void {
    this.playerAttacks.forEach((startTime, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player || player.isDead) return;
      if (player.isGM) return; // GM cannot deal damage

      const elapsed = now - startTime;
      if (elapsed >= PLAYER_ATTACK_ANIM_MS) return; // guard (setTimeout handles cleanup)

      // Neutral zone: attacker deals 0 damage to anyone (enemies or players)
      if (this.isInNeutralZone(player.x, player.y)) return;

      const cdMap = this.playerHitCooldowns.get(sessionId);
      if (!cdMap) return;

      // Mirror client angle calculation: start at top (−π/2), sweep clockwise
      const progress  = elapsed / PLAYER_ATTACK_ANIM_MS;
      const angle     = -Math.PI / 2 + progress * 2 * Math.PI;
      const weaponDef  = WEAPON_REGISTRY[player.weapon] ?? WEAPON_REGISTRY["sword"];
      const orbitR    = weaponDef?.orbitRadius ?? DEFAULT_ORBIT_RADIUS;
      const weaponX   = player.x + orbitR * Math.cos(angle);
      const weaponY   = player.y + orbitR * Math.sin(angle);
      const hitRadius  = weaponDef?.hitRadius ?? DEFAULT_HIT_RADIUS;
      const totalDmg   = (weaponDef?.damage ?? 50) + player.attackBonus;

      // ── vs enemies ────────────────────────────────────────────────────────
      this.state.enemies.forEach((enemy, enemyId) => {
        if (enemy.isDead) return;
        // Neutral zone: target enemy is protected
        if (this.isInNeutralZone(enemy.x, enemy.y)) return;

        // Hit if the enemy centre is within the weapon sprite's bounding circle
        const dx   = enemy.x - weaponX;
        const dy   = enemy.y - weaponY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > hitRadius) return;

        const lastHit = cdMap.get(enemyId) ?? 0;
        if (now - lastHit < WEAPON_HIT_CD_MS) return;

        cdMap.set(enemyId, now);
        enemy.hp = Math.max(0, enemy.hp - totalDmg);

        if (enemy.hp <= 0) {
          this.killEnemy(enemyId, sessionId);
        }
      });

      // ── vs players (PvP) ─────────────────────────────────────────────────
      this.state.players.forEach((target, targetId) => {
        if (targetId === sessionId) return; // can't hit self
        if (target.isDead) return;
        if (target.isGM) return; // GM is immune to all damage
        // Neutral zone: target player is protected
        if (this.isInNeutralZone(target.x, target.y)) return;
        // Same party: no friendly fire
        if (player.partyId !== "" && player.partyId === target.partyId) return;

        const dx   = target.x - weaponX;
        const dy   = target.y - weaponY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > hitRadius) return;

        const lastHit = cdMap.get(targetId) ?? 0;
        if (now - lastHit < WEAPON_HIT_CD_MS) return;

        cdMap.set(targetId, now);
        target.hp = Math.max(0, target.hp - totalDmg);
        this.playerLastDamagedAt.set(targetId, now);

        if (target.hp <= 0) {
          this.handlePlayerDeath(targetId, target);
        }
      });
    });
  }

  /** Send a server chat message to a specific set of connected clients across all rooms. */
  private sendPartyChat(partyId: string, message: string): void {
    const payload = { sessionId: "server", nickname: "Server", message };
    this.broadcast("chat", payload); // local room
    globalBus.publishChat(payload, this.roomId); // other rooms
  }

  /**
   * Build a JSON roster for the given party, mixing live schema data for
   * members in THIS room with saved profile data for members on other maps.
   * Each entry includes a `sessionId` (non-null only when the member is local)
   * so the client can do an O(1) look-up instead of a fragile name search.
   */
  private buildRosterJson(partyId: string): string {
    const party = globalBus.getParty(partyId);
    if (!party) return "";

    const roster: Array<{
      pid:       string;
      sessionId: string | null;
      nickname:  string;
      level:     number;
      hp:        number;
      maxHp:     number;
    }> = [];

    party.members.forEach((pid) => {
      const sessionId    = this.persistentIdToSession.get(pid) ?? null;
      const localPlayer  = sessionId ? this.state.players.get(sessionId) : null;

      if (localPlayer) {
        // Live data — accurate every time this room's state is queried
        roster.push({
          pid,
          sessionId,
          nickname: localPlayer.nickname,
          level:    localPlayer.level,
          hp:       localPlayer.hp,
          maxHp:    localPlayer.maxHp,
        });
      } else {
        // Away member — use profile saved on their last join/sync
        const profile = globalBus.getProfile(pid);
        roster.push({
          pid,
          sessionId: null,
          nickname:  profile?.nickname ?? "Unknown",
          level:     profile?.level    ?? 1,
          hp:        profile?.hp       ?? 0,
          maxHp:     profile?.maxHp    ?? 100,
        });
      }
    });

    return JSON.stringify(roster);
  }

  /** Update PlayerState for all local members of a global party. */
  private updatePartyMemberStates(partyId: string): void {
    const party      = globalBus.getParty(partyId);
    const rosterJson = party ? this.buildRosterJson(partyId) : "";

    this.state.players.forEach((player, sessionId) => {
      const pid = this.sessionToPersistentId.get(sessionId);
      if (pid && party && party.members.has(pid)) {
        player.partyId      = partyId;
        player.isPartyOwner = (party.id === pid);
        player.partyName    = party.name;
        player.partyRoster  = rosterJson;
      } else if (pid && player.partyId === partyId) {
        // Only clear when we KNOW the pid and confirm they are no longer in the party.
        player.partyId      = "";
        player.isPartyOwner = false;
        player.partyName    = "";
        player.partyRoster  = "";
      }
    });
  }

  /**
   * Every ROSTER_SYNC_INTERVAL_MS, flush each party member's live HP to their
   * GlobalBus profile and trigger a cross-room roster refresh.  This keeps the
   * HP bars of away members fresh within a ~5 s window.
   */
  private tickPartyRosterSync(now: number): void {
    if (now - this.lastRosterSyncAt < GameRoom.ROSTER_SYNC_INTERVAL_MS) return;
    this.lastRosterSyncAt = now;

    const partiesNeedingRefresh = new Set<string>();

    this.state.players.forEach((player, sessionId) => {
      if (!player.partyId) return;
      const pid = this.sessionToPersistentId.get(sessionId);
      if (!pid) return;

      const profile = globalBus.getProfile(pid);
      if (profile && (profile.hp !== player.hp || profile.maxHp !== player.maxHp)) {
        globalBus.saveProfile(pid, { ...profile, hp: player.hp, maxHp: player.maxHp });
        partiesNeedingRefresh.add(player.partyId);
      }
    });

    partiesNeedingRefresh.forEach((partyId) => globalBus.refreshParty(partyId));
  }

  private disbandOrLeaveParty(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player || player.partyId === "") return;

    const pid = this.sessionToPersistentId.get(sessionId);
    if (!pid) return;

    const partyId = player.partyId;
    const isOwner = player.isPartyOwner;
    const nickname = player.nickname;

    if (isOwner) {
      this.sendPartyChat(partyId, "Party was disbanded");
      globalBus.disbandParty(partyId);
    } else {
      globalBus.leaveParty(partyId, pid);
      this.sendPartyChat(partyId, `${nickname} has left the party`);
    }
    
    this.updatePartyMemberStates(partyId);
  }

  // ── GM Commands ──────────────────────────────────────────────────────────────

  private handleGMCommand(client: Client, gmPlayer: PlayerState, message: string): void {
    const sendPrivate = (msg: string) => {
      client.send("chat", { sessionId: "server", nickname: "Server", message: msg });
    };

    const parts = message.split(/\s+/);
    const command = parts[0].toLowerCase();

    if (command === "/spawn") {
      // /spawn {enemy name} {number}
      const enemyName = parts[1];
      const count     = parseInt(parts[2] ?? "1", 10);

      if (!enemyName || !ENEMY_REGISTRY[enemyName]) {
        sendPrivate(`Unknown enemy type: "${enemyName ?? ""}". Check ENEMY_REGISTRY for valid names.`);
        return;
      }
      if (isNaN(count) || count <= 0 || count > 100) {
        sendPrivate("Invalid number. Must be between 1 and 100.");
        return;
      }

      const regDef = ENEMY_REGISTRY[enemyName];
      for (let i = 0; i < count; i++) {
        let spawned = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const x = gmPlayer.x + (Math.random() - 0.5) * 400; // ±200 px
          const y = gmPlayer.y + (Math.random() - 0.5) * 400;

          if (x < 32 || x > MAP_WIDTH - 32 || y < 32 || y > MAP_HEIGHT - 32) continue;
          if (this.isInNeutralZone(x, y)) continue;

          const id    = `enemy_${++this.enemyCounter}`;
          const enemy = new EnemyState();
          enemy.id        = id;
          enemy.type      = enemyName;
          enemy.x         = x;
          enemy.y         = y;
          enemy.direction = 0;
          enemy.isDead    = false;
          enemy.hp        = regDef.hp;
          enemy.maxHp     = regDef.hp;
          this.state.enemies.set(id, enemy);
          this.enemyAttackCooldowns.set(id, new Map());
          // No spawn def — these enemies don't respawn after being killed
          spawned = true;
          break;
        }
        if (!spawned) {
          sendPrivate("spawning enemies failed");
        }
      }

    } else if (command === "/kick") {
      // /kick {player nickname}
      const targetNick = parts.slice(1).join(" ");
      if (!targetNick) { sendPrivate("Usage: /kick {nickname}"); return; }

      const toKick: Array<{ sessionId: string; kickClient: Client }> = [];
      this.state.players.forEach((p, sid) => {
        if (p.nickname === targetNick && !p.isGM) {
          const kc = this.clients.find((c: Client) => c.sessionId === sid);
          if (kc) toKick.push({ sessionId: sid, kickClient: kc });
        }
      });

      if (toKick.length === 0) {
        sendPrivate(`Player "${targetNick}" not found.`);
        return;
      }

      for (const { sessionId, kickClient } of toKick) {
        this.kickedSessions.add(sessionId); // flag before leave so onLeave skips grace period
        this.disbandOrLeaveParty(sessionId);
        kickClient.send("chat", {
          sessionId: "server",
          nickname:  "Server",
          message:   "You were kicked out of the world.",
        });
        // Tell the client to clear its reconnect token BEFORE the socket closes,
        // so a page refresh will show the login screen and start a clean session.
        kickClient.send("kick", {});
        // Remove from game state immediately — don't wait for onLeave to fire.
        // onLeave will still run but cleanupPlayer will be a no-op (player already gone).
        this.cleanupPlayer(sessionId, true);
        kickClient.leave();
      }

    } else if (command === "/exp") {
      // /exp {amount} {player nickname}
      const amount     = parseInt(parts[1] ?? "", 10);
      const targetNick = parts.slice(2).join(" ");

      if (isNaN(amount) || amount <= 0) { sendPrivate("Usage: /exp {amount} {nickname}"); return; }
      if (!targetNick)                  { sendPrivate("Usage: /exp {amount} {nickname}"); return; }

      let found = false;
      this.state.players.forEach((p, sid) => {
        if (p.nickname === targetNick && !p.isGM) {
          p.xp += amount;
          this.checkLevelUp(sid);
          found = true;
        }
      });
      if (!found) sendPrivate(`Player "${targetNick}" not found.`);

    } else if (command === "/gold") {
      // /gold {amount} {player nickname}
      const amount     = parseInt(parts[1] ?? "", 10);
      const targetNick = parts.slice(2).join(" ");

      if (isNaN(amount) || amount <= 0) { sendPrivate("Usage: /gold {amount} {nickname}"); return; }
      if (!targetNick)                  { sendPrivate("Usage: /gold {amount} {nickname}"); return; }

      let found = false;
      this.state.players.forEach((p, sid) => {
        if (p.nickname === targetNick && !p.isGM) {
          p.gold += amount;
          const targetClient = this.clients.find((c: Client) => c.sessionId === sid);
          if (targetClient) {
            targetClient.send("chat", {
              sessionId: "server",
              nickname:  "Server",
              message:   `You received ${amount} gold from the Game Master.`,
            });
          }
          found = true;
        }
      });
      if (!found) sendPrivate(`Player "${targetNick}" not found.`);

    } else {
      sendPrivate(`Unknown command: ${command}. Available: /spawn, /kick, /exp, /gold`);
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

    const regDef = ENEMY_REGISTRY[enemy.type];

    // Award XP (with party sharing)
    this.awardXP(killerSessionId, regDef?.xpReward ?? 0, enemy.x, enemy.y);

    // Gold drop — any enemy type with goldChance > 0 can drop
    const goldAmount = regDef?.goldAmount ?? 0;
    const goldChance = regDef?.goldChance ?? 0;
    if (goldAmount > 0 && Math.random() < goldChance) {
      const coinId = `coin_${++this.coinCounter}`;
      this.pendingCoins.set(coinId, {
        id: coinId,
        x: enemy.x,
        y: enemy.y,
        amount: goldAmount,
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

    const party = globalBus.getParty(killer.partyId);
    if (!party) { killer.xp += xpAmount; this.checkLevelUp(killerSessionId); return; }

    // Collect ALL members of this party who are currently in THIS room and nearby
    const SHARE_RANGE = 640;
    const eligibleMembers: string[] = [];
    
    this.state.players.forEach((p, sid) => {
      const pid = this.sessionToPersistentId.get(sid);
      if (pid && party.members.has(pid) && !p.isDead) {
        const dx = p.x - enemyX;
        const dy = p.y - enemyY;
        if (Math.sqrt(dx * dx + dy * dy) <= SHARE_RANGE) {
          eligibleMembers.push(sid);
        }
      }
    });

    if (eligibleMembers.length === 0) { killer.xp += xpAmount; this.checkLevelUp(killerSessionId); return; }

    const share = Math.floor(xpAmount / eligibleMembers.length);
    eligibleMembers.forEach(sid => {
      const member = this.state.players.get(sid);
      if (member) { member.xp += share; this.checkLevelUp(sid); }
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
   * Award gold to `recipientId`. If they are in a party, split with nearby members IN THIS ROOM.
   */
  private distributeGoldToParty(recipientId: string, amount: number, coinX: number, coinY: number): void {
    const recipient = this.state.players.get(recipientId);
    if (!recipient) return;

    if (recipient.partyId === "") {
      recipient.gold += amount;
      this.sendGoldNotification(recipientId, amount);
      return;
    }

    const party = globalBus.getParty(recipient.partyId);
    if (!party) {
      recipient.gold += amount;
      this.sendGoldNotification(recipientId, amount);
      return;
    }

    const SHARE_RANGE = 640;
    const eligibleMembers: string[] = [];
    this.state.players.forEach((p, sid) => {
      const pid = this.sessionToPersistentId.get(sid);
      if (pid && party.members.has(pid) && !p.isDead) {
        const dx = p.x - coinX;
        const dy = p.y - coinY;
        if (Math.sqrt(dx * dx + dy * dy) <= SHARE_RANGE) eligibleMembers.push(sid);
      }
    });

    if (eligibleMembers.length === 0) {
      recipient.gold += amount;
      this.sendGoldNotification(recipientId, amount);
      return;
    }

    const share = Math.ceil(amount / eligibleMembers.length);
    for (const sid of eligibleMembers) {
      const member = this.state.players.get(sid);
      if (member) {
        member.gold += share;
        this.sendGoldNotification(sid, share);
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
