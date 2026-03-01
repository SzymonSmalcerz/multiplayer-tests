import Phaser from "phaser";
import { Client } from "colyseus.js";
import {
  GameSceneData, MapDataMessage, RemotePlayer, RemotePlayerEntity,
  StaticObjectData, EnemyData, EnemyEntity, NpcData, TilePlacement, DoorData,
} from "./types";
import { StaticObjectDef } from "../shared/staticObjects";
import { WeaponDef } from "../shared/weapons";
import { MOB_REGISTRY } from "../shared/mobs";
import { MobSystem } from "./MobSystem";
import { ShopUI } from "./ui/ShopUI";
import { EquipmentUI } from "./ui/EquipmentUI";
import { HealerShopUI } from "./ui/HealerShopUI";
import { ActionBarUI } from "./ui/ActionBarUI";
import { SKINS_TO_LOAD, getSkinForLevel, isTierBoundary, FRAME_W as FRAME_SIZE } from "./skins";
import {
  xpForNextLevel,
  worldToMinimapOffset,
  sortLeaderboard,
  findPath as findPathLogic,
  MINIMAP_SIZE,
  VIEW_RADIUS,
  MINIMAP_SCALE,
} from "./logic";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAYER_SPEED        = 200;   // px/s — client prediction speed
const SEND_RATE_MS        = 50;    // send position @ 20 Hz
const LERP_FACTOR         = 0.18;  // interpolation factor for remote players / enemies
const RECONCILE_THRESHOLD = 120;   // px — snap if server disagrees by more than this
const ANIM_FPS            = 10;
const ATTACK_ANIM_MS      = 750;   // sword orbit animation duration (ms)
const ATTACK_COOLDOWN_MS  = 1000;  // ms between attacks

// All sprite files — preloaded so any player's chosen skin renders correctly at every tier

// Player collision box (pixel coords within the 64×64 sprite frame)
const PLAYER_BODY_X      = 26;
const PLAYER_BODY_Y      = 47;
const PLAYER_BODY_WIDTH  = 39 - 26;  // 13 px
const PLAYER_BODY_HEIGHT = 54 - 47;  //  7 px

// Click-to-move / pathfinding
const NAV_CELL           = 16;  // px per nav-grid cell
const WAYPOINT_THRESHOLD = 8;   // px — advance to next waypoint when within this range

// Minimap constants — defined in logic.ts, re-exported for use here

// Maps direction index (0=down,1=left,2=up,3=right) → walk animation suffix
const DIR_NAMES = ["walk_down", "walk_left", "walk_up", "walk_right"] as const;

// Sprite-sheet row → walk animation name
const ROW_ANIM_NAMES = ["walk_up", "walk_left", "walk_down", "walk_right"] as const;

// Direction index → sprite-sheet row  (down→row2, left→row1, up→row0, right→row3)
const DIR_TO_ROW = [2, 1, 0, 3] as const;

// Direction index → walk/attack state name (dir 0=down, 1=left/side, 2=up; 3=right uses flipX)
const DIR_WALK_STATE   = ["walk_down",   "walk_side",   "walk_up"  ] as const;
const DIR_ATTACK_STATE = ["attack_down", "attack_side", "attack_up"] as const;

// Converts "male/5lvl_blond" → "male_5lvl_blond" (Phaser texture key)
function skinKey(skin: string): string {
  return skin.replace("/", "_");
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class GameScene extends Phaser.Scene {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private room!: any; // Colyseus.Room
  private mySessionId!: string;

  private localSkin!: string;
  private localNickname!: string;

  // Local player
  private localSprite!: Phaser.Physics.Arcade.Sprite;
  private localLabel!: Phaser.GameObjects.Text;
  private localChatBubble?: Phaser.GameObjects.Text;
  private localDirection = 0;
  private localWeapon!: Phaser.GameObjects.Image;
  private localWeaponKey = "sword";
  private weaponsRegistry: Record<string, WeaponDef> = {};
  private localLevel = 1;

  // Map / doors
  private currentMapName = "m1";
  private doors: DoorData[] = [];
  private doorSprites = new Map<string, Phaser.GameObjects.Image>();
  private isTeleporting = false;

  // Private session
  private passcode = "";
  private sessionName = "";
  private isSessionEnded = false;

  // Global leaderboard (updated by server every 3 s)
  private globalLeaderboardData: Array<{ nickname: string; level: number; xp: number; partyName: string }> | null = null;

  // Local attack state
  private localIsAttacking = false;
  private localAttackDir   = 0;
  private localAttackTimer = 0;
  private localAttackCooldownTimer = 0;

  // Local death state
  private localGrave?: Phaser.GameObjects.Image;
  private diedOverlay?: Phaser.GameObjects.Rectangle;
  private diedText?: Phaser.GameObjects.Text;
  private countdownText?: Phaser.GameObjects.Text;
  private localIsDead    = false;
  private localDeathTimer = 0;

  private loadingOverlay?: Phaser.GameObjects.Graphics;
  private loadingText?:    Phaser.GameObjects.Text;

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyI!: Phaser.Input.Keyboard.Key;
  private keyU!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyEnter!: Phaser.Input.Keyboard.Key;

  // Remote players
  private remoteMap = new Map<string, RemotePlayerEntity>();

  // Enemies
  private enemyMap = new Map<string, EnemyEntity>();

  // Chat UI elements
  private chatInputWrap!: HTMLElement;
  private chatInput!: HTMLInputElement;
  private chatDisplay!: HTMLElement;
  private isTyping = false;

  // Static objects
  private staticObjectsGroup!: Phaser.Physics.Arcade.StaticGroup;
  private animatedObjectsGroup!: Phaser.Physics.Arcade.StaticGroup;
  private mapVisualsGroup!: Phaser.GameObjects.Group;
  private objectsRegistry: Record<string, StaticObjectDef> = {};
  private bgTileSprite!: Phaser.GameObjects.TileSprite;
  private tilesRegistry: Record<string, { type: string; imageWidth: number; imageHeight: number }> = {};

  // HUD
  private hudHpBar!:     Phaser.GameObjects.Graphics;
  private hudPotionBar!: Phaser.GameObjects.Graphics; // green incoming-heal overlay on HP bar
  private hudXpBar!:     Phaser.GameObjects.Graphics;
  private hudHpText!:    Phaser.GameObjects.Text;
  private hudXpText!:    Phaser.GameObjects.Text;
  private hudGoldText!:  Phaser.GameObjects.Text;

  // HUD dirty-flag cache — avoids redundant Graphics redraws each frame
  private hudLastHpFillW   = -1;
  private hudLastHpText    = "";
  private hudLastPotionKey = "";
  private hudLastXpFillW   = -1;
  private hudLastXpText    = "";
  private hudLastGoldText  = "";

  // Party roster parse cache — only re-parse when the JSON string changes
  private cachedRosterJson = "";
  private cachedRoster: Array<{ pid: string; sessionId: string | null; nickname: string; level: number; hp: number; maxHp: number }> = [];

  // Party state
  private myPartyId      = "";
  private myIsPartyOwner = false;
  private ignoreNextMapClick = false;
  private playerActionMenu?: { bg: Phaser.GameObjects.Graphics; btn: Phaser.GameObjects.Text };
  private playerActionMenuTargetId?: string;
  private partyInvitePopup?: {
    bg: Phaser.GameObjects.Graphics;
    titleText: Phaser.GameObjects.Text;
    acceptBtn: Phaser.GameObjects.Text;
    refuseBtn: Phaser.GameObjects.Text;
  };
  private partyInviteFromId?: string;
  private partyHudRows: Array<{
    bg: Phaser.GameObjects.Graphics;
    hpBar: Phaser.GameObjects.Graphics;
    xpBar: Phaser.GameObjects.Graphics;
    nameText: Phaser.GameObjects.Text;
    kickBtn: Phaser.GameObjects.Text;
  }> = [];
  private localPartyLabel?: Phaser.GameObjects.Text;
  private partyHudHeaderBg!: Phaser.GameObjects.Graphics;
  private partyHudHeaderText!: Phaser.GameObjects.Text;
  private partyHudLeaveBtn!: Phaser.GameObjects.Text;
  private partyHudRenameBtn!: Phaser.GameObjects.Text;

  // Minimap
  private minimapOpen       = false;
  private minimapIcon!:       Phaser.GameObjects.Image;
  private minimapBg!:         Phaser.GameObjects.Graphics;
  private minimapDots!:       Phaser.GameObjects.Graphics;
  private minimapBorder!:     Phaser.GameObjects.Graphics;
  private minimapCloseBtn!:   Phaser.GameObjects.Text;
  private minimapNorthLabel!: Phaser.GameObjects.Text;
  private keyM!:              Phaser.Input.Keyboard.Key;

  // Pending UI states to restore after map change
  private pendingActionBarState: any = null;
  private pendingEquipmentState: any = null;
  private pendingMapData: MapDataMessage | null = null;
  private pendingAddPlayers: Array<{ player: RemotePlayer; sessionId: string }> = [];
  private pendingAddEnemies: Array<{ enemy: EnemyData; id: string }> = [];
  private pendingChatMessages: Array<{ sessionId: string; nickname: string; message: string }> = [];
  private isCreated = false;

  // Leaderboard
  private leaderboardBg!:     Phaser.GameObjects.Graphics;
  private leaderboardHeader!: Phaser.GameObjects.Text;
  private leaderboardRows:    Phaser.GameObjects.Text[] = [];

  // Nav grid for click-to-move
  private navGrid = new Uint8Array(0);
  private navCols = 0;
  private navRows = 0;

  // Active path waypoints
  private pathWaypoints: { x: number; y: number }[] = [];
  private pathIndex = 0;
  // Stuck detection: if position doesn't change for this long, abandon the path
  private pathStuckTimer = 0;   // ms elapsed without movement
  private pathPrevX     = 0;
  private pathPrevY     = 0;

  // Coin animations — keyed by server coin ID
  private coinAnimations = new Map<string, { sprite: Phaser.GameObjects.Sprite; timer: Phaser.Time.TimerEvent }>();

  // Trader shop
  private shopUI!: ShopUI;
  // Equipment panel
  private equipmentUI!: EquipmentUI;
  // Healer shop
  private healerShopUI!: HealerShopUI;
  // Action bar
  private actionBarUI!: ActionBarUI;
  private npcPositions: Array<{ type: string; x: number; y: number }> = [];

  // Mobs (client-side only, purely decorative)
  private mobSystem!: MobSystem;

  // Weapon HUD (bottom-right)
  private weaponHudBg!:      Phaser.GameObjects.Graphics;
  private weaponHudIcon!:    Phaser.GameObjects.Image;
  private weaponHudOverlay!: Phaser.GameObjects.Graphics;
  private weaponHudBorder!:  Phaser.GameObjects.Graphics;
  private weaponHudHitArea!: Phaser.GameObjects.Rectangle;

  // Timing
  private lastSendTime = 0;

  constructor() {
    super({ key: "GameScene" });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(data: GameSceneData): void {
    console.log(`[Scene] Init for map: ${data.mapName ?? "m1"}. Has leaderboard data: ${!!data.leaderboardData}`);
    this.room             = data.room;
    this.localNickname    = data.nickname;
    this.localSkin        = data.skin;
    this.passcode         = data.passcode ?? "";
    this.sessionName      = data.sessionName ?? "";
    this.mySessionId      = data.room.sessionId as string;
    this.currentMapName   = data.mapName ?? "m1";
    this.isTeleporting    = false;
    this.isSessionEnded   = false;
    this.isCreated        = false;
    this.localLevel       = 0;
    this.localIsDead      = false;
    // Keep passcode and current map name in localStorage fresh for reconnect
    if (this.passcode) localStorage.setItem("roomPasscode", this.passcode);
    localStorage.setItem("mapName", this.currentMapName);
    
    // Clear all tracking maps and buffers
    this.remoteMap.clear();
    this.enemyMap.clear();
    this.pendingAddPlayers = [];
    this.pendingAddEnemies = [];
    this.pendingChatMessages = [];
    this.pendingMapData = null;
    this.doors = [];
    this.doorSprites.clear();
    this.partyHudRows = [];

    // Keep globalLeaderboardData across map changes — it's cross-map data and stays valid.
    if (data.leaderboardData) {
      this.globalLeaderboardData = data.leaderboardData;
      console.log(`[Scene] Restored ${this.globalLeaderboardData.length} leaderboard entries.`);
    }
    
    // Restore UI states from map change
    this.pendingActionBarState = data.actionBarState || null;
    this.pendingEquipmentState = data.equipmentState || null;

    // Fetch chat elements early so they are available for displayChatMessage
    this.chatInputWrap = document.getElementById("chat-input-wrap")!;
    this.chatInput     = document.getElementById("chat-input") as HTMLInputElement;
    this.chatDisplay   = document.getElementById("chat-display")!;

    this.setupRoomListeners();

    this.localWeaponKey   = "";   // force texture sync on first update frame of new scene

    // Reset HUD dirty-flag cache so bars are fully redrawn on first frame of new scene
    this.hudLastHpFillW   = -1;
    this.hudLastHpText    = "";
    this.hudLastPotionKey = "";
    this.hudLastXpFillW   = -1;
    this.hudLastXpText    = "";
    this.hudLastGoldText  = "";
    this.cachedRosterJson = "";
    this.cachedRoster     = [];

    // Keep reconnection token fresh — it may change after a reconnect
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (data.room as any).reconnectionToken as string | undefined;
    if (token) localStorage.setItem("reconnToken", token);

    // Ensure waiting-room overlay is hidden on every scene restart
    const wrOverlay = document.getElementById("waiting-room-overlay");
    if (wrOverlay) wrOverlay.style.display = "none";

    console.log(`[DIAG] init() complete — map=${this.currentMapName} isCreated=${this.isCreated}`);
  }

  preload(): void {
    console.log(`[DIAG] preload() START — map=${this.currentMapName}`);
    // Add loader error tracking
    this.load.on("loaderror", (file: any) => {
      console.error(`[Loader] Failed to load asset: ${file.key} from ${file.url}`);
    });
    this.load.once("complete", () => {
      console.log(`[DIAG] preload() COMPLETE (loader done) — map=${this.currentMapName}`);
    });

    // Player sprite sheets
    for (const skin of SKINS_TO_LOAD) {
      this.load.spritesheet(skinKey(skin), `/assets/player/${skin}.png`, {
        frameWidth: FRAME_SIZE, frameHeight: FRAME_SIZE,
      });
    }
    // GM sprite sheet (single file, no level tiers)
    this.load.spritesheet("gm", "/assets/player/gm.png", {
      frameWidth: FRAME_SIZE, frameHeight: FRAME_SIZE,
    });

    // Helper: executes callback immediately if JSON already cached (scene restart),
    // otherwise loads the JSON then fires the callback on completion.
    const loadRegistry = (key: string, url: string, callback: () => void) => {
      if (this.cache.json.exists(key)) {
        callback();
      } else {
        this.load.json(key, url);
        this.load.once(`filecomplete-json-${key}`, callback);
      }
    };

    // Background tiles — loaded dynamically from tiles registry
    loadRegistry("tiles_registry", "/design/tiles", () => {
      const defs = (this.cache.json.get("tiles_registry") ?? {}) as Record<string, { type: string; imageWidth: number; imageHeight: number }>;
      for (const def of Object.values(defs)) {
        if (!this.textures.exists(def.type)) this.load.image(def.type, `/assets/tiles/${def.type}.png`);
      }
    });
    this.load.image("minimap_icon",  "/assets/maps/minimap_icon.png");
    this.load.image("door_to_map",   "/assets/maps/door_to_map.png");

    // Click-to-move markers
    this.load.image("x_green", "/assets/shortestPath/xGreen.png");
    this.load.image("x_red",   "/assets/shortestPath/xRed.png");

    // All static object images — loaded from objects.json (built-ins + user-added).
    // Animated objects (frameCount > 1) are loaded as spritesheets so Phaser can slice frames.
    loadRegistry("objects_registry", "/assets/entities/objects.json", () => {
      const defs = (this.cache.json.get("objects_registry") ?? {}) as Record<string, StaticObjectDef>;
      for (const [key, def] of Object.entries(defs)) {
        if (this.textures.exists(key)) continue;
        const spritePath = def.spritePath ?? `/assets/entities/${key}.png`;
        if ((def.frameCount ?? 1) > 1) {
          this.load.spritesheet(key, spritePath, { frameWidth: def.imageWidth, frameHeight: def.imageHeight });
        } else {
          this.load.image(key, spritePath);
        }
      }
    });

    // Mob sprite sheets (client-side only, no server logic)
    for (const [key, def] of Object.entries(MOB_REGISTRY)) {
      if (!this.textures.exists(key)) {
        this.load.spritesheet(key, `/assets/mobs/${key}.png`, {
          frameWidth:  def.frameWidth,
          frameHeight: def.frameHeight,
        });
      }
    }

    // Weapon sprites — loaded dynamically from weapons.json (texture key = weapon.type)
    loadRegistry("weapons_registry", "/assets/weapons/weapons.json", () => {
      const defs = (this.cache.json.get("weapons_registry") ?? {}) as Record<string, WeaponDef>;
      for (const def of Object.values(defs)) {
        if (!this.textures.exists(def.type)) this.load.image(def.type, def.spritePath);
      }
    });

    // Equipment panel background
    this.load.image("eq_background", "/assets/design/eq_background.png");

    // Consumables
    this.load.image("health_potion", "/assets/consumable/health_potion.png");

    // NPC sprites
    this.load.image("trader", "/assets/npcs/trader.png");
    this.load.image("healer", "/assets/npcs/healer.png");

    // Enemy spritesheets — loaded dynamically from enemies.json
    loadRegistry("enemies_registry", "/assets/enemies/enemies.json", () => {
      const defs = this.cache.json.get("enemies_registry") as
        Record<string, { frameWidth: number; frameHeight: number; spritePath: string }>;
      for (const [type, def] of Object.entries(defs)) {
        if (!this.textures.exists(`enemy_${type}`)) {
          this.load.spritesheet(`enemy_${type}`, def.spritePath, {
            frameWidth:  def.frameWidth,
            frameHeight: def.frameHeight,
          });
        }
      }
    });

    // Grave shown at player's death location
    this.load.image("grave", "/assets/deathState/grave.png");

    // Coin spin spritesheet (20×20 px per frame, 4 frames stacked vertically)
    this.load.spritesheet("coins", "/assets/utils/coins.png", {
      frameWidth: 20, frameHeight: 20,
    });
  }

  create(): void {
    console.log(`[DIAG] create() START — map=${this.currentMapName} pendingMapData=${!!this.pendingMapData}`);
    // ── Background ─────────────────────────────────────────────────────────
    // Start with grass_basic; updated to the map's defaultTile when map_data arrives
    this.tilesRegistry = (this.cache.json.get("tiles_registry") ?? {}) as Record<string, { type: string; imageWidth: number; imageHeight: number }>;
    const firstTile = Object.keys(this.tilesRegistry)[0] ?? "grass_basic";
    // Use || 2000 fallback: room.state may not be synced yet when the scene starts after travelToMap
    const initMapW = (this.room.state.mapWidth  as number) || 2000;
    const initMapH = (this.room.state.mapHeight as number) || 2000;
    this.bgTileSprite = this.add.tileSprite(0, 0, initMapW, initMapH, firstTile).setOrigin(0, 0).setDepth(0);
    console.log(`[DIAG] bgTileSprite created — texture=${firstTile} mapW=${initMapW} (stateW=${this.room.state.mapWidth}) mapH=${initMapH} (stateH=${this.room.state.mapHeight}) active=${this.bgTileSprite.active}`);

    // ── Physics world bounds ────────────────────────────────────────────────
    this.physics.world.setBounds(0, 0, initMapW, initMapH);

    // ── Static object groups ─────────────────────────────────────────────────
    this.staticObjectsGroup    = this.physics.add.staticGroup();
    this.animatedObjectsGroup  = this.physics.add.staticGroup({ classType: Phaser.Physics.Arcade.Sprite });
    this.mapVisualsGroup       = this.add.group();

    // ── Object registry (populated from objects.json loaded in preload) ────────
    this.objectsRegistry = (this.cache.json.get("objects_registry") ?? {}) as Record<string, StaticObjectDef>;

    // ── Animations ─────────────────────────────────────────────────────────
    this.createAnimations();

    // ── Local player ────────────────────────────────────────────────────────
    this.createLocalPlayer(initMapW / 2, initMapH / 2);

    // ── HUD ─────────────────────────────────────────────────────────────────
    this.createHUD();
    this.createPartyHUD();
    this.createMinimap();

    // ── Waiting room UI (replaces all HUD / minimap for waitingArea) ────────────
    if (this.currentMapName === "waitingArea") {
      this.createWaitingRoomUI();
    } else if (this.localSkin === "gm" && this.passcode) {
      // GM passcode badge (shown on normal maps only)
      const w = this.cameras.main.width;
      this.add.text(w / 2, 10, `Session: ${this.passcode}`, {
        fontSize:        "13px",
        color:           "#ff8800",
        backgroundColor: "rgba(0,0,0,0.55)",
        padding:         { x: 8, y: 4 },
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(99990);
    }

    // ── Mark created and flush buffers ─────────────────────────────────────
    this.isCreated = true;
    console.log(`[DIAG] isCreated=true — pendingMapData=${!!this.pendingMapData} pendingPlayers=${this.pendingAddPlayers.length} pendingEnemies=${this.pendingAddEnemies.length}`);

    // Apply early network data
    if (this.pendingMapData) {
      console.log(`[DIAG] Flushing pendingMapData`);
      this.applyMapData(this.pendingMapData);
    } else {
      console.log(`[DIAG] No pendingMapData — will wait for get_map response`);
    }

    this.pendingAddPlayers.forEach(({ player, sessionId }) => this.doAddPlayer(player, sessionId));
    this.pendingAddPlayers = [];

    this.pendingAddEnemies.forEach(({ enemy, id }) => this.addEnemy(enemy, id));
    this.pendingAddEnemies = [];

    this.pendingChatMessages.forEach(msg => this.displayChatMessage(msg));
    this.pendingChatMessages = [];

    // Request fresh map data once world is ready
    console.log(`[DIAG] Sending get_map request`);
    this.room.send("get_map");

    // ── Snap to Authoritative Position ─────────────────────────────────────
    const myState = this.room.state.players.get(this.mySessionId);
    if (myState && this.localSprite) {
      console.log(`[Scene] Snapping to server position: ${myState.x}, ${myState.y}`);
      this.localSprite.setPosition(myState.x, myState.y);
    }

    // ── Death UI (hidden by default) ─────────────────────────────────────────
    this.createDeathUI();

    // ── Camera ──────────────────────────────────────────────────────────────
    {
      const mapW = (this.room.state.mapWidth  as number) || 2000;
      const mapH = (this.room.state.mapHeight as number) || 2000;
      const camW = this.cameras.main.width;
      const camH = this.cameras.main.height;
      // Center small maps (e.g. waitingArea 300×300) inside the viewport
      if (mapW < camW || mapH < camH) {
        const offsetX = mapW < camW ? -Math.floor((camW - mapW) / 2) : 0;
        const offsetY = mapH < camH ? -Math.floor((camH - mapH) / 2) : 0;
        this.cameras.main.setBounds(offsetX, offsetY, Math.max(mapW, camW), Math.max(mapH, camH));
      } else {
        this.cameras.main.setBounds(0, 0, mapW, mapH);
      }
    }
    this.cameras.main.startFollow(this.localSprite, true, 0.08, 0.08);

    // NPCs are placed after map_data is received (see setupRoomListeners)

    // ── Weapon registry (populated from preloaded weapons.json) ─────────────
    this.weaponsRegistry = (this.cache.json.get("weapons_registry") ?? {}) as Record<string, WeaponDef>;
    const shopWeapons = Object.values(this.weaponsRegistry).filter(w => w.cost > 0).sort((a, b) => a.cost - b.cost);

    // ── Shop UI ──────────────────────────────────────────────────────────────
    this.shopUI = new ShopUI(
      this,
      shopWeapons,
      () => {
        const ps = this.room.state.players.get(this.mySessionId);
        return ps ? { gold: ps.gold as number, weapon: ps.weapon as string } : null;
      },
      (weaponKey) => { this.room.send("buy_weapon", { weapon: weaponKey }); },
      () => { this.ignoreNextMapClick = true; },
    );

    // ── Action Bar UI ─────────────────────────────────────────────────────────
    this.actionBarUI = new ActionBarUI(
      this,
      () => {
        const ps = this.room.state.players.get(this.mySessionId);
        if (!ps) return null;
        return {
          potions:             ps.potions             as number,
          potionHealRemaining: ps.potionHealRemaining as number,
          hp:    ps.hp    as number,
          maxHp: ps.maxHp as number,
        };
      },
      (itemType) => {
        if (itemType === "health_potion") this.room.send("use_potion");
      },
      () => { this.ignoreNextMapClick = true; },
    );
    if (this.pendingActionBarState) this.actionBarUI.importState(this.pendingActionBarState);
    if (this.currentMapName !== "waitingArea") this.actionBarUI.build();

    // ── Equipment UI ─────────────────────────────────────────────────────────
    this.equipmentUI = new EquipmentUI(
      this,
      this.weaponsRegistry,
      () => {
        const ps = this.room.state.players.get(this.mySessionId);
        if (!ps) return null;
        return {
          weapon:              ps.weapon              as string,
          potions:             ps.potions             as number,
          potionHealRemaining: ps.potionHealRemaining as number,
          hp:    ps.hp    as number,
          maxHp: ps.maxHp as number,
        };
      },
      () => { this.room.send("use_potion"); },
      () => { this.ignoreNextMapClick = true; },
      this.actionBarUI,
    );
    if (this.pendingEquipmentState) this.equipmentUI.importState(this.pendingEquipmentState);

    // ── Healer Shop UI ────────────────────────────────────────────────────────
    this.healerShopUI = new HealerShopUI(
      this,
      () => {
        const ps = this.room.state.players.get(this.mySessionId);
        return ps ? { gold: ps.gold as number, potions: ps.potions as number } : null;
      },
      () => { this.room.send("buy_potion"); },
      () => { this.ignoreNextMapClick = true; },
    );

    // ── Weapon HUD ───────────────────────────────────────────────────────────
    this.createWeaponHUD();

    // ── Mob system ───────────────────────────────────────────────────────────
    this.mobSystem = new MobSystem(this);
    this.events.once("shutdown", () => this.mobSystem.destroy());

    // ── Input ────────────────────────────────────────────────────────────────
    this.input.enabled = true;
    if (this.input.keyboard) {
      this.input.keyboard.enabled = true;
      this.input.keyboard.addCapture([
        Phaser.Input.Keyboard.KeyCodes.W,
        Phaser.Input.Keyboard.KeyCodes.A,
        Phaser.Input.Keyboard.KeyCodes.S,
        Phaser.Input.Keyboard.KeyCodes.D,
        Phaser.Input.Keyboard.KeyCodes.SPACE,
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.DOWN,
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
      ]);
    }

    this.cursors  = this.input.keyboard!.createCursorKeys();
    this.keyW     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyI     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.keyU     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.U);
    this.keyM     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    this.keySpace = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyEnter = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    // ── Disable right-click context menu on canvas ───────────────────────────
    this.input.mouse?.disableContextMenu();

    // ── Chat UI ──────────────────────────────────────────────────────────────
    this.setupChatUI();

    // ── Keys 1–4 → action bar ────────────────────────────────────────────────
    this.input.keyboard!.on("keydown-ONE",   () => { if (!this.isTyping) this.actionBarUI.activateSlot(0); });
    this.input.keyboard!.on("keydown-TWO",   () => { if (!this.isTyping) this.actionBarUI.activateSlot(1); });
    this.input.keyboard!.on("keydown-THREE", () => { if (!this.isTyping) this.actionBarUI.activateSlot(2); });
    this.input.keyboard!.on("keydown-FOUR",  () => { if (!this.isTyping) this.actionBarUI.activateSlot(3); });

    // ── I key → equipment panel ───────────────────────────────────────────────
    this.keyI.on("down", () => {
      if (this.isTyping) return;
      this.shopUI.close();
      this.healerShopUI.close();
      this.equipmentUI.toggle();
    });

    // ── Space key → attack ────────────────────────────────────────────────────
    this.keySpace.on("down", () => {
      if (this.isTyping) return;
      this.triggerAttack();
    });

    // ── U key → un-equip weapon ───────────────────────────────────────────────
    this.keyU.on("down", () => {
      if (this.isTyping) return;
      const ps = this.room.state.players.get(this.mySessionId);
      if (ps?.showWeapon) this.room.send("toggle_weapon");
    });

    this.keyM.on("down", () => {
      if (this.isTyping) return;
      this.toggleMinimap();
    });

    // ── Click / tap to move ──────────────────────────────────────────────────
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.isTyping) return;
      // Block map clicks while any UI panel is open
      if (this.shopUI.isShopOpen || this.healerShopUI.isHealerShopOpen || this.equipmentUI.isEquipmentOpen) return;
      // Sprite click handlers set this flag first; scene fires after
      if (this.ignoreNextMapClick) {
        this.ignoreNextMapClick = false;
        return;
      }
      this.hidePlayerActionMenu();
      this.onMapClick(pointer.worldX, pointer.worldY);
    });
  }

  // ── Attack ─────────────────────────────────────────────────────────────────

  private triggerAttack(): void {
    if (this.currentMapName === "waitingArea") return;
    if (this.localIsAttacking) return;          // already mid-swing
    if (this.localIsDead) return;
    if (this.localAttackCooldownTimer > 0) return; // still on cooldown

    this.room.send("attack", { direction: this.localDirection });

    // Optimistically start attack animation
    this.localIsAttacking        = true;
    this.localAttackDir          = this.localDirection;
    this.localAttackTimer        = ATTACK_ANIM_MS;
    this.localAttackCooldownTimer = ATTACK_COOLDOWN_MS;
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  private setupChatUI(): void {
    if (!this.chatInputWrap || !this.chatInput || !this.chatDisplay) return;

    this.keyEnter.on("down", () => {
      if (!this.isTyping) {
        this.startTyping();
      } else {
        this.stopTyping(true);
      }
    });

    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.isTyping) { this.stopTyping(false); return; }
      this.shopUI?.close();
      this.healerShopUI?.close();
      this.equipmentUI?.close();
    });
  }

  private startTyping(): void {
    this.isTyping = true;
    this.chatInputWrap.style.display = "block";
    this.chatInput.focus();
    this.chatInput.value = "";

    if (this.input.keyboard) {
      this.input.keyboard.enabled = false;
      this.input.keyboard.clearCaptures();
    }

    const onEnter = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        this.stopTyping(true);
        this.chatInput.removeEventListener("keydown", onEnter);
      } else if (e.key === "Escape") {
        this.stopTyping(false);
        this.chatInput.removeEventListener("keydown", onEnter);
      }
    };
    this.chatInput.addEventListener("keydown", onEnter);
  }

  private stopTyping(send: boolean): void {
    const message = this.chatInput.value.trim();
    if (send && message.length > 0) {
      this.room.send("chat", message);
    }

    this.isTyping = false;
    this.chatInputWrap.style.display = "none";
    this.chatInput.blur();

    if (this.input.keyboard) {
      this.input.keyboard.enabled = true;
      this.input.keyboard.addCapture([
        Phaser.Input.Keyboard.KeyCodes.W,
        Phaser.Input.Keyboard.KeyCodes.A,
        Phaser.Input.Keyboard.KeyCodes.S,
        Phaser.Input.Keyboard.KeyCodes.D,
        Phaser.Input.Keyboard.KeyCodes.SPACE,
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.DOWN,
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
      ]);
    }
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  update(time: number, delta: number): void {
    // Safety check: if scene is shutting down or room is disposed, stop updates immediately
    if (!this.scene.isActive() || !this.room || !this.room.state) return;

    // Always read party state from live server state — never rely on cached value alone
    const myState = this.room.state.players.get(this.mySessionId);
    if (!myState) return;

    this.myPartyId      = myState?.partyId      ?? "";
    this.myIsPartyOwner = myState?.isPartyOwner ?? false;

    this.handleLocalMovement(delta);
    this.interpolateRemotePlayers(delta);
    this.updateEnemies();
    this.mobSystem.update();

    if (this.currentMapName === "waitingArea") {
      this.sendPositionIfNeeded(time);
      return;
    }

    this.updateHUD();
    this.updatePartyHUD();
    this.updateLeaderboard();

    this.repositionMinimapUI();
    if (this.minimapOpen) {
      this.updateMinimap();
    }

    this.tickDeathTimer(delta);
    this.updateWeaponHUD();

    // ── Consumable UI live updates ────────────────────────────────────────────
    const potions     = (myState?.potions             as number) ?? 0;
    const healPool    = (myState?.potionHealRemaining as number) ?? 0;
    const hp          = (myState?.hp    as number) ?? 0;
    const maxHp       = (myState?.maxHp as number) ?? 100;
    this.actionBarUI.update(potions, healPool, hp, maxHp);
    if (this.equipmentUI.isEquipmentOpen) {
      this.equipmentUI.updateItems(potions, healPool, hp, maxHp);
    }
    this.sendPositionIfNeeded(time);
  }

  // ── HUD ────────────────────────────────────────────────────────────────────

  // ── Waiting Room UI ─────────────────────────────────────────────────────────

  private createWaitingRoomUI(): void {
    const overlay = document.getElementById("waiting-room-overlay");
    const gmUi    = document.getElementById("wr-gm-ui");
    const plUi    = document.getElementById("wr-player-ui");
    if (!overlay || !gmUi || !plUi) return;

    overlay.style.display = "block";

    if (this.localSkin === "gm") {
      gmUi.style.display = "block";
      plUi.style.display = "none";

      const passEl = document.getElementById("wr-passcode");
      if (passEl) passEl.textContent = `Session Code: ${this.passcode}`;

      // Clone the button to clear any stale listeners from a previous session
      const btn = document.getElementById("wr-start-btn");
      if (btn) {
        const freshBtn = btn.cloneNode(true) as HTMLButtonElement;
        btn.parentNode?.replaceChild(freshBtn, btn);
        freshBtn.addEventListener("click", () => {
          this.room.send("start_session");
          freshBtn.disabled = true;
          freshBtn.textContent = "Starting…";
        });
      }
    } else {
      gmUi.style.display = "none";
      plUi.style.display = "block";

      const titleEl = document.getElementById("wr-title");
      if (titleEl) {
        titleEl.textContent = this.sessionName && this.sessionName !== "Unnamed Session"
          ? `Welcome to "${this.sessionName}"`
          : "Welcome to the Waiting Room";
      }
    }
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────

  private createHUD(): void {
    if (this.currentMapName === "waitingArea") return;
    const D = 99998;

    // Dark background panel
    this.add.graphics()
      .fillStyle(0x000000, 0.55)
      .fillRect(8, 8, 204, 50)
      .setScrollFactor(0)
      .setDepth(D);

    // HP bar background (dark red)
    this.add.graphics()
      .fillStyle(0x660000, 1)
      .fillRect(12, 14, 192, 13)
      .setScrollFactor(0)
      .setDepth(D + 1);

    // XP bar background (dark blue)
    this.add.graphics()
      .fillStyle(0x000066, 1)
      .fillRect(12, 32, 192, 13)
      .setScrollFactor(0)
      .setDepth(D + 1);

    // HP fill bar (redrawn each frame)
    this.hudHpBar = this.add.graphics()
      .setScrollFactor(0)
      .setDepth(D + 2);

    // Potion incoming-heal overlay on HP bar (green segment, redrawn each frame)
    this.hudPotionBar = this.add.graphics()
      .setScrollFactor(0)
      .setDepth(D + 2);

    // XP fill bar (redrawn each frame)
    this.hudXpBar = this.add.graphics()
      .setScrollFactor(0)
      .setDepth(D + 2);

    // HP text
    this.hudHpText = this.add.text(14, 14, "HP: 100/100", {
      fontSize: "11px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setScrollFactor(0).setDepth(D + 3);

    // XP text
    this.hudXpText = this.add.text(14, 32, "XP: 0/100", {
      fontSize: "11px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setScrollFactor(0).setDepth(D + 3);

    // Gold panel (to the right of HP/XP panel)
    this.add.graphics()
      .fillStyle(0x000000, 0.55)
      .fillRect(218, 8, 80, 20)
      .setScrollFactor(0)
      .setDepth(D);

    this.hudGoldText = this.add.text(222, 12, "Gold: 0", {
      fontSize: "11px",
      color: "#ffd700",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setScrollFactor(0).setDepth(D + 1);
  }

  private updateHUD(): void {
    if (this.currentMapName === "waitingArea") return;
    const p = this.room.state.players.get(this.mySessionId);
    if (!p) return;

    // Detect death / respawn transitions
    const isDead = !!p.isDead;
    if (isDead !== this.localIsDead) {
      this.localIsDead = isDead;
      if (isDead) {
        this.onLocalPlayerDied();
      } else {
        this.onLocalPlayerRespawned();
      }
    }

    const maxBarW = 192;

    // HP bar — only redraw when the fill width changes
    const hpRatio  = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const hpFillW  = Math.floor(maxBarW * hpRatio);
    if (hpFillW !== this.hudLastHpFillW) {
      this.hudLastHpFillW = hpFillW;
      this.hudHpBar.clear();
      this.hudHpBar.fillStyle(0xff3333, 1);
      this.hudHpBar.fillRect(12, 14, hpFillW, 13);
    }
    const hpText = `HP: ${Math.floor(p.hp)}/${p.maxHp}`;
    if (hpText !== this.hudLastHpText) {
      this.hudLastHpText = hpText;
      this.hudHpText.setText(hpText);
    }

    // Potion incoming-heal overlay — only redraw when overlay geometry changes
    const potionRemaining = (p.potionHealRemaining as number) ?? 0;
    const poolCapped = potionRemaining > 0 ? Math.min(potionRemaining, p.maxHp - p.hp) : 0;
    const poolW      = Math.floor(maxBarW * Math.max(0, poolCapped / (p.maxHp || 1)));
    const potionKey  = `${hpFillW}:${poolW}`;
    if (potionKey !== this.hudLastPotionKey) {
      this.hudLastPotionKey = potionKey;
      this.hudPotionBar.clear();
      if (poolW > 0) {
        this.hudPotionBar.fillStyle(0x44ff88, 0.8);
        this.hudPotionBar.fillRect(12 + hpFillW, 14, poolW, 13);
      }
    }

    // XP bar — only redraw when fill width changes
    const xpNeeded = xpForNextLevel(p.level);
    const xpFillW  = Math.floor(maxBarW * Math.max(0, Math.min(1, p.xp / xpNeeded)));
    if (xpFillW !== this.hudLastXpFillW) {
      this.hudLastXpFillW = xpFillW;
      this.hudXpBar.clear();
      this.hudXpBar.fillStyle(0x3399ff, 1);
      this.hudXpBar.fillRect(12, 32, xpFillW, 13);
    }
    const xpText = `XP: ${Math.floor(p.xp)}/${xpNeeded}  Lv.${p.level}`;
    if (xpText !== this.hudLastXpText) {
      this.hudLastXpText = xpText;
      this.hudXpText.setText(xpText);
    }

    // Gold display
    const goldText = `Gold: ${p.gold ?? 0}`;
    if (goldText !== this.hudLastGoldText) {
      this.hudLastGoldText = goldText;
      this.hudGoldText.setText(goldText);
    }

    // Update nickname label and sprite when level changes
    if (p.level !== this.localLevel) {
      this.localLevel = p.level;
      if (p.isGM) {
        this.localLabel.setText(`${this.localNickname} [GM]`);
      } else {
        this.localLabel.setText(`${this.localNickname} [Lv.${p.level}]`);
        // Swap spritesheet when crossing a tier boundary (5, 10, 15, …)
        if (isTierBoundary(p.level)) {
          const newKey = skinKey(getSkinForLevel(this.localSkin, p.level));
          if (this.textures.exists(newKey) && this.localSprite.texture.key !== newKey) {
            this.localSprite.setTexture(newKey, DIR_TO_ROW[this.localDirection] * 9);
          }
        }
      }
    }
  }

  // ── Party HUD ──────────────────────────────────────────────────────────────

  private createPartyHUD(): void {
    if (this.currentMapName === "waitingArea") return;
    const D       = 99998;
    const ROW_H   = 32;
    const ROW_GAP = 4;
    const HEADER_H = 18;
    const START_Y = 66 + HEADER_H + 2; // member rows below header

    // Party header (hidden when not in party)
    this.partyHudHeaderBg = this.add.graphics().setScrollFactor(0).setDepth(D);

    this.partyHudHeaderText = this.add.text(12, 68, "◆ Party", {
      fontSize: "11px",
      color: "#77aaff",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setScrollFactor(0).setDepth(D + 1).setVisible(false);

    this.partyHudLeaveBtn = this.add.text(210, 68, "Leave", {
      fontSize: "11px",
      color: "#ff9966",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 1)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.partyHudLeaveBtn.on("pointerover", () => this.partyHudLeaveBtn.setColor("#ff5533"));
    this.partyHudLeaveBtn.on("pointerout",  () => this.partyHudLeaveBtn.setColor("#ff9966"));
    this.partyHudLeaveBtn.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      this.room.send("party_leave");
    });

    this.partyHudRenameBtn = this.add.text(150, 68, "✎", {
      fontSize: "12px",
      color: "#aaaaaa",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 1)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.partyHudRenameBtn.on("pointerover", () => this.partyHudRenameBtn.setColor("#ffffff"));
    this.partyHudRenameBtn.on("pointerout",  () => this.partyHudRenameBtn.setColor("#aaaaaa"));
    this.partyHudRenameBtn.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      const current = this.room.state.players.get(this.mySessionId)?.partyName ?? "";
      const newName = window.prompt("Party name (max 20 characters):", current);
      if (newName !== null) {
        const trimmed = newName.trim().slice(0, 20);
        if (trimmed.length > 0) this.room.send("party_rename", { name: trimmed });
      }
    });

    for (let i = 0; i < 4; i++) {
      const y = START_Y + i * (ROW_H + ROW_GAP);

      const bg    = this.add.graphics().setScrollFactor(0).setDepth(D);
      const hpBar = this.add.graphics().setScrollFactor(0).setDepth(D + 2);
      const xpBar = this.add.graphics().setScrollFactor(0).setDepth(D + 2);

      const nameText = this.add.text(14, y + 4, "", {
        fontSize: "11px",
        color: "#77aaff",
        stroke: "#000000",
        strokeThickness: 2,
        resolution: 2,
      }).setScrollFactor(0).setDepth(D + 3).setVisible(false);

      const kickBtn = this.add.text(210, y + 4, "Kick", {
        fontSize: "10px",
        color: "#ff9966",
        stroke: "#000000",
        strokeThickness: 2,
        resolution: 2,
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 3).setVisible(false)
        .setInteractive({ useHandCursor: true });

      kickBtn.on("pointerover", () => kickBtn.setColor("#ff5533"));
      kickBtn.on("pointerout",  () => kickBtn.setColor("#ff9966"));
      kickBtn.on("pointerdown", () => {
        this.ignoreNextMapClick = true;
        const targetPid = kickBtn.getData("targetPid") as string;
        if (targetPid) this.room.send("party_kick", { targetPid });
      });

      this.partyHudRows.push({ bg, hpBar, xpBar, nameText, kickBtn });
    }
  }

  private updatePartyHUD(): void {
    if (this.currentMapName === "waitingArea") return;
    const ROW_H    = 32;
    const ROW_GAP  = 4;
    const HEADER_H = 18;
    const START_Y  = 66 + HEADER_H + 2;
    const PANEL_W  = 204;
    const BAR_W   = 192;

    // Collect other party members in stable order (with sessionId for kick)
    const members: Array<{ targetPid: string; nickname: string; level: number; hp: number; maxHp: number; isAway: boolean }> = [];
    const inParty = this.myPartyId !== "";

    // Show/hide party header
    this.partyHudHeaderBg.clear();
    if (inParty) {
      this.partyHudHeaderBg.fillStyle(0x000000, 0.55).fillRect(8, 66, PANEL_W, HEADER_H);
    }
    const myPartyName = this.room.state.players.get(this.mySessionId)?.partyName ?? "Party";
    this.partyHudHeaderText
      .setText(`◆ ${myPartyName}`)
      .setVisible(inParty);
    this.partyHudLeaveBtn
      .setText(this.myIsPartyOwner ? "Disband" : "Leave")
      .setVisible(inParty);
    this.partyHudRenameBtn.setVisible(inParty && this.myIsPartyOwner);

    if (inParty) {
      const myState = this.room.state.players.get(this.mySessionId);
      if (myState && myState.partyRoster) {
        try {
          // Reparse only when the JSON string changes (not every frame)
          if (myState.partyRoster !== this.cachedRosterJson) {
            this.cachedRosterJson = myState.partyRoster;
            this.cachedRoster = JSON.parse(myState.partyRoster);
          }
          const roster = this.cachedRoster;

          roster.forEach((m) => {
            if (m.sessionId === this.mySessionId) return; // Skip self

            // Look up live state by sessionId (O(1), collision-proof)
            const liveState: RemotePlayer | undefined = m.sessionId
              ? this.room.state.players.get(m.sessionId) ?? undefined
              : undefined;

            members.push({
              targetPid: m.pid,
              nickname:  m.nickname,
              level:     m.level,
              hp:        liveState ? liveState.hp : m.hp,
              maxHp:     liveState ? liveState.maxHp : m.maxHp,
              isAway:    !liveState,
            });
          });
        } catch (e) {
          console.error("Failed to parse party roster", e);
        }
      }
    }

    for (let i = 0; i < 4; i++) {
      const row = this.partyHudRows[i];
      const y   = START_Y + i * (ROW_H + ROW_GAP);

      row.bg.clear();
      row.hpBar.clear();
      row.xpBar.clear();

      if (i < members.length) {
        const m      = members[i];
        const hpRatio = Math.max(0, Math.min(1, m.hp / m.maxHp));

        // Panel background
        row.bg.fillStyle(0x000000, 0.55).fillRect(8, y, PANEL_W, ROW_H);
        // HP bar track
        row.bg.fillStyle(0x660000, 1).fillRect(12, y + 20, BAR_W, 8);

        if (m.isAway) {
          // Full solid grey bar for away players
          row.hpBar.fillStyle(0x666666, 1).fillRect(12, y + 20, BAR_W, 8);
        } else {
          // Standard HP bar for local players
          row.hpBar.fillStyle(0xff3333, 1).fillRect(12, y + 20, Math.floor(BAR_W * hpRatio), 8);
        }

        const nameLabel = m.isAway ? `${m.nickname} (Away)` : m.nickname;
        row.nameText
          .setText(nameLabel)
          .setPosition(14, y + 4)
          .setVisible(true);

        row.kickBtn
          .setData("targetPid", m.targetPid)
          .setVisible(this.myIsPartyOwner);
      } else {
        row.nameText.setVisible(false);
        row.kickBtn.setVisible(false);
      }
    }

    // Refresh remote player label + partyLabel colors every frame (avoids stale onChange timing)
    this.remoteMap.forEach((entity, sessionId) => {
      const rp = this.room.state.players.get(sessionId);
      if (!rp) return;
      const inParty = this.myPartyId !== "" && rp.partyId === this.myPartyId;
      const color = inParty ? "#77aaff" : "#ffff44";
      entity.label.setColor(color);
      if (entity.partyLabel) entity.partyLabel.setColor(color);
    });
  }

  // ── Minimap ────────────────────────────────────────────────────────────────

  private createMinimap(): void {
    if (this.currentMapName === "waitingArea") return;
    const D = 99990;
    const camW = this.cameras.main.width;

    // 1. Icon (visible by default)
    this.minimapIcon = this.add.image(camW - 56, 8, "minimap_icon")
      .setDisplaySize(48, 48)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(D)
      .setInteractive({ useHandCursor: true });

    this.minimapIcon.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      this.openMinimap();
    });

    this.minimapIcon.on("pointerover", () => this.minimapIcon.setTint(0xdddddd));
    this.minimapIcon.on("pointerout",  () => this.minimapIcon.clearTint());

    // 2. Background
    const mmX = camW - 208;
    const mmY = 8;
    this.minimapBg = this.add.graphics()
      .fillStyle(0x111111, 0.85)
      .fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE)
      .lineStyle(1, 0x334433, 1)
      .strokeRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE)
      .setScrollFactor(0)
      .setDepth(D)
      .setPosition(mmX, mmY)
      .setVisible(false);

    // 3. Dots
    this.minimapDots = this.add.graphics()
      .setScrollFactor(0)
      .setDepth(D + 1)
      .setVisible(false);

    // 4. Close button
    this.minimapCloseBtn = this.add.text(camW - 16, 12, "×", {
      fontSize: "20px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(1, 0)
    .setScrollFactor(0)
    .setDepth(D + 2)
    .setVisible(false)
    .setInteractive({ useHandCursor: true });

    this.minimapCloseBtn.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      this.closeMinimap();
    });

    // 5. North label
    this.minimapNorthLabel = this.add.text(mmX + MINIMAP_SIZE / 2, mmY + 4, "N", {
      fontSize: "10px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 1,
    })
    .setOrigin(0.5, 0)
    .setScrollFactor(0)
    .setDepth(D + 2)
    .setVisible(false);

    this.createLeaderboard();
    
    // If we already have global data (restored in init), show it immediately
    if (this.globalLeaderboardData && this.globalLeaderboardData.length > 0) {
      this.updateLeaderboard();
    }
  }

  private openMinimap(): void {
    this.minimapOpen = true;
    this.minimapIcon.setVisible(false);
    this.minimapBg.setVisible(true);
    this.minimapDots.setVisible(true);
    this.minimapCloseBtn.setVisible(true);
    this.minimapNorthLabel.setVisible(true);
  }

  private closeMinimap(): void {
    this.minimapOpen = false;
    this.minimapIcon.setVisible(true);
    this.minimapBg.setVisible(false);
    this.minimapDots.setVisible(false);
    this.minimapCloseBtn.setVisible(false);
    this.minimapNorthLabel.setVisible(false);
  }

  private toggleMinimap(): void {
    if (this.minimapOpen) this.closeMinimap();
    else this.openMinimap();
  }

  private repositionMinimapUI(): void {
    const camW = this.cameras.main.width;
    const mmX = camW - 208;
    const mmY = 8;
    this.minimapIcon.setPosition(camW - 56, 8);
    if (this.minimapOpen) {
      this.minimapBg.setPosition(mmX, mmY);
      this.minimapCloseBtn.setPosition(camW - 16, 12);
      this.minimapNorthLabel.setPosition(mmX + MINIMAP_SIZE / 2, mmY + 4);
    }
  }

  private updateMinimap(): void {
    if (this.currentMapName === "waitingArea") return;
    if (!this.scene.isActive() || !this.minimapBg || !this.minimapBg.active) return;
    this.minimapDots.clear();
    const camW = this.cameras.main.width;
    const mmX = camW - 208;
    const mmY = 8;
    const mmCenterX = mmX + MINIMAP_SIZE / 2;
    const mmCenterY = mmY + MINIMAP_SIZE / 2;

    const localX = this.localSprite.x;
    const localY = this.localSprite.y;

    // 1. Enemies
    this.enemyMap.forEach((e) => {
      if (e.isDead) return;
      const dx = e.sprite.x - localX;
      const dy = e.sprite.y - localY;
      if (Math.abs(dx) <= VIEW_RADIUS && Math.abs(dy) <= VIEW_RADIUS) {
        const off = worldToMinimapOffset(dx, dy);
        this.minimapDots.fillStyle(0xff4444, 1);
        this.minimapDots.fillCircle(mmCenterX + off.x, mmCenterY + off.y, 2);
      }
    });

    // 2. Remote Players
    this.remoteMap.forEach((e, sid) => {
      if (e.isDead) return;
      const dx = e.sprite.x - localX;
      const dy = e.sprite.y - localY;
      if (Math.abs(dx) <= VIEW_RADIUS && Math.abs(dy) <= VIEW_RADIUS) {
        const off = worldToMinimapOffset(dx, dy);
        const dotX = mmCenterX + off.x;
        const dotY = mmCenterY + off.y;
        
        const rp = this.room.state.players.get(sid);
        const inParty = this.myPartyId !== "" && rp.partyId === this.myPartyId;
        const color = inParty ? 0x77aaff : 0xffff44;

        this.minimapDots.fillStyle(color, 1);
        this.minimapDots.fillCircle(dotX, dotY, 3);
      }
    });

    // 3. NPCs (white dots — always visible on minimap)
    for (const npc of this.npcPositions) {
      const dx = npc.x - localX;
      const dy = npc.y - localY;
      const off = worldToMinimapOffset(dx, dy);
      const dotX = mmCenterX + off.x;
      const dotY = mmCenterY + off.y;
      // clamp to minimap circle radius
      if (Math.abs(off.x) <= MINIMAP_SIZE / 2 && Math.abs(off.y) <= MINIMAP_SIZE / 2) {
        this.minimapDots.fillStyle(0xffffff, 1);
        this.minimapDots.fillCircle(dotX, dotY, 3);
      }
    }

    // 4. Local Player (Green dot at center)
    this.minimapDots.fillStyle(0x44ff44, 1);
    this.minimapDots.fillCircle(mmCenterX, mmCenterY, 4);
  }

  // ── Leaderboard ────────────────────────────────────────────────────────────

  private createLeaderboard(): void {
    const D = 99990;
    const camW = this.cameras.main.width;
    const lbX = camW - 208;
    const lbY = 216;

    this.leaderboardRows = [];

    this.leaderboardBg = this.add.graphics()
      .fillStyle(0x111111, 0.85)
      .fillRect(0, 0, MINIMAP_SIZE, 120)
      .lineStyle(1, 0x334433, 1)
      .strokeRect(0, 0, MINIMAP_SIZE, 120)
      .setScrollFactor(0)
      .setDepth(D)
      .setPosition(lbX, lbY)
      .setVisible(true);

    this.leaderboardHeader = this.add.text(lbX + MINIMAP_SIZE / 2, lbY + 8, "🏆 Top Players", {
      fontSize: "13px",
      color: "#ffcc44",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0.5, 0)
    .setScrollFactor(0)
    .setDepth(D + 1)
    .setVisible(true);

    for (let i = 0; i < 5; i++) {
      const row = this.add.text(lbX + 8, lbY + 32 + i * 16, "", {
        fontSize: "11px",
        color: i === 0 ? "#ffcc44" : "#cccccc",
        stroke: "#000000",
        strokeThickness: 1,
      })
      .setScrollFactor(0)
      .setDepth(D + 1)
      .setVisible(true);

      this.leaderboardRows.push(row);
    }
  }

  private updateLeaderboard(): void {
    if (this.currentMapName === "waitingArea") return;
    // Safety check: skip if UI is destroyed
    if (!this.leaderboardBg || !this.leaderboardBg.active) {
      return;
    }

    const camW = this.cameras.main.width;
    const lbX = camW - 208;
    const lbY = this.minimapOpen ? 216 : 64;

    this.leaderboardBg.setPosition(lbX, lbY);
    this.leaderboardHeader.setPosition(lbX + MINIMAP_SIZE / 2, lbY + 8);

    // Prefer cross-map global data; fall back to local room players until first broadcast
    let top5: Array<{ nickname: string; level: number; xp: number; partyName: string }> = [];
    if (this.globalLeaderboardData && this.globalLeaderboardData.length > 0) {
      top5 = this.globalLeaderboardData.slice(0, 5);
    } else {
      const allPlayers: Array<{ nickname: string; level: number; xp: number; partyName: string }> = [];
      this.room.state.players.forEach((p: RemotePlayer) => {
        if (!p.isDead) {
          allPlayers.push({ nickname: p.nickname, level: p.level, xp: p.xp, partyName: p.partyName });
        }
      });
      top5 = sortLeaderboard(allPlayers).slice(0, 5);
    }

    // Diagnostic log for data presence
    if (top5.length > 0 && this.leaderboardRows.length > 0) {
      // console.log(`[Leaderboard] Rendering ${top5.length} entries at ${lbX},${lbY}. Rows ready: ${this.leaderboardRows.length}`);
    }

    // If we truly have NO players (even local), keep the existing rows visible if they were already there.
    if (top5.length === 0 && this.leaderboardRows.some(r => r.visible)) {
      return;
    }

    let currentY = lbY + 32;

    for (let i = 0; i < 5; i++) {
      const row = this.leaderboardRows[i];
      if (!row || !row.active) continue;

      if (i < top5.length) {
        row.setPosition(lbX + 8, currentY);
        const p = top5[i];
        const partyTag = p.partyName ? ` [${p.partyName}]` : "";
        const rawContent = `${p.nickname}${partyTag} Lv.${p.level}`;
        
        let text = `${i + 1}. ${rawContent}`;
        if (rawContent.length > 20) {
          text = `${i + 1}. ${rawContent.slice(0, 20)}\n   ${rawContent.slice(20)}`;
        }

        row.setText(text);
        row.setVisible(true);

        // Advance Y for the next row — fallback to 20px if height is 0
        const h = row.height > 0 ? row.height : 18;
        currentY += h + 4; 
      } else {
        row.setVisible(false);
      }
    }

    // Dynamic background height
    const totalHeight = Math.max(120, (currentY - lbY) + 4);
    if (this.leaderboardBg && this.leaderboardBg.active) {
      this.leaderboardBg.clear();
      this.leaderboardBg.fillStyle(0x111111, 0.85);
      this.leaderboardBg.fillRect(0, 0, MINIMAP_SIZE, totalHeight);
      this.leaderboardBg.lineStyle(1, 0x334433, 1);
      this.leaderboardBg.strokeRect(0, 0, MINIMAP_SIZE, totalHeight);
    }
  }

  // ── Death UI ───────────────────────────────────────────────────────────────

  private createDeathUI(): void {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    this.diedOverlay = this.add.rectangle(0, 0, w, h, 0x000000, 0.7)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(100010)
      .setVisible(false);

    this.diedText = this.add.text(w / 2, h / 2 - 50, "YOU DIED", {
      fontSize: "56px",
      color: "#cc0000",
      stroke: "#000000",
      strokeThickness: 6,
      resolution: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(100011)
    .setVisible(false);

    this.countdownText = this.add.text(w / 2, h / 2 + 24, "10", {
      fontSize: "38px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4,
      resolution: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(100011)
    .setVisible(false);
  }

  private onLocalPlayerDied(): void {
    // Place grave at death position in world space
    this.localGrave = this.add.image(this.localSprite.x, this.localSprite.y, "grave");
    this.localGrave.setDisplaySize(32, 32);
    this.localGrave.setDepth(this.localSprite.y + FRAME_SIZE / 2);

    // Keep label above the grave
    this.localLabel.setPosition(this.localSprite.x, this.localSprite.y - 42);
    this.localPartyLabel?.setVisible(false);

    // Hide player visuals
    this.localSprite.setVisible(false);
    this.localWeapon.setVisible(false);
    this.localSprite.setVelocity(0, 0);
    this.localIsAttacking = false;

    // Show death screen
    this.diedOverlay?.setVisible(true);
    this.diedText?.setVisible(true);
    this.countdownText?.setText("10").setVisible(true);
    this.localDeathTimer = 10;
  }

  private onLocalPlayerRespawned(): void {
    // Remove grave
    this.localGrave?.destroy();
    this.localGrave = undefined;

    // Teleport sprite to server-authoritative respawn position
    const p = this.room.state.players.get(this.mySessionId);
    if (p) {
      this.localSprite.setPosition(p.x, p.y);
    }

    // Restore player visuals
    this.localSprite.setVisible(true);

    // Hide death screen
    this.diedOverlay?.setVisible(false);
    this.diedText?.setVisible(false);
    this.countdownText?.setVisible(false);

    this.localDeathTimer = 0;
  }

  private tickDeathTimer(delta: number): void {
    if (!this.localIsDead || this.localDeathTimer <= 0) return;
    this.localDeathTimer -= delta / 1000;
    const secs = Math.max(1, Math.ceil(this.localDeathTimer));
    this.countdownText?.setText(String(secs));

    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.diedOverlay?.setSize(w, h);
    this.diedText?.setPosition(w / 2, h / 2 - 50);
    this.countdownText?.setPosition(w / 2, h / 2 + 24);
  }

  // ── Setup helpers ──────────────────────────────────────────────────────────

  private createLocalPlayer(x: number, y: number): void {
    const key = this.localSkin === "gm" ? "gm" : skinKey(getSkinForLevel(this.localSkin, 1));
    this.localSprite = this.physics.add.sprite(x, y, key);
    this.localSprite.setCollideWorldBounds(true);
    this.localSprite.setDepth(y + FRAME_SIZE / 2);

    this.localWeapon = this.add.image(x, y, "sword");
    this.localWeapon.setDepth(this.localSprite.depth + 1);
    this.localWeapon.setVisible(false);

    const body = this.localSprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT);
    body.setOffset(PLAYER_BODY_X, PLAYER_BODY_Y);
    this.localSprite.play(`${key}_walk_down`);
    this.localSprite.stop();
    this.localSprite.setFrame(DIR_TO_ROW[0] * 9);

    this.localLabel = this.add
      .text(x, y - 42, this.localSkin === "gm" ? `${this.localNickname} [GM]` : `${this.localNickname} [Lv.1]`, {
        fontSize: "13px",
        color: "#44ff44",
        stroke: "#000000",
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(9999);

    this.localPartyLabel = this.add
      .text(x, y - 42, "", {
        fontSize: "12px",
        color: "#44ff44",
        stroke: "#000000",
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(9999)
      .setVisible(false);
  }

  private createAnimations(): void {
    // ── GM walk animations ────────────────────────────────────────────────────
    if (this.textures.exists("gm")) {
      for (let row = 0; row < 4; row++) {
        const start = row * 9;
        const end   = start + 8;
        const aKey  = `gm_${ROW_ANIM_NAMES[row]}`;
        if (!this.anims.exists(aKey)) {
          this.anims.create({
            key: aKey,
            frames: this.anims.generateFrameNumbers("gm", { start, end }),
            frameRate: ANIM_FPS,
            repeat: -1,
          });
        }
      }
    }

    // ── Player walk animations ────────────────────────────────────────────────
    for (const skin of SKINS_TO_LOAD) {
      const key = skinKey(skin);
      if (!this.textures.exists(key)) continue;

      for (let row = 0; row < 4; row++) {
        const start = row * 9;
        const end   = start + 8;
        const aKey  = `${key}_${ROW_ANIM_NAMES[row]}`;
        if (!this.anims.exists(aKey)) {
          this.anims.create({
            key: aKey,
            frames: this.anims.generateFrameNumbers(key, { start, end }),
            frameRate: ANIM_FPS,
            repeat: -1,
          });
        }
      }
    }

    // ── Enemy animations — generated dynamically from enemies_registry ──────────
    // Canonical spritesheet row order (all enemy types must follow this layout):
    //   0=idle  1=walk_up  2=walk_side(left)  3=walk_down
    //   4=attack_up  5=attack_side(left)  6=attack_down
    // Right-facing variants use the _side row + setFlipX(true) at runtime.
    const STATE_NAMES = [
      "idle",
      "walk_up", "walk_side", "walk_down",
      "attack_up", "attack_side", "attack_down",
    ] as const;

    const enemyDefs = this.cache.json.get("enemies_registry") as
      Record<string, { framesPerState: number }> | undefined;

    if (enemyDefs) {
      for (const [type, def] of Object.entries(enemyDefs)) {
        const texKey = `enemy_${type}`;
        if (!this.textures.exists(texKey)) continue;
        const N = def.framesPerState;

        STATE_NAMES.forEach((stateName, rowIndex) => {
          const animKey = `${type}_${stateName}`;
          if (this.anims.exists(animKey)) return;
          // Row R, N frames per state → frame indices [R*N .. R*N+N-1]
          const frames = Array.from({ length: N }, (_, i) => rowIndex * N + i);
          this.anims.create({
            key:       animKey,
            frames:    this.anims.generateFrameNumbers(texKey, { frames }),
            frameRate: 6,
            repeat:    -1,
          });
        });
      }
    }

    // ── Animated static object animations ────────────────────────────────────
    for (const [key, def] of Object.entries(this.objectsRegistry)) {
      if (!def.frameCount || def.frameCount <= 1) continue;
      if (!this.textures.exists(key)) continue;
      const animKey = `anim_${key}`;
      if (!this.anims.exists(animKey)) {
        this.anims.create({
          key:       animKey,
          frames:    this.anims.generateFrameNumbers(key, { start: 0, end: def.frameCount - 1 }),
          frameRate: def.frameRate ?? 8,
          repeat:    -1,
        });
      }
    }
  }

  private clearMap(): void {
    console.log("[Map] Clearing old map objects.");
    if (this.staticObjectsGroup)   this.staticObjectsGroup.clear(true, true);
    if (this.animatedObjectsGroup) this.animatedObjectsGroup.clear(true, true);
    if (this.mapVisualsGroup)      this.mapVisualsGroup.clear(true, true);
    if (this.mobSystem)            this.mobSystem.destroy();
    
    this.doors = [];
    this.doorSprites.clear();
  }

  private applyMapData(data: MapDataMessage): void {
    if (!this.bgTileSprite) return;

    // Dimensions come directly from the payload — never rely on room.state which may lag
    const mapW = data.mapWidth  || 2000;
    const mapH = data.mapHeight || 2000;

    this.clearMap();

    // Destroy the initial TileSprite and recreate with correct size to guarantee the
    // WebGL buffer is allocated properly (setSize() is unreliable for large rescales)
    this.bgTileSprite.destroy();
    const defaultTile = data.defaultTile && this.textures.exists(data.defaultTile)
      ? data.defaultTile
      : "grass_basic";
    this.bgTileSprite = this.add.tileSprite(0, 0, mapW, mapH, defaultTile).setOrigin(0, 0).setDepth(0);

    // Fix physics and camera bounds using the authoritative dimensions from the payload
    this.physics.world.setBounds(0, 0, mapW, mapH);
    const camW = this.cameras.main.width;
    const camH = this.cameras.main.height;
    if (mapW < camW || mapH < camH) {
      const offsetX = mapW < camW ? -Math.floor((camW - mapW) / 2) : 0;
      const offsetY = mapH < camH ? -Math.floor((camH - mapH) / 2) : 0;
      this.cameras.main.setBounds(offsetX, offsetY, Math.max(mapW, camW), Math.max(mapH, camH));
    } else {
      this.cameras.main.setBounds(0, 0, mapW, mapH);
    }

    console.log(`[Map] Applying map data. Tiles: ${data.tiles?.length ?? 0}, Objects: ${data.objects.length}`);

    this.placeTiles(data.tiles ?? []);
    this.placeStaticObjects(data.objects);
    this.buildNavGrid(data.objects);
    if (this.localSprite) {
      this.physics.add.collider(this.localSprite, this.staticObjectsGroup);
      this.physics.add.collider(this.localSprite, this.animatedObjectsGroup);
    }
    this.placeNpcs(data.npcs ?? []);
    if (this.mobSystem) this.mobSystem.createMobs(data.mobs ?? []);
    this.placeDoors(data.doors ?? []);
  }

  private setupRoomListeners(): void {
    this.room.onMessage("map_data", (data: MapDataMessage) => {
      console.log(`[DIAG] map_data received — map=${this.currentMapName} isCreated=${this.isCreated} tiles=${data.tiles?.length ?? 0} bgActive=${this.bgTileSprite?.active ?? "null"}`);
      this.pendingMapData = data;
      // If scene is already active/created, apply immediately.
      // Must use isCreated (not bgTileSprite) — bgTileSprite is not nulled in init()
      // so it still holds a stale destroyed reference during preload, causing a crash.
      if (this.isCreated) {
        console.log(`[DIAG] Applying map_data immediately (isCreated=true)`);
        this.applyMapData(data);
      } else {
        console.log(`[DIAG] Stored map_data in pendingMapData (isCreated=false)`);
      }
    });

    // Server confirmed travel — leave current room and join target
    this.room.onMessage("door_travel", (data: { targetMap: string; spawnX?: number; spawnY?: number }) => {
      void this.travelToMap(data.targetMap, data.spawnX, data.spawnY);
    });

    // Global leaderboard from server (aggregated across all maps)
    this.room.onMessage("global_leaderboard",
      (data: Array<{ nickname: string; level: number; xp: number; partyName: string }>) => {
        console.log(`[Network] Received leaderboard update. Count: ${data.length}`);
        this.globalLeaderboardData = data;
        if (this.isCreated) this.updateLeaderboard();
      }
    );

    // Player added
    this.room.state.players.onAdd((player: RemotePlayer, sessionId: string) => {
      if (!this.isCreated) {
        this.pendingAddPlayers.push({ player, sessionId });
        return;
      }
      this.doAddPlayer(player, sessionId);
    });

    // Player left
    this.room.state.players.onRemove((_player: RemotePlayer, sessionId: string) => {
      console.log(`[Network] onRemove player: ${sessionId}`);
      this.pendingAddPlayers = this.pendingAddPlayers.filter(p => p.sessionId !== sessionId);
      this.removeRemotePlayer(sessionId);
      if (this.isCreated) this.updateLeaderboard();
    });

    // Enemy added
    this.room.state.enemies.onAdd((enemy: EnemyData, id: string) => {
      if (!this.isCreated) {
        this.pendingAddEnemies.push({ enemy, id });
        return;
      }
      this.addEnemy(enemy, id);
    });

    // Enemy removed
    this.room.state.enemies.onRemove((_enemy: EnemyData, id: string) => {
      this.pendingAddEnemies = this.pendingAddEnemies.filter(e => e.id !== id);
      this.removeEnemy(id);
    });

    // Connection dropped (skip if we intentionally left to teleport)
    this.room.onLeave(() => { if (!this.isTeleporting) this.showDisconnectBanner(); });

    // Chat messages
    this.room.onMessage("chat", (data: { sessionId: string; nickname: string; message: string }) => {
      this.displayChatMessage(data);
    });

    // Kicked by GM — clear reconnect token so a page refresh starts a fresh session
    this.room.onMessage("kick", () => {
      localStorage.removeItem("reconnToken");
    });

    // GM's session ended — all players in the session receive this
    this.room.onMessage("session_ended", () => {
      this.isSessionEnded = true;
      localStorage.removeItem("reconnToken");
      localStorage.removeItem("roomPasscode");
      this.showSessionEndedBanner();
    });

    // Coin drop animation
    this.room.onMessage("coin_drop", (data: { id: string; x: number; y: number }) => {
      if (this.isCreated) this.spawnCoinAnimation(data.id, data.x, data.y);
    });

    // Coin collected or expired — stop the animation
    this.room.onMessage("coin_collected", (data: { id: string }) => {
      if (this.isCreated) this.removeCoinAnimation(data.id);
    });

    // Party invite received
    this.room.onMessage("party_invite", (data: { fromId: string; fromNickname: string }) => {
      if (this.isCreated) this.showPartyInvitePopup(data.fromId, data.fromNickname);
    });

    // Track local player's own state changes
    this.room.state.players.onChange((player: RemotePlayer, sessionId: string) => {
      if (sessionId !== this.mySessionId) return;

      // Position reconciliation
      if (this.localSprite) {
        const dx = Math.abs(player.x - this.localSprite.x);
        const dy = Math.abs(player.y - this.localSprite.y);
        if (dx > RECONCILE_THRESHOLD || dy > RECONCILE_THRESHOLD) {
          this.localSprite.setPosition(player.x, player.y);
        }
      }

      // Weapon change — swap sprite
      const newWeapon = player.weapon ?? "sword";
      if (newWeapon !== this.localWeaponKey) {
        this.localWeaponKey = newWeapon;
        if (this.localWeapon) this.localWeapon.setTexture(newWeapon);
      }

      // Party state change — update label colors of all remote players
      const newPartyId = player.partyId ?? "";
      const newIsOwner = player.isPartyOwner ?? false;

      if (newPartyId !== this.myPartyId || newIsOwner !== this.myIsPartyOwner) {
        this.myPartyId      = newPartyId;
        this.myIsPartyOwner = newIsOwner;
        this.remoteMap.forEach((entity, sid) => {
          const rp = this.room.state.players.get(sid);
          if (!rp) return;
          const inParty = rp.partyId !== "" && rp.partyId === this.myPartyId;
          entity.label.setColor(inParty ? "#77aaff" : "#ffff44");
          entity.partyId = rp.partyId ?? "";
        });
      }
    });
  }

  private doAddPlayer(player: RemotePlayer, sessionId: string): void {
    if (sessionId === this.mySessionId) {
      if (this.localSprite) {
        console.log(`[Scene] Identified local player ${sessionId}. Snapping to ${player.x}, ${player.y}`);
        this.localSprite.setPosition(player.x, player.y);
        // Immediately center the camera to avoid NaN scroll propagation when state
        // arrived after create() placed the sprite at the default (non-authoritative) position.
        this.cameras.main.scrollX = player.x - this.cameras.main.width  / 2;
        this.cameras.main.scrollY = player.y - this.cameras.main.height / 2;
      }
      this.updateLeaderboard();
      return;
    }

    if (this.remoteMap.has(sessionId)) {
      console.warn(`[Scene] Player ${sessionId} already exists in remoteMap. Updating state instead.`);
      // The onChange listener will handle state updates, so we can just return
      return;
    }

    this.addRemotePlayer(player, sessionId);
    this.updateLeaderboard();
  }

  // ── Remote player management ───────────────────────────────────────────────

  private addRemotePlayer(player: RemotePlayer, sessionId: string): void {
    const lv    = player.level ?? 1;
    const isGM  = player.isGM ?? false;
    let safeKey: string;
    if (isGM) {
      safeKey = this.textures.exists("gm") ? "gm" : "male_5lvl_grey";
    } else {
      const key = skinKey(getSkinForLevel(player.skin ?? "male/grey", lv));
      safeKey   = this.textures.exists(key) ? key : "male_5lvl_grey";
    }

    console.log(`[Scene] addRemotePlayer: ${player.nickname} (${sessionId}) at ${player.x},${player.y}. Skin: ${safeKey}. isDead: ${player.isDead}. isGM: ${isGM}`);

    if (!this.textures.exists(safeKey)) {
      console.error(`[Scene] Texture ${safeKey} missing for player ${player.nickname}!`);
    }

    const sprite = this.physics.add.sprite(player.x, player.y, safeKey);
    sprite.setDepth(player.y + FRAME_SIZE / 2);
    
    const walkAnim = `${safeKey}_walk_down`;
    if (this.anims.exists(walkAnim)) {
      sprite.play(walkAnim);
      sprite.stop();
      sprite.setFrame(DIR_TO_ROW[0] * 9);
    } else {
      console.warn(`[Scene] Animation ${walkAnim} missing for ${player.nickname}`);
    }

    const initWeapon = player.weapon ?? "sword";
    const weaponSprite = this.add.image(player.x, player.y, initWeapon);
    weaponSprite.setVisible(false);
    weaponSprite.setDepth(sprite.depth + 1);

    const graveSprite = this.add.image(player.x, player.y, "grave");
    graveSprite.setDisplaySize(32, 32);
    graveSprite.setDepth(sprite.depth);
    graveSprite.setVisible(false);

    const labelText = isGM ? `${player.nickname ?? ""} [GM]` : `${player.nickname ?? ""} [Lv.${lv}]`;
    const label = this.add
      .text(player.x, player.y - 42, labelText, {
        fontSize: "13px",
        color: isGM ? "#ff8800" : "#ffff44",
        stroke: "#000000",
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(9999);

    // Party name label (below nickname, same color, 1px smaller)
    const partyLabel = this.add
      .text(player.x, player.y - 42, "", {
        fontSize: "12px",
        color: "#ffff44",
        stroke: "#000000",
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(9999)
      .setVisible(false);

    // HP bar (shown only for party members)
    const hpBar = this.add.graphics();

    // Make sprite clickable for party invite, with hover highlight
    sprite.setInteractive();
    sprite.on("pointerover", () => {
      const target = this.room.state.players.get(sessionId);
      const myState = this.room.state.players.get(this.mySessionId);
      if (!target || !myState) return;

      // GMs cannot invite or be invited
      if (target.isGM || myState.isGM) return;

      // Only highlight if we can invite: target must be solo, and we must be solo or the owner
      const canInvite = (target.partyId === "") &&
                        (myState.partyId === "" || myState.isPartyOwner);

      if (canInvite) sprite.setTint(0xaaddff);
    });
    sprite.on("pointerout",  () => sprite.clearTint());
    sprite.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      sprite.clearTint();
      this.ignoreNextMapClick = true;
      this.showPlayerActionMenu(sessionId, pointer.x, pointer.y);
    });

    // Apply disconnected appearance immediately if player is already a ghost
    if (player.disconnected) {
      sprite.setAlpha(0.45);
      weaponSprite.setAlpha(0.45);
      label.setAlpha(0.45);
    }

    const entity: RemotePlayerEntity = {
      sprite,
      weaponSprite,
      label,
      partyLabel,
      graveSprite,
      hpBar,
      targetX: player.x,
      targetY: player.y,
      direction: player.direction ?? 0,
      showWeapon: player.showWeapon || false,
      skinKey: safeKey,
      level: lv,
      isAttacking: player.isAttacking || false,
      attackDirection: player.attackDirection ?? 0,
      attackOrbitTimer: 0,
      weapon: player.weapon ?? "sword",
      isDead: player.isDead || false,
      partyId: player.partyId ?? "",
      lastHpRatio: -1,
    };

    // Apply initial visibility
    const isDead = !!player.isDead;
    sprite.setVisible(!isDead);
    label.setVisible(!isDead);
    graveSprite.setVisible(isDead);
    if (isDead) graveSprite.setPosition(player.x, player.y);

    this.remoteMap.set(sessionId, entity);

    player.onChange(() => {
      const e = this.remoteMap.get(sessionId);
      if (!e) return;

      const wasDeadBefore = e.isDead;
      const isDeadNow     = player.isDead || false;

      const wasAttacking = e.isAttacking;

      e.targetX         = player.x;
      e.targetY         = player.y;
      e.direction       = player.direction ?? 0;
      e.showWeapon      = player.showWeapon || false;
      e.isAttacking     = player.isAttacking || false;
      e.attackDirection = player.attackDirection ?? 0;
      e.isDead          = isDeadNow;

      // Grey out disconnected (ghost) players; restore on reconnect
      const ghostAlpha = player.disconnected ? 0.45 : 1;
      e.sprite.setAlpha(ghostAlpha);
      e.weaponSprite.setAlpha(ghostAlpha);
      e.label.setAlpha(ghostAlpha);

      // Start orbit timer when attack begins
      if (!wasAttacking && e.isAttacking) {
        e.attackOrbitTimer = ATTACK_ANIM_MS;
      }

      // Swap sprite if weapon changed
      const newWeapon = player.weapon ?? "sword";
      if (newWeapon !== e.weapon) {
        e.weapon = newWeapon;
        e.weaponSprite.setTexture(newWeapon);
      }

      if (!wasDeadBefore && isDeadNow) {
        // Just died: freeze sprite at death position, show grave
        e.sprite.setVisible(false);
        e.weaponSprite.setVisible(false);
        e.graveSprite?.setPosition(e.sprite.x, e.sprite.y).setVisible(true);
      } else if (wasDeadBefore && !isDeadNow) {
        // Respawned: snap to new server position, restore sprite, hide grave
        e.sprite.setPosition(player.x, player.y);
        e.sprite.setVisible(true);
        e.graveSprite?.setVisible(false);
      }

      const newLv = player.level ?? 1;
      if (e.level !== newLv) {
        e.level = newLv;
        if (player.isGM) {
          e.label.setText(`${player.nickname} [GM]`);
        } else {
          e.label.setText(`${player.nickname} [Lv.${newLv}]`);
          // Swap spritesheet when crossing a tier boundary (5, 10, 15, …)
          if (isTierBoundary(newLv)) {
            const newKey = skinKey(getSkinForLevel(player.skin, newLv));
            if (this.textures.exists(newKey) && e.skinKey !== newKey) {
              e.sprite.setTexture(newKey, DIR_TO_ROW[e.direction] * 9);
              e.skinKey = newKey;
            }
          }
        }
      }

      // Update party membership and label color
      const newPartyId = player.partyId ?? "";
      if (newPartyId !== e.partyId) {
        e.partyId = newPartyId;
        const inParty = newPartyId !== "" && newPartyId === this.myPartyId;
        e.label.setColor(inParty ? "#77aaff" : "#ffff44");
      }
    });
  }

  private removeRemotePlayer(sessionId: string): void {
    const entity = this.remoteMap.get(sessionId);
    if (!entity) return;
    entity.sprite.destroy();
    entity.weaponSprite.destroy();
    entity.label.destroy();
    entity.partyLabel?.destroy();
    if (entity.chatBubble) entity.chatBubble.destroy();
    entity.graveSprite?.destroy();
    entity.hpBar?.destroy();
    this.remoteMap.delete(sessionId);
  }

  // ── Party UI ───────────────────────────────────────────────────────────────

  private showPlayerActionMenu(sessionId: string, screenX: number, screenY: number): void {
    this.hidePlayerActionMenu();
    this.playerActionMenuTargetId = sessionId;

    const target = this.room.state.players.get(sessionId);
    if (!target) return;

    // GMs cannot invite or be invited
    const myState = this.room.state.players.get(this.mySessionId);
    if (target.isGM || myState?.isGM) return;

    // Only show if we can invite: target must be solo, and we must be solo or the owner
    const canInvite = (target.partyId === "") &&
                      (this.myPartyId === "" || this.myIsPartyOwner);
    if (!canInvite) return;

    const menuW = 164;
    const menuH = 40;
    const camW  = this.cameras.main.width;
    const camH  = this.cameras.main.height;
    const mx    = Math.min(screenX + 4, camW - menuW - 8);
    const my    = Math.min(screenY + 4, camH - menuH - 8);

    const bg = this.add.graphics()
      .fillStyle(0x111111, 0.92)
      .fillRoundedRect(mx, my, menuW, menuH, 6)
      .setScrollFactor(0)
      .setDepth(200000);

    const btn = this.add.text(mx + menuW / 2, my + menuH / 2, "Ask to party", {
      fontSize: "13px",
      color: "#ffffff",
      resolution: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(200001)
    .setInteractive({ useHandCursor: true });

    btn.on("pointerover", () => btn.setColor("#77aaff"));
    btn.on("pointerout",  () => btn.setColor("#ffffff"));
    btn.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      this.room.send("party_invite", { targetId: sessionId });
      this.hidePlayerActionMenu();
    });

    this.playerActionMenu = { bg, btn };
  }

  private hidePlayerActionMenu(): void {
    this.playerActionMenu?.bg.destroy();
    this.playerActionMenu?.btn.destroy();
    this.playerActionMenu = undefined;
    this.playerActionMenuTargetId = undefined;
  }

  private showPartyInvitePopup(fromId: string, fromNickname: string): void {
    this.hidePartyInvitePopup();
    this.partyInviteFromId = fromId;

    const w    = this.cameras.main.width;
    const h    = this.cameras.main.height;
    const popW = 290;
    const popH = 96;
    const px   = (w - popW) / 2;
    const py   = h / 2 - 120;

    const bg = this.add.graphics()
      .fillStyle(0x111111, 0.95)
      .fillRoundedRect(px, py, popW, popH, 8)
      .setScrollFactor(0)
      .setDepth(300000);

    const titleText = this.add.text(px + popW / 2, py + 14,
      `${fromNickname} invited you to a party`, {
        fontSize: "13px",
        color: "#ffffff",
        resolution: 2,
        wordWrap: { width: popW - 24 },
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(300001);

    const acceptBtn = this.add.text(px + 70, py + 68, "Accept", {
      fontSize: "13px",
      color: "#44ff44",
      backgroundColor: "#004400",
      padding: { x: 14, y: 6 },
      resolution: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(300001)
    .setInteractive({ useHandCursor: true });

    const refuseBtn = this.add.text(px + popW - 70, py + 68, "Refuse", {
      fontSize: "13px",
      color: "#ff4444",
      backgroundColor: "#440000",
      padding: { x: 14, y: 6 },
      resolution: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(300001)
    .setInteractive({ useHandCursor: true });

    acceptBtn.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      this.room.send("party_response", { fromId, accept: true });
      this.hidePartyInvitePopup();
    });
    refuseBtn.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      this.room.send("party_response", { fromId, accept: false });
      this.hidePartyInvitePopup();
    });

    this.partyInvitePopup = { bg, titleText, acceptBtn, refuseBtn };
  }

  private hidePartyInvitePopup(): void {
    if (this.partyInvitePopup) {
      this.partyInvitePopup.bg.destroy();
      this.partyInvitePopup.titleText.destroy();
      this.partyInvitePopup.acceptBtn.destroy();
      this.partyInvitePopup.refuseBtn.destroy();
      this.partyInvitePopup = undefined;
    }
    this.partyInviteFromId = undefined;
  }

  // ── Enemy management ───────────────────────────────────────────────────────

  private addEnemy(enemy: EnemyData, id: string): void {
    const defs   = this.cache.json.get("enemies_registry") as
      Record<string, { label: string; level: number; frameWidth: number; frameHeight: number }> | undefined;
    const regDef = defs?.[enemy.type];
    const texKey = `enemy_${enemy.type}`;

    const sprite = this.textures.exists(texKey)
      ? this.add.sprite(enemy.x, enemy.y, texKey)
      : this.add.sprite(enemy.x, enemy.y, "grave");  // fallback if texture missing

    const fw = regDef?.frameWidth  ?? 32;
    const fh = regDef?.frameHeight ?? 32;
    sprite.setDisplaySize(fw, fh);
    sprite.setDepth(enemy.y + 24);

    const idleKey = `${enemy.type}_idle`;
    if (this.anims.exists(idleKey)) sprite.play(idleKey);

    const hpBar = this.add.graphics();
    hpBar.setDepth(sprite.depth + 1);

    const displayName  = regDef?.label ?? enemy.type;
    const displayLevel = regDef?.level ?? 1;
    const label = this.add.text(enemy.x, enemy.y - 44, `${displayName} [Lv.${displayLevel}]`, {
      fontSize: "12px",
      color: "#ff4444",
      stroke: "#000000",
      strokeThickness: 3,
      resolution: 2,
    })
    .setOrigin(0.5, 1)
    .setDepth(sprite.depth + 2);

    const entity: EnemyEntity = {
      sprite,
      hpBar,
      label,
      targetX: enemy.x,
      targetY: enemy.y,
      direction: enemy.direction,
      isAttacking: enemy.isAttacking,
      attackDirection: enemy.attackDirection,
      isDead: enemy.isDead,
      type: enemy.type,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      lastHpRatio: -1,
      lastAnimKey: "",
    };

    this.enemyMap.set(id, entity);

    enemy.onChange(() => {
      const e = this.enemyMap.get(id);
      if (!e) return;
      e.targetX       = enemy.x;
      e.targetY       = enemy.y;
      e.direction     = enemy.direction;
      e.isAttacking   = enemy.isAttacking;
      e.attackDirection = enemy.attackDirection;
      e.hp            = enemy.hp;
      e.maxHp         = enemy.maxHp;
      e.isDead        = enemy.isDead;

      // Start fade when enemy dies (server removes it 500 ms later)
      if (enemy.isDead && sprite.active) {
        this.tweens.add({
          targets: sprite,
          alpha: 0,
          duration: 400,
          onComplete: () => { /* sprite destroyed in removeEnemy */ },
        });
        hpBar.clear();
      }
    });
  }

  private removeEnemy(id: string): void {
    const entity = this.enemyMap.get(id);
    if (!entity) return;
    entity.sprite.destroy();
    entity.hpBar.destroy();
    entity.label.destroy();
    this.enemyMap.delete(id);
  }

  // ── Per-frame updates ──────────────────────────────────────────────────────

  private updateEnemies(): void {
    this.enemyMap.forEach((entity) => {
      if (entity.isDead || !entity.sprite || !entity.sprite.active) return;

      const { sprite, hpBar } = entity;

      // Lerp toward authoritative position
      const prevX = sprite.x;
      const prevY = sprite.y;
      sprite.x = Phaser.Math.Linear(sprite.x, entity.targetX, LERP_FACTOR);
      sprite.y = Phaser.Math.Linear(sprite.y, entity.targetY, LERP_FACTOR);

      const depth = sprite.y + 24;
      sprite.setDepth(depth);
      hpBar.setDepth(depth + 1);
      entity.label.setPosition(sprite.x, sprite.y - 36).setDepth(depth + 2);

      // ── HP bar — only redraw when sprite moved or HP ratio changed ──────────
      const hpRatio = (entity.hp > 0 && entity.maxHp > 0)
        ? Math.max(0, Math.min(1, entity.hp / entity.maxHp))
        : 0;
      const moved = Math.abs(sprite.x - prevX) > 0.01 || Math.abs(sprite.y - prevY) > 0.01;
      if (moved || hpRatio !== entity.lastHpRatio) {
        entity.lastHpRatio = hpRatio;
        hpBar.clear();
        if (hpRatio > 0) {
          hpBar.fillStyle(0x000000, 0.6);
          hpBar.fillRect(sprite.x - 16, sprite.y - 32, 32, 4);
          hpBar.fillStyle(0xff3333, 1);
          hpBar.fillRect(sprite.x - 16, sprite.y - 32, Math.floor(32 * hpRatio), 4);
        }
      }

      // ── Animation — only call play() when the target animation changes ──────
      const dir     = entity.isAttacking ? entity.attackDirection : entity.direction;
      const moving2 = Math.abs(entity.targetX - sprite.x) > 1 || Math.abs(entity.targetY - sprite.y) > 1;
      const type    = entity.type;

      let targetAnimKey = "";
      let flipX         = false;
      if (entity.isAttacking) {
        if (dir === 3) {
          flipX = true;
          targetAnimKey = `${type}_attack_side`;
        } else {
          targetAnimKey = `${type}_${DIR_ATTACK_STATE[dir] ?? "attack_down"}`;
        }
      } else if (moving2) {
        if (entity.direction === 3) {
          flipX = true;
          targetAnimKey = `${type}_walk_side`;
        } else {
          targetAnimKey = `${type}_${DIR_WALK_STATE[entity.direction] ?? "walk_down"}`;
        }
      } else {
        targetAnimKey = `${type}_idle`;
      }

      if (targetAnimKey !== entity.lastAnimKey) {
        entity.lastAnimKey = targetAnimKey;
        sprite.setFlipX(flipX);
        if (this.anims.exists(targetAnimKey)) sprite.play(targetAnimKey, true);
      }
    });
  }

  // ── Local movement & weapon animation ────────────────────────────────────────

  private handleLocalMovement(delta: number): void {
    // Block all movement while dead
    if (this.localIsDead) {
      this.localSprite.setVelocity(0, 0);
      return;
    }

    const left  = this.cursors.left!.isDown  || this.keyA.isDown;
    const right = this.cursors.right!.isDown || this.keyD.isDown;
    const up    = this.cursors.up!.isDown    || this.keyW.isDown;
    const down  = this.cursors.down!.isDown  || this.keyS.isDown;
    const anyKey = left || right || up || down;

    if (anyKey) this.pathWaypoints = [];

    let vx = 0, vy = 0;
    let moving = false;
    let dir = this.localDirection;

    if (anyKey) {
      if (left)  { vx = -PLAYER_SPEED; dir = 1; moving = true; }
      if (right) { vx =  PLAYER_SPEED; dir = 3; moving = true; }
      if (up)    { vy = -PLAYER_SPEED; if (!left && !right) dir = 2; moving = true; }
      if (down)  { vy =  PLAYER_SPEED; if (!left && !right) dir = 0; moving = true; }

      if (vx !== 0 && vy !== 0) {
        const norm = Math.SQRT2;
        vx /= norm;
        vy /= norm;
      }
    } else if (this.pathWaypoints.length > 0) {
      // Stuck detection: if the sprite hasn't moved for 400 ms, abandon the path
      const movedX = Math.abs(this.localSprite.x - this.pathPrevX);
      const movedY = Math.abs(this.localSprite.y - this.pathPrevY);
      this.pathPrevX = this.localSprite.x;
      this.pathPrevY = this.localSprite.y;
      if (movedX < 1 && movedY < 1) {
        this.pathStuckTimer += delta;
        if (this.pathStuckTimer >= 400) {
          this.pathWaypoints = [];
          this.pathStuckTimer = 0;
        }
      } else {
        this.pathStuckTimer = 0;
      }

      if (this.pathWaypoints.length > 0) {
        let wp   = this.pathWaypoints[this.pathIndex];
        let dx   = wp.x - this.localSprite.x;
        let dy   = wp.y - this.localSprite.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        while (dist < WAYPOINT_THRESHOLD && this.pathWaypoints.length > 0) {
          this.pathIndex++;
          if (this.pathIndex >= this.pathWaypoints.length) {
            this.pathWaypoints = [];
            break;
          }
          wp   = this.pathWaypoints[this.pathIndex];
          dx   = wp.x - this.localSprite.x;
          dy   = wp.y - this.localSprite.y;
          dist = Math.sqrt(dx * dx + dy * dy);
        }

        if (this.pathWaypoints.length > 0) {
          vx = (dx / dist) * PLAYER_SPEED;
          vy = (dy / dist) * PLAYER_SPEED;
          moving = true;
          if (Math.abs(dx) >= Math.abs(dy)) {
            dir = dx > 0 ? 3 : 1;
          } else {
            dir = dy > 0 ? 0 : 2;
          }
        }
      }
    }

    this.localSprite.setVelocity(vx, vy);
    this.localDirection = dir;

    // ── Player sprite animation ────────────────────────────────────────────
    const key     = this.localSkin === "gm" ? "gm" : skinKey(getSkinForLevel(this.localSkin, this.localLevel));
    const animKey = `${key}_${DIR_NAMES[dir]}`;
    if (moving) {
      this.localSprite.play(animKey, true);
    } else {
      if (this.localSprite.anims.isPlaying) {
        this.localSprite.stop();
        this.localSprite.setFrame(DIR_TO_ROW[dir] * 9);
      }
    }

    const playerDepth = this.localSprite.y + FRAME_SIZE / 2;
    this.localSprite.setDepth(playerDepth);

    // Position nickname + optional party label
    const myState = this.room.state.players.get(this.mySessionId);
    const localPartyName = myState?.partyName ?? "";
    if (localPartyName && this.localPartyLabel) {
      this.localLabel.setPosition(this.localSprite.x, this.localSprite.y - 54);
      this.localPartyLabel
        .setText(`(${localPartyName})`)
        .setPosition(this.localSprite.x, this.localSprite.y - 42)
        .setVisible(true);
    } else {
      this.localLabel.setPosition(this.localSprite.x, this.localSprite.y - 42);
      this.localPartyLabel?.setVisible(false);
    }

    if (this.localChatBubble) {
      this.localChatBubble.setPosition(this.localSprite.x, this.localSprite.y - 65);
    }

    // ── Weapon texture sync (reads live server state every frame) ──────────
    const serverWeapon = (myState?.weapon ?? "sword") as string;
    if (serverWeapon !== this.localWeaponKey) {
      this.localWeaponKey = serverWeapon;
      this.localWeapon.setTexture(serverWeapon);
    }

    // ── Weapon animation (sword orbits clockwise) ────────────────────────────
    // Tick cooldown
    if (this.localAttackCooldownTimer > 0) {
      this.localAttackCooldownTimer -= delta;
    }

    // Tick attack animation timer
    if (this.localIsAttacking) {
      this.localAttackTimer -= delta;
      if (this.localAttackTimer <= 0) {
        this.localIsAttacking = false;
      }
    }

    if (this.localIsAttacking) {
      // progress 0→1 over the animation duration
      const progress = 1 - this.localAttackTimer / ATTACK_ANIM_MS;
      // start at top (−π/2), sweep clockwise (increasing angle)
      const angle = -Math.PI / 2 + progress * 2 * Math.PI;
      const localOrbitR = this.localWeapon.height / 2 + 10;
      const wx = this.localSprite.x + localOrbitR * Math.cos(angle);
      const wy = this.localSprite.y + localOrbitR * Math.sin(angle);
      this.localWeapon.setPosition(wx, wy);
      this.localWeapon.setRotation(angle + Math.PI / 2);
      this.localWeapon.setDepth(playerDepth + 1);
      this.localWeapon.setVisible(true);
    } else {
      this.localWeapon.setVisible(false);
    }
  }

  // ── Remote player interpolation ─────────────────────────────────────────────

  private interpolateRemotePlayers(delta: number): void {
    this.remoteMap.forEach((entity, sessionId) => {
      // Safety check: skip if sprite is gone or scene is cleaning up
      if (!entity.sprite || !entity.sprite.active) return;

      // Dead players: freeze at death position, keep label above grave
      if (entity.isDead) {
        entity.label.setPosition(entity.sprite.x, entity.sprite.y - 42);
        entity.partyLabel?.setVisible(false);
        if (entity.chatBubble) entity.chatBubble.setPosition(entity.sprite.x, entity.sprite.y - 65);
        // Clear the HP bar exactly once when the player dies (lastHpRatio -1 = already cleared)
        if (entity.hpBar && entity.lastHpRatio !== -1) {
          entity.hpBar.clear();
          entity.lastHpRatio = -1;
        }
        return;
      }

      const { sprite, weaponSprite, label, chatBubble,
              targetX, targetY, direction, skinKey: key } = entity;

      const prevX = sprite.x;
      const prevY = sprite.y;

      sprite.x = Phaser.Math.Linear(sprite.x, targetX, LERP_FACTOR);
      sprite.y = Phaser.Math.Linear(sprite.y, targetY, LERP_FACTOR);

      // Position nickname and optional party name label
      const rState = this.room.state.players.get(sessionId);
      const remotePartyName = rState?.partyName ?? "";
      if (remotePartyName && entity.partyLabel) {
        label.setPosition(sprite.x, sprite.y - 54);
        entity.partyLabel
          .setText(`(${remotePartyName})`)
          .setPosition(sprite.x, sprite.y - 42)
          .setVisible(true);
      } else {
        label.setPosition(sprite.x, sprite.y - 42);
        entity.partyLabel?.setVisible(false);
      }
      if (chatBubble) chatBubble.setPosition(sprite.x, sprite.y - 65);

      const playerDepth = sprite.y + FRAME_SIZE / 2;
      sprite.setDepth(playerDepth);

      // ── World HP bar ──────────────────────────────────────────────────────
      if (entity.hpBar) {
        // Use live state — never rely on cached partyId
        const rp = this.room.state.players.get(sessionId);
        const hpRatio = (rp && rp.maxHp > 0) ? Math.max(0, Math.min(1, rp.hp / rp.maxHp)) : 0;
        const moved   = Math.abs(sprite.x - prevX) > 0.01 || Math.abs(sprite.y - prevY) > 0.01;
        // Only redraw when the sprite moved (bar follows sprite) or HP changed
        if (moved || hpRatio !== entity.lastHpRatio) {
          entity.lastHpRatio = hpRatio;
          entity.hpBar.clear();
          if (rp && rp.maxHp > 0) {
            const bw = 40;
            const bx = sprite.x - bw / 2;
            const by = sprite.y - 38;
            entity.hpBar.fillStyle(0x000000, 0.6).fillRect(bx, by, bw, 4);
            entity.hpBar.fillStyle(0xff3333, 1).fillRect(bx, by, Math.floor(bw * hpRatio), 4);
            entity.hpBar.setDepth(playerDepth + 1);
          }
        }
      }

      const dx = Math.abs(sprite.x - prevX);
      const dy = Math.abs(sprite.y - prevY);
      const moving = dx > 0.5 || dy > 0.5;

      // ── Remote weapon (sword orbit) ─────────────────────────────────────────
      // Tick orbit timer
      if (entity.attackOrbitTimer > 0) {
        entity.attackOrbitTimer = Math.max(0, entity.attackOrbitTimer - delta);
      }

      if (entity.attackOrbitTimer > 0) {
        const progress = 1 - entity.attackOrbitTimer / ATTACK_ANIM_MS;
        const angle    = -Math.PI / 2 + progress * 2 * Math.PI;
        const remoteOrbitR = weaponSprite.height / 2 + 10;
        const wx = sprite.x + remoteOrbitR * Math.cos(angle);
        const wy = sprite.y + remoteOrbitR * Math.sin(angle);
        weaponSprite.setPosition(wx, wy);
        weaponSprite.setRotation(angle + Math.PI / 2);
        weaponSprite.setDepth(playerDepth + 1);
        weaponSprite.setVisible(true);
      } else {
        weaponSprite.setVisible(false);
      }

      // ── Remote player sprite animation ───────────────────────────────────
      const safeKey = this.textures.exists(key) ? key : "male_5lvl_grey";
      const animKey = `${safeKey}_${DIR_NAMES[direction]}`;

      if (moving) {
        sprite.play(animKey, true);
      } else {
        if (sprite.anims.isPlaying) {
          sprite.stop();
          sprite.setFrame(DIR_TO_ROW[direction] * 9);
        }
      }
    });
  }

  // ── Position send ──────────────────────────────────────────────────────────

  private sendPositionIfNeeded(time: number): void {
    if (this.isTeleporting) return;
    if (time - this.lastSendTime < SEND_RATE_MS) return;
    this.lastSendTime = time;
    this.room.send("move", {
      x: this.localSprite.x,
      y: this.localSprite.y,
      direction: this.localDirection,
      timestamp: time,
    });
  }

  // ── Tile placement ──────────────────────────────────────────────────────────

  private placeTiles(tiles: TilePlacement[]): void {
    for (const tile of tiles) {
      if (!this.textures.exists(tile.type)) continue;
      const img = this.add.image(tile.x, tile.y, tile.type).setOrigin(0, 0).setDepth(0.5);
      this.mapVisualsGroup.add(img);
    }
  }

  // ── Static object placement ─────────────────────────────────────────────────

  private placeStaticObjects(objects: StaticObjectData[]): void {
    for (const obj of objects) {
      const def = this.objectsRegistry[obj.type];
      if (!def) continue;

      const animated = (def.frameCount ?? 1) > 1;

      if (animated) {
        if (def.collision) {
          // Animated with collision — physics sprite
          const sprite = this.animatedObjectsGroup.create(obj.x, obj.y, obj.type, 0) as Phaser.Physics.Arcade.Sprite;
          sprite.setOrigin(0, 0);
          sprite.setDisplaySize(def.imageWidth, def.imageHeight);
          const body = sprite.body as Phaser.Physics.Arcade.StaticBody;
          body.setSize(def.collision.x1 - def.collision.x0, def.collision.y1 - def.collision.y0);
          body.setOffset(def.collision.x0, def.collision.y0);
          sprite.setDepth(obj.y + def.imageHeight);
          sprite.play(`anim_${obj.type}`);
        } else {
          // Animated, no collision — visual-only sprite
          const sprite = this.add.sprite(obj.x, obj.y, obj.type, 0);
          sprite.setOrigin(0, 0);
          sprite.setDisplaySize(def.imageWidth, def.imageHeight);
          sprite.setDepth(obj.y + def.imageHeight);
          sprite.play(`anim_${obj.type}`);
          this.mapVisualsGroup.add(sprite);
        }
      } else {
        if (def.collision) {
          // Static with collision — physics image
          const img = this.staticObjectsGroup.create(obj.x, obj.y, obj.type) as Phaser.Physics.Arcade.Image;
          img.setOrigin(0, 0);
          img.setDisplaySize(def.imageWidth, def.imageHeight);
          const body = img.body as Phaser.Physics.Arcade.StaticBody;
          body.setSize(def.collision.x1 - def.collision.x0, def.collision.y1 - def.collision.y0);
          body.setOffset(def.collision.x0, def.collision.y0);
          img.setDepth(obj.y + def.imageHeight);
        } else {
          // Static, no collision — visual-only image
          const img = this.add.image(obj.x, obj.y, obj.type);
          img.setOrigin(0, 0);
          img.setDisplaySize(def.imageWidth, def.imageHeight);
          img.setDepth(obj.y + def.imageHeight);
          this.mapVisualsGroup.add(img);
        }
      }
    }
    this.staticObjectsGroup.refresh();
    this.animatedObjectsGroup.refresh();
  }

  // ── Doors ───────────────────────────────────────────────────────────────────

  private placeDoors(doors: DoorData[]): void {
    this.doors = doors;
    for (const door of doors) {
      if (!this.textures.exists("door_to_map")) continue;

      const img = this.add.image(door.x, door.y, "door_to_map")
        .setOrigin(0, 0)
        .setDepth(door.y + this.textures.get("door_to_map").getSourceImage().height);

      img.setInteractive({ useHandCursor: true });
      img.on("pointerover", () => img.setTint(0xddffdd));
      img.on("pointerout",  () => img.clearTint());
      img.on("pointerdown", () => {
        this.ignoreNextMapClick = true;
        this.showDoorDialog(door);
      });

      this.doorSprites.set(door.id, img);
      this.mapVisualsGroup.add(img);
    }
  }

  private showDoorDialog(door: DoorData): void {
    if (this.isTeleporting) return;

    // Remove any existing dialog
    document.getElementById("door-dialog")?.remove();

    const dlg = document.createElement("div");
    dlg.id = "door-dialog";
    dlg.style.cssText = [
      "position:fixed", "top:50%", "left:50%",
      "transform:translate(-50%,-50%)",
      "background:#1a1a2e", "border:2px solid #44aa88",
      "border-radius:8px", "padding:24px 32px",
      "color:#eee", "font-family:sans-serif",
      "text-align:center", "z-index:9999",
      "box-shadow:0 4px 24px rgba(0,0,0,0.8)",
      "min-width:260px",
    ].join(";");

    dlg.innerHTML = `
      <div style="font-size:18px;font-weight:bold;margin-bottom:12px">
        Travel to <span style="color:#44ffaa">${door.targetMap}</span>?
      </div>
      <div style="font-size:13px;color:#aaa;margin-bottom:20px">
        You will be teleported to another map.
      </div>
      <button id="door-yes" style="
        background:#2a7a4a;color:#fff;border:none;border-radius:4px;
        padding:8px 24px;font-size:14px;cursor:pointer;margin-right:8px">
        Travel
      </button>
      <button id="door-no" style="
        background:#4a2a2a;color:#fff;border:none;border-radius:4px;
        padding:8px 24px;font-size:14px;cursor:pointer">
        Cancel
      </button>
    `;

    document.body.appendChild(dlg);

    document.getElementById("door-no")?.addEventListener("click", () => dlg.remove());
    document.getElementById("door-yes")?.addEventListener("click", () => {
      dlg.remove();
      this.room.send("use_door", { doorId: door.id });
    });
  }

  private async travelToMap(targetMap: string, spawnX?: number, spawnY?: number): Promise<void> {
    console.log(`[DIAG] travelToMap() called — target=${targetMap} spawnX=${spawnX} spawnY=${spawnY} isTeleporting=${this.isTeleporting}`);
    if (this.isTeleporting) return;
    this.isTeleporting = true;

    // Hide the waiting-room HTML overlay so it doesn't bleed through the loading screen
    const wrOverlay = document.getElementById("waiting-room-overlay");
    if (wrOverlay) wrOverlay.style.display = "none";

    // Show loading overlay
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.loadingOverlay = this.add.graphics()
      .fillStyle(0x000000, 1)
      .fillRect(0, 0, w, h)
      .setScrollFactor(0)
      .setDepth(2000000);
    this.loadingText = this.add.text(w / 2, h / 2, "Loading Map...", {
      fontSize: "24px",
      color: "#ffffff",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2000001);

    // Disable all input to prevent double-clicks or movement during transition
    if (this.input.keyboard) this.input.keyboard.enabled = false;
    this.input.enabled = false;

    document.getElementById("door-dialog")?.remove();

    try {
      // Leave current room (consented — no reconnect grace period needed)
      localStorage.removeItem("reconnToken");
      await this.room.leave(true);

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const client   = new Client(`${protocol}://${window.location.host}`);
      const joinOptions: Record<string, unknown> = {
        mapName:     targetMap,
        nickname:    this.localNickname,
        skin:        this.localSkin,
        passcode:    this.passcode,
        persistentId: localStorage.getItem("playerId") ?? undefined,
        spawnX,
        spawnY,
      };
      // Re-authenticate as GM so the server restores isGM status
      if (this.localSkin === "gm") {
        joinOptions.login    = "admin";
        joinOptions.password = "admin123";
      }
      const newRoom  = await client.joinOrCreate("game", joinOptions);

      localStorage.setItem("reconnToken", newRoom.reconnectionToken);

      console.log(`[Door] Traveling to ${targetMap}. Exporting leaderboard: ${!!this.globalLeaderboardData}`);

      const data: GameSceneData = {
        room:     newRoom,
        nickname: this.localNickname,
        skin:     this.localSkin,
        passcode: this.passcode,
        mapName:  targetMap,
        leaderboardData: this.globalLeaderboardData || undefined,
        actionBarState: this.actionBarUI.exportState(),
        equipmentState: this.equipmentUI.exportState(),
      };
      
      // Clean up UI before switching
      this.shopUI.close();
      this.healerShopUI.close();
      this.equipmentUI.close();
      
      this.scene.start("GameScene", data);
    } catch (err) {
      console.error("[Door] Travel failed:", err);
      if (this.loadingOverlay) this.loadingOverlay.destroy();
      if (this.loadingText) this.loadingText.destroy();
      if (this.input.keyboard) this.input.keyboard.enabled = true;
      this.input.enabled = true;
      this.isTeleporting = false;
    }
  }

  // ── Chat display ────────────────────────────────────────────────────────────

  private displayChatMessage(data: { sessionId: string; nickname: string; message: string }): void {
    if (!this.isCreated || !this.localSprite) {
      this.pendingChatMessages.push(data);
      return;
    }

    const msgEl = document.createElement("div");
    msgEl.className = "chat-msg";
    if (data.sessionId === "server") {
      msgEl.innerHTML = `<span style="color:#aaaaaa">${data.message}</span>`;
    } else if (data.sessionId === this.mySessionId) {
      msgEl.innerHTML = `<span class="name" style="color:#44ff44">${data.nickname}:</span> ${data.message}`;
    } else {
      // Check if sender is in our party → blue, otherwise yellow
      const senderState = this.room.state.players.get(data.sessionId);
      const inParty = senderState && senderState.partyId !== "" && senderState.partyId === this.myPartyId;
      const nameColor = inParty ? "#77aaff" : "#ffff44";
      msgEl.innerHTML = `<span class="name" style="color:${nameColor}">${data.nickname}:</span> ${data.message}`;
    }
    
    if (this.chatDisplay) {
      this.chatDisplay.appendChild(msgEl);
    } else {
      console.warn("[Chat] chatDisplay is missing, cannot append message.");
    }

    setTimeout(() => {
      msgEl.style.animation = "fadeOut 0.5s forwards";
      setTimeout(() => msgEl.remove(), 500);
    }, 5000);

    let targetSprite: Phaser.Physics.Arcade.Sprite;
    let isLocal = false;

    if (data.sessionId === this.mySessionId) {
      targetSprite = this.localSprite;
      isLocal = true;
      if (this.localChatBubble) this.localChatBubble.destroy();
    } else {
      const entity = this.remoteMap.get(data.sessionId);
      if (!entity) return;
      targetSprite = entity.sprite;
      if (entity.chatBubble) entity.chatBubble.destroy();
    }

    const bubble = this.add.text(targetSprite.x, targetSprite.y - 65, data.message, {
      fontSize: "14px",
      color: "#ffffff",
      backgroundColor: "rgba(0,0,0,0.7)",
      padding: { x: 8, y: 4 },
      align: "center",
      wordWrap: { width: 200 },
      resolution: 2,
    })
    .setOrigin(0.5, 1)
    .setDepth(10000);

    if (isLocal) {
      this.localChatBubble = bubble;
    } else {
      const entity = this.remoteMap.get(data.sessionId);
      if (entity) entity.chatBubble = bubble;
    }

    this.tweens.add({
      targets: bubble,
      alpha: 0,
      delay: 9500,
      duration: 500,
      onComplete: () => {
        bubble.destroy();
        if (isLocal) {
          if (this.localChatBubble === bubble) this.localChatBubble = undefined;
        } else {
          const entity = this.remoteMap.get(data.sessionId);
          if (entity && entity.chatBubble === bubble) entity.chatBubble = undefined;
        }
      },
    });
  }

  // ── Pathfinding ────────────────────────────────────────────────────────────

  private buildNavGrid(objects: StaticObjectData[]): void {
    this.navCols = Math.ceil(this.room.state.mapWidth  / NAV_CELL);
    this.navRows = Math.ceil(this.room.state.mapHeight / NAV_CELL);
    this.navGrid = new Uint8Array(this.navCols * this.navRows);

    for (const obj of objects) {
      const def = this.objectsRegistry[obj.type];
      if (!def || !def.collision) continue;  // skip objects with no collision box

      // Convert image-local collision coords to world coords
      const imgLeft = obj.x - def.imageWidth  / 2;
      const imgTop  = obj.y - def.imageHeight / 2;
      const bx0 = imgLeft + def.collision.x0;
      const bx1 = imgLeft + def.collision.x1;
      const by0 = imgTop  + def.collision.y0;
      const by1 = imgTop  + def.collision.y1;

      const c0 = Math.max(0, Math.floor(bx0 / NAV_CELL));
      const c1 = Math.min(this.navCols - 1, Math.floor(bx1 / NAV_CELL));
      const r0 = Math.max(0, Math.floor(by0 / NAV_CELL));
      const r1 = Math.min(this.navRows - 1, Math.floor(by1 / NAV_CELL));

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          this.navGrid[r * this.navCols + c] = 1;
        }
      }
    }
  }

  private findPath(
    fromX: number, fromY: number,
    toX: number, toY: number,
  ): { x: number; y: number }[] | null {
    return findPathLogic(this.navGrid, this.navCols, this.navRows, NAV_CELL, fromX, fromY, toX, toY);
  }

  private onMapClick(worldX: number, worldY: number): void {
    if (this.navGrid.length === 0) return;

    const path = this.findPath(
      this.localSprite.x, this.localSprite.y,
      worldX, worldY,
    );

    this.pathStuckTimer = 0;
    this.pathPrevX = this.localSprite.x;
    this.pathPrevY = this.localSprite.y;

    if (path && path.length > 0) {
      this.showMarker(worldX, worldY, true);
      this.pathWaypoints = path;
      this.pathIndex = 0;
    } else {
      this.showMarker(worldX, worldY, false);
      this.pathWaypoints = [];
    }
  }

  private showMarker(x: number, y: number, green: boolean): void {
    const img = this.add.image(x, y, green ? "x_green" : "x_red").setDepth(99998);
    this.tweens.add({
      targets: img,
      alpha: 0,
      delay: 1000,
      duration: 500,
      onComplete: () => img.destroy(),
    });
  }

  // ── Coin animation ─────────────────────────────────────────────────────────

  /**
   * Spawn a looping coin-spin animation at world position (x, y).
   * Loops indefinitely until removeCoinAnimation() is called with the same id.
   * Frames 0–3 = first half-spin; frames 3–0 with flipX = mirrored second half.
   */
  private spawnCoinAnimation(id: string, x: number, y: number): void {
    const sprite = this.add.sprite(x, y - 20, "coins");
    sprite.setDepth(y + 10);
    sprite.setFrame(0);

    let frameIdx = 0; // 0–7 within one full spin

    const timer = this.time.addEvent({
      delay: 80,
      loop: true,
      callback: () => {
        const secondHalf = frameIdx >= 4;
        sprite.setFrame(secondHalf ? 3 - (frameIdx - 4) : frameIdx);
        sprite.setFlipX(secondHalf);
        frameIdx = (frameIdx + 1) % 8;
      },
    });

    this.coinAnimations.set(id, { sprite, timer });
  }

  /** Stop and fade out a coin animation when collected or expired. */
  private removeCoinAnimation(id: string): void {
    const anim = this.coinAnimations.get(id);
    if (!anim) return;
    this.coinAnimations.delete(id);
    anim.timer.remove();
    this.tweens.add({
      targets: anim.sprite,
      alpha: 0,
      y: anim.sprite.y - 14,
      duration: 300,
      onComplete: () => anim.sprite.destroy(),
    });
  }

  // ── Weapon HUD ─────────────────────────────────────────────────────────────

  private createWeaponHUD(): void {
    const D = 99994;
    const R = 32;

    this.weaponHudBg      = this.add.graphics().setScrollFactor(0).setDepth(D);
    this.weaponHudIcon    = this.add.image(0, 0, "sword")
      .setScrollFactor(0).setDepth(D + 1);
    { // initial scale
      const MAX_H = 64;
      const natW  = this.weaponHudIcon.width;
      const natH  = this.weaponHudIcon.height;
      if (natH > MAX_H) {
        this.weaponHudIcon.setDisplaySize(Math.round(natW * MAX_H / natH), MAX_H);
      }
    }
    this.weaponHudOverlay = this.add.graphics().setScrollFactor(0).setDepth(D + 2);
    this.weaponHudBorder  = this.add.graphics().setScrollFactor(0).setDepth(D + 3);

    const { width, height } = this.scale;
    const cx = width  - R - 12;
    const cy = height - R - 12;

    this.weaponHudHitArea = this.add.rectangle(cx, cy, R * 2, R * 2, 0x000000, 0)
      .setScrollFactor(0).setDepth(D + 4)
      .setInteractive({ useHandCursor: true });

    this.weaponHudHitArea.on("pointerover", () => {
      if (this.localAttackCooldownTimer <= 0 && !this.localIsAttacking) {
        this.weaponHudIcon.setTint(0xaaffaa);
      }
    });
    this.weaponHudHitArea.on("pointerout",  () => this.weaponHudIcon.clearTint());
    this.weaponHudHitArea.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      this.triggerAttack();
    });
  }

  private updateWeaponHUD(): void {
    const R  = 32;
    const { width, height } = this.scale;
    const cx = width  - R - 12;
    const cy = height - R - 12;

    // Keep hit area aligned (handles window resize)
    this.weaponHudHitArea.setPosition(cx, cy);

    // Sync icon texture to current weapon
    if (this.weaponHudIcon.texture.key !== this.localWeaponKey) {
      this.weaponHudIcon.setTexture(this.localWeaponKey);
      // Scale down to max 64 px tall, preserving aspect ratio
      const MAX_H = 64;
      const natW  = this.weaponHudIcon.width;
      const natH  = this.weaponHudIcon.height;
      if (natH > MAX_H) {
        this.weaponHudIcon.setDisplaySize(Math.round(natW * MAX_H / natH), MAX_H);
      } else {
        this.weaponHudIcon.setDisplaySize(natW, natH);
      }
    }
    this.weaponHudIcon.setPosition(cx, cy);

    const progress = Math.min(1, Math.max(0, this.localAttackCooldownTimer) / ATTACK_COOLDOWN_MS);
    const ready    = progress === 0 && !this.localIsAttacking;

    // Background circle
    this.weaponHudBg.clear()
      .fillStyle(0x111111, 0.85)
      .fillCircle(cx, cy, R);

    // Icon alpha: full when ready, dimmed on cooldown
    this.weaponHudIcon.setAlpha(ready ? 1 : 0.4);

    // Radial cooldown overlay — the dark wedge shrinks clockwise as cooldown expires
    this.weaponHudOverlay.clear();
    if (progress > 0.01) {
      // The "cleared" (elapsed) arc grows clockwise from 12 o'clock.
      // The dark wedge is the remaining portion: from the current hand to 12 o'clock.
      const clearedAngle = Math.PI * 2 * (1 - progress);
      const darkStart    = -Math.PI / 2 + clearedAngle; // leading edge of dark region
      const darkEnd      = Math.PI * 3 / 2;             // 12 o'clock (end of full cycle)
      this.weaponHudOverlay
        .fillStyle(0x000000, 0.72)
        .slice(cx, cy, R - 1, darkStart, darkEnd, false)
        .fillPath();
    }

    // Border — gold when ready, grey on cooldown
    const borderColor = ready ? 0xbbaa44 : 0x555544;
    this.weaponHudBorder.clear()
      .lineStyle(2, borderColor, 1)
      .strokeCircle(cx, cy, R);
  }

  // ── NPCs & Shop ────────────────────────────────────────────────────────────

  /** Scale a freshly-created NPC sprite down so it is at most 64 px tall. */
  private fitNpcSprite(sprite: Phaser.GameObjects.Image): void {
    const MAX_H = 48;
    if (sprite.height > MAX_H) {
      sprite.setDisplaySize(Math.round(sprite.width * MAX_H / sprite.height), MAX_H);
    }
  }

  private placeNpcs(npcs: NpcData[]): void {
    this.npcPositions = npcs.map(n => ({ type: n.type, x: n.x, y: n.y }));
    for (const npc of npcs) {
      if (npc.type === "trader") {
        this.createTrader(npc.x, npc.y);
      } else if (npc.type === "healer") {
        this.createHealer(npc.x, npc.y);
      }
    }
  }

  private createTrader(traderX: number, traderY: number): void {
    const depth  = traderY + 40;

    const sprite = this.add.image(traderX, traderY, "trader")
      .setOrigin(0, 0)
      .setDepth(depth)
      .setInteractive({ useHandCursor: true });
    this.fitNpcSprite(sprite);
    const labelX = traderX + sprite.displayWidth / 2;

    const nameLabel = this.add.text(labelX, traderY - 40, "Trader", {
      fontSize: "13px", color: "#ffd700",
      stroke: "#000000", strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(depth + 1);

    const tradeLabel = this.add.text(labelX, traderY - 54, "[click to trade]", {
      fontSize: "10px", color: "#aaaaaa",
      stroke: "#000000", strokeThickness: 2, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(depth + 1);

    this.mapVisualsGroup.add(sprite);
    this.mapVisualsGroup.add(nameLabel);
    this.mapVisualsGroup.add(tradeLabel);

    sprite.on("pointerover", () => sprite.setTint(0xdddddd));
    sprite.on("pointerout",  () => sprite.clearTint());
    sprite.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      this.healerShopUI.close();
      this.equipmentUI.close();
      this.shopUI.toggle();
    });
  }

  private createHealer(healerX: number, healerY: number): void {
    const depth  = healerY + 40;

    const sprite = this.add.image(healerX, healerY, "healer")
      .setOrigin(0, 0)
      .setDepth(depth)
      .setInteractive({ useHandCursor: true });
    this.fitNpcSprite(sprite);
    const labelX = healerX + sprite.displayWidth / 2;

    const nameLabel = this.add.text(labelX, healerY - 40, "Healer", {
      fontSize: "13px", color: "#88ffcc",
      stroke: "#000000", strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(depth + 1);

    const tradeLabel = this.add.text(labelX, healerY - 54, "[click to trade]", {
      fontSize: "10px", color: "#aaaaaa",
      stroke: "#000000", strokeThickness: 2, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(depth + 1);

    this.mapVisualsGroup.add(sprite);
    this.mapVisualsGroup.add(nameLabel);
    this.mapVisualsGroup.add(tradeLabel);

    sprite.on("pointerover", () => sprite.setTint(0xddffee));
    sprite.on("pointerout",  () => sprite.clearTint());
    sprite.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      this.shopUI.close();
      this.equipmentUI.close();
      this.healerShopUI.toggle();
    });
  }

  // ── Disconnect / reconnect ─────────────────────────────────────────────────

  private showDisconnectBanner(): void {
    if (this.isSessionEnded) return; // session_ended handler already showing its own overlay
    // Transition back to HomeScene — it will auto-reconnect using the saved token
    this.scene.start("HomeScene");
  }

  private showSessionEndedBanner(): void {
    // Use isTeleporting to suppress the generic disconnect banner when the socket closes
    this.isTeleporting = true;
    const el = document.getElementById("session-ended-overlay");
    if (el) el.style.display = "flex";
  }
}
