import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";

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

const TREE_SPRITES = ["tree1", "tree2", "tree3"];

// Enemy AI
const ENEMY_AGGRO_RANGE  = 320;  // px  (5 tiles × 64 px) — enemy gives up beyond this
const ENEMY_SPEED        = 100;  // px / s
const ENEMY_ATTACK_RANGE = 48;   // px — enter melee range
const ENEMY_COUNT        = 10;
const ENEMY_RESPAWN_MS   = 10_000;

// "hit" enemy stats
const HIT_ENEMY_HP      = 15;
const HIT_ENEMY_XP      = 100;
const HIT_ENEMY_DAMAGE  = 1;
const HIT_ATTACK_CD_MS  = 200;   // 1 dmg every 0.2 s = 5 DPS

// Player weapon
const BLUE_SWORD_BASE_DMG = 5;
const WEAPON_HIT_CD_MS    = 1_000;  // 1 hit per second per player→enemy pair
const PLAYER_ATTACK_ANIM_MS = 350;

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

interface AttackMessage {
  direction: number;
}

interface LastPos {
  x: number;
  y: number;
  time: number;
}

// ─── XP / Levelling ──────────────────────────────────────────────────────────

/** XP needed to advance from `level` to `level + 1`. */
function xpForNextLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.1, level - 1));
}

// ─── Combat helpers ───────────────────────────────────────────────────────────

function getHitbox(
  cx: number, cy: number, direction: number, expand = 0,
): { x0: number; y0: number; x1: number; y1: number } {
  // Sprites are 64×64, origin at centre. `expand` pushes the far edge outward.
  switch (direction) {
    case 3: return { x0: cx,           y0: cy - 32, x1: cx + 32 + expand, y1: cy + 32 }; // right
    case 1: return { x0: cx - 32 - expand, y0: cy - 32, x1: cx,           y1: cy + 32 }; // left
    case 2: return { x0: cx - 32, y0: cy - 32 - expand, x1: cx + 32,      y1: cy      }; // up
    case 0: return { x0: cx - 32, y0: cy,      x1: cx + 32, y1: cy + 32 + expand };      // down
    default: return { x0: cx,     y0: cy - 32, x1: cx + 32, y1: cy + 32 };
  }
}

function isInsideHitbox(
  cx: number, cy: number, direction: number,
  targetX: number, targetY: number,
  expand = 0,
): boolean {
  const hb = getHitbox(cx, cy, direction, expand);
  return targetX >= hb.x0 && targetX <= hb.x1 &&
         targetY >= hb.y0 && targetY <= hb.y1;
}

// ─── Room ─────────────────────────────────────────────────────────────────────

export class GameRoom extends Room<GameState> {
  maxClients = 50;

  private treeData: TreeData[] = [];
  private lastPositions = new Map<string, LastPos>();

  // ── Enemy bookkeeping ──────────────────────────────────────────────────────
  private enemyCounter = 0;

  /** enemyId → Map<playerId, lastAttackTimestamp> */
  private enemyAttackCooldowns = new Map<string, Map<string, number>>();

  /** playerId → Map<enemyId, lastHitTimestamp> */
  private playerHitCooldowns = new Map<string, Map<string, number>>();

  /** Enemies waiting to respawn */
  private respawnQueue: Array<{ type: string; spawnAt: number }> = [];

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

    // ── Generate 150 random trees ────────────────────────────────────────────
    for (let i = 0; i < 150; i++) {
      this.treeData.push({
        x: 80 + Math.random() * (MAP_WIDTH  - 160),
        y: 80 + Math.random() * (MAP_HEIGHT - 160),
        sprite: TREE_SPRITES[Math.floor(Math.random() * TREE_SPRITES.length)],
      });
    }

    // ── Spawn initial enemies ─────────────────────────────────────────────────
    for (let i = 0; i < ENEMY_COUNT; i++) {
      this.spawnEnemy("hit");
    }

    // ── AI simulation loop (20 Hz) ────────────────────────────────────────────
    this.setSimulationInterval((dt) => this.tickEnemyAI(dt), 50);

    // ── Message handlers ──────────────────────────────────────────────────────

    this.onMessage("get_map", (client) => {
      client.send("map_data", { trees: this.treeData });
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

      // Auto-equip weapon if not equipped
      if (!player.showWeapon) player.showWeapon = true;

      player.isAttacking    = true;
      player.attackDirection = direction;

      // Reset attack animation flag after PLAYER_ATTACK_ANIM_MS
      setTimeout(() => {
        const p = this.state.players.get(client.sessionId);
        if (p) p.isAttacking = false;
      }, PLAYER_ATTACK_ANIM_MS);

      this.applyPlayerAttack(client.sessionId, direction);
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

  // ── AI game loop ─────────────────────────────────────────────────────────────

  private tickEnemyAI(dt: number): void {
    const now   = Date.now();
    const dtSec = dt / 1000;

    // Process respawn queue
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      if (now >= this.respawnQueue[i].spawnAt) {
        this.spawnEnemy(this.respawnQueue[i].type);
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

  private applyPlayerAttack(sessionId: string, direction: number): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    const totalDamage = BLUE_SWORD_BASE_DMG + player.attackBonus;
    const now         = Date.now();
    const cdMap       = this.playerHitCooldowns.get(sessionId);
    if (!cdMap) return;

    this.state.enemies.forEach((enemy, enemyId) => {
      if (enemy.isDead) return;
      if (!isInsideHitbox(player.x, player.y, direction, enemy.x, enemy.y, 10)) return;

      const lastHit = cdMap.get(enemyId) ?? 0;
      if (now - lastHit < WEAPON_HIT_CD_MS) return;

      cdMap.set(enemyId, now);
      enemy.hp = Math.max(0, enemy.hp - totalDamage);

      if (enemy.hp <= 0) {
        this.killEnemy(enemyId, sessionId);
      }
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
    setTimeout(() => {
      this.state.enemies.delete(enemyId);
      this.enemyAttackCooldowns.delete(enemyId);
    }, 500);

    // Queue respawn
    this.respawnQueue.push({ type: enemy.type, spawnAt: Date.now() + ENEMY_RESPAWN_MS });

    // Award XP (with party sharing)
    this.awardXP(killerSessionId, HIT_ENEMY_XP, enemy.x, enemy.y);
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

    const eligible: string[] = [];
    members.forEach(memberId => {
      const member = this.state.players.get(memberId);
      if (!member || member.isDead) return;
      const dx = member.x - enemyX;
      const dy = member.y - enemyY;
      if (Math.sqrt(dx * dx + dy * dy) <= SHARE_RANGE) eligible.push(memberId);
    });

    if (eligible.length === 0) { killer.xp += xpAmount; this.checkLevelUp(killerSessionId); return; }

    const share = Math.floor(xpAmount / eligible.length);
    eligible.forEach(memberId => {
      const member = this.state.players.get(memberId);
      if (member) { member.xp += share; this.checkLevelUp(memberId); }
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
