import Phaser from "phaser";
import {
  GameSceneData, MapDataMessage, RemotePlayer, RemotePlayerEntity,
  StaticObjectData, EnemyData, EnemyEntity, NpcData,
} from "./types";
import { STATIC_OBJECT_REGISTRY } from "../shared/staticObjects";
import { ShopUI } from "./ui/ShopUI";
import { ALL_SKINS, FRAME_W as FRAME_SIZE } from "./skins";
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

const MAP_W = 2000;
const MAP_H = 2000;
const PLAYER_SPEED        = 200;   // px/s — client prediction speed
const SEND_RATE_MS        = 50;    // send position @ 20 Hz
const LERP_FACTOR         = 0.18;  // interpolation factor for remote players / enemies
const RECONCILE_THRESHOLD = 120;   // px — snap if server disagrees by more than this
const ANIM_FPS            = 10;
const ATTACK_ANIM_MS      = 1000;  // axe orbit animation duration (ms)
const ATTACK_COOLDOWN_MS  = 2000;  // ms between attacks
const AXE_ORBIT_RADIUS    = 15;    // px from player sprite centre

// All selectable skins — preloaded so any player's chosen skin renders correctly
const SKINS_TO_LOAD = ALL_SKINS;

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

// Hit-enemy direction name lookup (0=down,1=left,2=up; 3=right uses flip)
const HIT_DIR_NAMES = ["down", "left", "up"] as const;

// Display info for each enemy type (name + level shown above head)
const ENEMY_DISPLAY: Record<string, { name: string; level: number }> = {
  hit: { name: "Hit", level: 3 },
};

// Converts "male/1lvl" → "male_1lvl"
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
  private localWeaponKey = "axe";
  private localLevel = 1;

  // Local attack state
  private localIsAttacking = false;
  private localAttackDir   = 0;
  private localAttackTimer = 0;
  private localAttackCooldownTimer = 0;

  // Local death state
  private localGrave?: Phaser.GameObjects.Image;
  private diedOverlay?: Phaser.GameObjects.Graphics;
  private diedText?: Phaser.GameObjects.Text;
  private countdownText?: Phaser.GameObjects.Text;
  private localIsDead    = false;
  private localDeathTimer = 0;

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

  // Trees
  private staticObjectsGroup!: Phaser.Physics.Arcade.StaticGroup;

  // HUD
  private hudHpBar!: Phaser.GameObjects.Graphics;
  private hudXpBar!: Phaser.GameObjects.Graphics;
  private hudHpText!: Phaser.GameObjects.Text;
  private hudXpText!: Phaser.GameObjects.Text;
  private hudGoldText!: Phaser.GameObjects.Text;

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

  // Coin animations — keyed by server coin ID
  private coinAnimations = new Map<string, { sprite: Phaser.GameObjects.Sprite; timer: Phaser.Time.TimerEvent }>();

  // Trader shop
  private shopUI!: ShopUI;
  private npcPositions: Array<{ type: string; x: number; y: number }> = [];

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
    this.room          = data.room;
    this.localNickname = data.nickname;
    this.localSkin     = data.skin;
    this.mySessionId   = data.room.sessionId as string;
  }

  preload(): void {
    // Player sprite sheets
    for (const skin of SKINS_TO_LOAD) {
      this.load.spritesheet(skinKey(skin), `/assets/player/${skin}.png`, {
        frameWidth: FRAME_SIZE, frameHeight: FRAME_SIZE,
      });
    }

    // Background tile
    this.load.image("grass", "/assets/maps/grass.png");
    this.load.image("minimap_icon", "/assets/maps/minimap_icon.png");

    // Click-to-move markers
    this.load.image("x_green", "/assets/shortestPath/xGreen.png");
    this.load.image("x_red",   "/assets/shortestPath/xRed.png");

    // Static object images (trees + buildings)
    this.load.image("tree1", "/assets/trees/tree1.png");
    this.load.image("tree2", "/assets/trees/tree2.png");
    this.load.image("tree3", "/assets/trees/tree3.png");
    this.load.image("house_cottage_big",   "/assets/entities/house_cottage_big.png");
    this.load.image("house_cottage_small", "/assets/entities/house_cottage_small.png");

    // Weapon attacking sprites (rotated procedurally during orbit animation)
    this.load.image("axe_attacking",       "/assets/weapons/axe_attacking.png");
    this.load.image("great_axe_attacking", "/assets/weapons/great_axe_attacking.png");
    this.load.image("solid_axe_attacking", "/assets/weapons/solid_axe_attacking.png");

    // Weapon display sprites (shown in trader shop)
    this.load.image("great_axe", "/assets/weapons/great_axe.png");
    this.load.image("solid_axe", "/assets/weapons/solid_axe.png");

    // Trader NPC
    this.load.image("trader", "/assets/npcs/trader.png");

    // Hit enemy sprite sheet (32×32 frames, 2 cols × 7 rows)
    this.load.spritesheet("hit_enemy", "/assets/enemies/hit.png", {
      frameWidth: 32, frameHeight: 32,
    });

    // Grave shown at player's death location
    this.load.image("grave", "/assets/deathState/grave.png");

    // Coin spin spritesheet (20×20 px per frame, 4 frames stacked vertically)
    this.load.spritesheet("coins", "/assets/utils/coins.png", {
      frameWidth: 20, frameHeight: 20,
    });
  }

  create(): void {
    // ── Background ─────────────────────────────────────────────────────────
    this.add.tileSprite(0, 0, MAP_W, MAP_H, "grass").setOrigin(0, 0).setDepth(0);

    // ── Physics world bounds ────────────────────────────────────────────────
    this.physics.world.setBounds(0, 0, MAP_W, MAP_H);

    // ── Trees static group ──────────────────────────────────────────────────
    this.staticObjectsGroup = this.physics.add.staticGroup();

    // ── Animations ─────────────────────────────────────────────────────────
    this.createAnimations();

    // ── Local player ────────────────────────────────────────────────────────
    this.createLocalPlayer(MAP_W / 2, MAP_H / 2);

    // ── HUD ─────────────────────────────────────────────────────────────────
    this.createHUD();
    this.createPartyHUD();
    this.createMinimap();

    // ── Death UI (hidden by default) ─────────────────────────────────────────
    this.createDeathUI();

    // ── Camera ──────────────────────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);
    this.cameras.main.startFollow(this.localSprite, true, 0.08, 0.08);

    // NPCs are placed after map_data is received (see setupRoomListeners)

    // ── Shop UI ──────────────────────────────────────────────────────────────
    this.shopUI = new ShopUI(
      this,
      () => {
        const ps = this.room.state.players.get(this.mySessionId);
        return ps ? { gold: ps.gold as number, weapon: ps.weapon as string } : null;
      },
      (weaponKey) => { this.room.send("buy_weapon", { weapon: weaponKey }); },
      () => { this.ignoreNextMapClick = true; },
    );

    // ── Weapon HUD ───────────────────────────────────────────────────────────
    this.createWeaponHUD();

    // ── Input ────────────────────────────────────────────────────────────────
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

    // ── Chat UI ──────────────────────────────────────────────────────────────
    this.setupChatUI();

    // ── I / Space key → attack ────────────────────────────────────────────────
    this.keyI.on("down", () => {
      if (this.isTyping) return;
      this.triggerAttack();
    });

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
      // Sprite click handlers set this flag first; scene fires after
      if (this.ignoreNextMapClick) {
        this.ignoreNextMapClick = false;
        return;
      }
      this.hidePlayerActionMenu();
      this.onMapClick(pointer.worldX, pointer.worldY);
    });

    // ── Colyseus listeners ───────────────────────────────────────────────────
    this.setupRoomListeners();
  }

  // ── Attack ─────────────────────────────────────────────────────────────────

  private triggerAttack(): void {
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
    this.chatInputWrap = document.getElementById("chat-input-wrap")!;
    this.chatInput     = document.getElementById("chat-input") as HTMLInputElement;
    this.chatDisplay   = document.getElementById("chat-display")!;

    this.keyEnter.on("down", () => {
      if (!this.isTyping) {
        this.startTyping();
      } else {
        this.stopTyping(true);
      }
    });

    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.isTyping) this.stopTyping(false);
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
    // Always read party state from live server state — never rely on cached value alone
    const myState = this.room.state.players.get(this.mySessionId);
    this.myPartyId      = myState?.partyId      ?? "";
    this.myIsPartyOwner = myState?.isPartyOwner ?? false;

    this.handleLocalMovement(delta);
    this.interpolateRemotePlayers(delta);
    this.updateEnemies();
    this.updateHUD();
    this.updatePartyHUD();
    this.updateLeaderboard();
    
    if (this.minimapOpen) {
      this.updateMinimap();
    }

    this.tickDeathTimer(delta);
    this.updateWeaponHUD();
    this.sendPositionIfNeeded(time);
  }

  // ── HUD ────────────────────────────────────────────────────────────────────

  private createHUD(): void {
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

    // HP bar
    const hpRatio = Math.max(0, Math.min(1, p.hp / p.maxHp));
    this.hudHpBar.clear();
    this.hudHpBar.fillStyle(0xff3333, 1);
    this.hudHpBar.fillRect(12, 14, Math.floor(maxBarW * hpRatio), 13);
    this.hudHpText.setText(`HP: ${Math.floor(p.hp)}/${p.maxHp}`);

    // XP bar
    const xpNeeded = xpForNextLevel(p.level);
    const xpRatio  = Math.max(0, Math.min(1, p.xp / xpNeeded));
    this.hudXpBar.clear();
    this.hudXpBar.fillStyle(0x3399ff, 1);
    this.hudXpBar.fillRect(12, 32, Math.floor(maxBarW * xpRatio), 13);
    this.hudXpText.setText(`XP: ${Math.floor(p.xp)}/${xpNeeded}  Lv.${p.level}`);

    // Gold display
    this.hudGoldText.setText(`Gold: ${p.gold ?? 0}`);

    // Update nickname label when level changes
    if (p.level !== this.localLevel) {
      this.localLevel = p.level;
      this.localLabel.setText(`${this.localNickname} [Lv.${p.level}]`);
    }
  }

  // ── Party HUD ──────────────────────────────────────────────────────────────

  private createPartyHUD(): void {
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
        const targetId = kickBtn.getData("targetId") as string;
        if (targetId) this.room.send("party_kick", { targetId });
      });

      this.partyHudRows.push({ bg, hpBar, xpBar, nameText, kickBtn });
    }
  }

  private updatePartyHUD(): void {
    const ROW_H    = 32;
    const ROW_GAP  = 4;
    const HEADER_H = 18;
    const START_Y  = 66 + HEADER_H + 2;
    const PANEL_W  = 204;
    const BAR_W   = 192;

    // Collect other party members in stable order (with sessionId for kick)
    const members: Array<{ sessionId: string; nickname: string; level: number; hp: number; maxHp: number }> = [];
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
      this.remoteMap.forEach((_entity, sessionId) => {
        const state = this.room.state.players.get(sessionId);
        if (state && state.partyId === this.myPartyId) {
          members.push({
            sessionId,
            nickname: state.nickname,
            level:    state.level,
            hp:       state.hp,
            maxHp:    state.maxHp,
          });
        }
      });
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

        row.hpBar.fillStyle(0xff3333, 1)
          .fillRect(12, y + 20, Math.floor(BAR_W * hpRatio), 8);

        row.nameText
          .setText(`${m.nickname} [Lv.${m.level}]`)
          .setPosition(14, y + 4)
          .setVisible(true);

        row.kickBtn
          .setData("targetId", m.sessionId)
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
      .fillRect(mmX, mmY, MINIMAP_SIZE, MINIMAP_SIZE)
      .lineStyle(1, 0x334433, 1)
      .strokeRect(mmX, mmY, MINIMAP_SIZE, MINIMAP_SIZE)
      .setScrollFactor(0)
      .setDepth(D)
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

  private updateMinimap(): void {
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
    const camW = this.cameras.main.width;
    const lbX = camW - 208;
    const lbY = this.minimapOpen ? 216 : 64;

    this.leaderboardBg.setPosition(lbX, lbY);
    this.leaderboardHeader.setPosition(lbX + MINIMAP_SIZE / 2, lbY + 8);

    const allPlayers: Array<{ nickname: string; level: number; xp: number; partyName: string }> = [];
    this.room.state.players.forEach((p: RemotePlayer) => {
      allPlayers.push({
        nickname: p.nickname,
        level: p.level,
        xp: p.xp,
        partyName: p.partyName,
      });
    });

    const top5 = sortLeaderboard(allPlayers).slice(0, 5);

    let currentY = lbY + 32;

    for (let i = 0; i < 5; i++) {
      const row = this.leaderboardRows[i];
      if (i < top5.length) {
        row.setPosition(lbX + 8, currentY);
        const p = top5[i];
        const partyTag = p.partyName ? ` [${p.partyName}]` : "";
        const rawContent = `${p.nickname}${partyTag} Lv.${p.level}`;
        
        let text = `${i + 1}. ${rawContent}`;
        
        // If content > 20 signs, move the rest to a new line
        if (rawContent.length > 20) {
          text = `${i + 1}. ${rawContent.slice(0, 20)}\n   ${rawContent.slice(20)}`;
        }

        row.setText(text);
        row.setVisible(true);

        // Advance Y for the next row based on the actual height of this text object
        currentY += row.height + 4; 
      } else {
        row.setVisible(false);
      }
    }

    // Dynamic background height
    const totalHeight = Math.max(120, (currentY - lbY) + 4);
    this.leaderboardBg.clear();
    this.leaderboardBg.fillStyle(0x111111, 0.85);
    this.leaderboardBg.fillRect(0, 0, MINIMAP_SIZE, totalHeight);
    this.leaderboardBg.lineStyle(1, 0x334433, 1);
    this.leaderboardBg.strokeRect(0, 0, MINIMAP_SIZE, totalHeight);
  }

  // ── Death UI ───────────────────────────────────────────────────────────────

  private createDeathUI(): void {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    this.diedOverlay = this.add.graphics()
      .fillStyle(0x000000, 0.7)
      .fillRect(0, 0, w, h)
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
  }

  // ── Setup helpers ──────────────────────────────────────────────────────────

  private createLocalPlayer(x: number, y: number): void {
    const key = skinKey(this.localSkin);
    this.localSprite = this.physics.add.sprite(x, y, key);
    this.localSprite.setCollideWorldBounds(true);
    this.localSprite.setDepth(y + FRAME_SIZE / 2);

    this.localWeapon = this.add.image(x, y, "axe_attacking");
    this.localWeapon.setDepth(this.localSprite.depth + 1);
    this.localWeapon.setVisible(false);

    const body = this.localSprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT);
    body.setOffset(PLAYER_BODY_X, PLAYER_BODY_Y);
    this.localSprite.play(`${key}_walk_down`);
    this.localSprite.stop();
    this.localSprite.setFrame(DIR_TO_ROW[0] * 9);

    this.localLabel = this.add
      .text(x, y - 42, `${this.localNickname} [Lv.1]`, {
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

    // ── Hit enemy animations (2 frames per row, 7 rows) ───────────────────────
    // Row layout: 0=stand, 1=walk_up, 2=walk_left, 3=walk_down,
    //             4=attack_up, 5=attack_left, 6=attack_down
    // Right variants use left + flipX at runtime
    if (this.textures.exists("hit_enemy")) {
      const hitWalkDefs: [string, number[]][] = [
        ["hit_idle",        [0,  1 ]],
        ["hit_walk_up",     [2,  3 ]],
        ["hit_walk_left",   [4,  5 ]],
        ["hit_walk_down",   [6,  7 ]],
        ["hit_attack_up",   [8,  9 ]],
        ["hit_attack_left", [10, 11]],
        ["hit_attack_down", [12, 13]],
      ];
      for (const [aKey, frames] of hitWalkDefs) {
        if (!this.anims.exists(aKey)) {
          this.anims.create({
            key: aKey,
            frames: this.anims.generateFrameNumbers("hit_enemy", { frames }),
            frameRate: 6,
            repeat: -1,
          });
        }
      }
    }
  }

  private setupRoomListeners(): void {
    this.room.onMessage("map_data", (data: MapDataMessage) => {
      this.placeStaticObjects(data.objects);
      this.buildNavGrid(data.objects);
      this.physics.add.collider(this.localSprite, this.staticObjectsGroup);
      this.placeNpcs(data.npcs ?? []);
    });
    this.room.send("get_map");

    // Player added
    this.room.state.players.onAdd((player: RemotePlayer, sessionId: string) => {
      if (sessionId === this.mySessionId) {
        this.localSprite.setPosition(player.x, player.y);
        return;
      }
      this.addRemotePlayer(player, sessionId);
    });

    // Player left
    this.room.state.players.onRemove((_player: RemotePlayer, sessionId: string) => {
      this.removeRemotePlayer(sessionId);
    });

    // Enemy added
    this.room.state.enemies.onAdd((enemy: EnemyData, id: string) => {
      this.addEnemy(enemy, id);
    });

    // Enemy removed
    this.room.state.enemies.onRemove((_enemy: EnemyData, id: string) => {
      this.removeEnemy(id);
    });

    // Connection dropped
    this.room.onLeave(() => { this.showDisconnectBanner(); });

    // Chat messages
    this.room.onMessage("chat", (data: { sessionId: string; nickname: string; message: string }) => {
      this.displayChatMessage(data);
    });

    // Coin drop animation
    this.room.onMessage("coin_drop", (data: { id: string; x: number; y: number }) => {
      this.spawnCoinAnimation(data.id, data.x, data.y);
    });

    // Coin collected or expired — stop the animation
    this.room.onMessage("coin_collected", (data: { id: string }) => {
      this.removeCoinAnimation(data.id);
    });

    // Party invite received
    this.room.onMessage("party_invite", (data: { fromId: string; fromNickname: string }) => {
      this.showPartyInvitePopup(data.fromId, data.fromNickname);
    });

    // Track local player's own state changes
    this.room.state.players.onChange((player: RemotePlayer, sessionId: string) => {
      if (sessionId !== this.mySessionId) return;

      // Position reconciliation
      const dx = Math.abs(player.x - this.localSprite.x);
      const dy = Math.abs(player.y - this.localSprite.y);
      if (dx > RECONCILE_THRESHOLD || dy > RECONCILE_THRESHOLD) {
        this.localSprite.setPosition(player.x, player.y);
      }

      // Weapon change — swap attacking sprite
      const newWeapon = player.weapon ?? "axe";
      if (newWeapon !== this.localWeaponKey) {
        this.localWeaponKey = newWeapon;
        this.localWeapon.setTexture(`${newWeapon}_attacking`);
      }

      // Party state change — update label colors of all remote players
      const newPartyId = player.partyId ?? "";
      if (newPartyId !== this.myPartyId) {
        this.myPartyId      = newPartyId;
        this.myIsPartyOwner = player.isPartyOwner ?? false;
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

  // ── Remote player management ───────────────────────────────────────────────

  private addRemotePlayer(player: RemotePlayer, sessionId: string): void {
    const key     = skinKey(player.skin ?? "male/1lvl");
    const safeKey = this.textures.exists(key) ? key : "male_1lvl";
    const lv      = player.level ?? 1;

    const sprite = this.physics.add.sprite(player.x, player.y, safeKey);
    sprite.setDepth(player.y + FRAME_SIZE / 2);
    sprite.play(`${safeKey}_walk_down`);
    sprite.stop();
    sprite.setFrame(DIR_TO_ROW[0] * 9);

    const initWeapon = player.weapon ?? "axe";
    const weaponSprite = this.add.image(player.x, player.y, `${initWeapon}_attacking`);
    weaponSprite.setVisible(false);
    weaponSprite.setDepth(sprite.depth + 1);

    const graveSprite = this.add.image(player.x, player.y, "grave");
    graveSprite.setDisplaySize(32, 32);
    graveSprite.setDepth(sprite.depth);
    graveSprite.setVisible(false);

    const label = this.add
      .text(player.x, player.y - 42, `${player.nickname ?? ""} [Lv.${lv}]`, {
        fontSize: "13px",
        color: "#ffff44",
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
      weapon: player.weapon ?? "axe",
      isDead: player.isDead || false,
      partyId: player.partyId ?? "",
    };

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

      // Start orbit timer when attack begins
      if (!wasAttacking && e.isAttacking) {
        e.attackOrbitTimer = ATTACK_ANIM_MS;
      }

      // Swap attacking sprite if weapon changed
      const newWeapon = player.weapon ?? "axe";
      if (newWeapon !== e.weapon) {
        e.weapon = newWeapon;
        e.weaponSprite.setTexture(`${newWeapon}_attacking`);
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
        e.label.setText(`${player.nickname} [Lv.${newLv}]`);
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
    const sprite = this.add.sprite(enemy.x, enemy.y, "hit_enemy");
    sprite.setDisplaySize(48, 48); // upscale 32×32 → 48×48
    sprite.setDepth(enemy.y + 24);
    sprite.play("hit_idle");

    const hpBar = this.add.graphics();
    hpBar.setDepth(sprite.depth + 1);

    const info  = ENEMY_DISPLAY[enemy.type] ?? { name: enemy.type, level: 1 };
    const label = this.add.text(enemy.x, enemy.y - 44, `${info.name} [Lv.${info.level}]`, {
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
      if (entity.isDead) return;

      const { sprite, hpBar } = entity;
      const prevX = sprite.x;
      const prevY = sprite.y;

      // Lerp toward authoritative position
      sprite.x = Phaser.Math.Linear(sprite.x, entity.targetX, LERP_FACTOR);
      sprite.y = Phaser.Math.Linear(sprite.y, entity.targetY, LERP_FACTOR);

      const depth = sprite.y + 24;
      sprite.setDepth(depth);
      hpBar.setDepth(depth + 1);
      entity.label.setPosition(sprite.x, sprite.y - 36).setDepth(depth + 2);

      // ── HP bar ─────────────────────────────────────────────────────────────
      hpBar.clear();
      if (entity.hp > 0 && entity.maxHp > 0) {
        const ratio = Math.max(0, Math.min(1, entity.hp / entity.maxHp));
        hpBar.fillStyle(0x000000, 0.6);
        hpBar.fillRect(sprite.x - 16, sprite.y - 32, 32, 4);
        hpBar.fillStyle(0xff3333, 1);
        hpBar.fillRect(sprite.x - 16, sprite.y - 32, Math.floor(32 * ratio), 4);
      }

      // ── Animation ──────────────────────────────────────────────────────────
      const dir    = entity.isAttacking ? entity.attackDirection : entity.direction;
      const moving = Math.abs(entity.targetX - sprite.x) > 1 || Math.abs(entity.targetY - sprite.y) > 1;

      if (entity.isAttacking) {
        if (dir === 3) {
          // right attack = left attack frames + flipX
          sprite.setFlipX(true);
          sprite.play("hit_attack_left", true);
        } else {
          sprite.setFlipX(false);
          const aKey = dir < 3 ? `hit_attack_${HIT_DIR_NAMES[dir]}` : "hit_attack_down";
          sprite.play(aKey, true);
        }
      } else if (moving) {
        if (entity.direction === 3) {
          // right walk = left walk frames + flipX
          sprite.setFlipX(true);
          sprite.play("hit_walk_left", true);
        } else {
          sprite.setFlipX(false);
          const wKey = entity.direction < 3
            ? `hit_walk_${HIT_DIR_NAMES[entity.direction]}`
            : "hit_walk_down";
          sprite.play(wKey, true);
        }
      } else {
        // No target / out of range — always return to waiting (row 0) animation
        sprite.setFlipX(false);
        sprite.play("hit_idle", true);
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

    this.localSprite.setVelocity(vx, vy);
    this.localDirection = dir;

    // ── Player sprite animation ────────────────────────────────────────────
    const key     = skinKey(this.localSkin);
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
    const serverWeapon = (myState?.weapon ?? "axe") as string;
    if (serverWeapon !== this.localWeaponKey) {
      this.localWeaponKey = serverWeapon;
      this.localWeapon.setTexture(`${serverWeapon}_attacking`);
    }

    // ── Weapon animation (axe orbits clockwise) ────────────────────────────
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
      const wx = this.localSprite.x + AXE_ORBIT_RADIUS * Math.cos(angle);
      const wy = this.localSprite.y + AXE_ORBIT_RADIUS * Math.sin(angle);
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
      // Dead players: freeze at death position, keep label above grave
      if (entity.isDead) {
        entity.label.setPosition(entity.sprite.x, entity.sprite.y - 42);
        entity.partyLabel?.setVisible(false);
        if (entity.chatBubble) entity.chatBubble.setPosition(entity.sprite.x, entity.sprite.y - 65);
        entity.hpBar?.clear();
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

      // ── Party member world HP bar ─────────────────────────────────────────
      if (entity.hpBar) {
        entity.hpBar.clear();
        // Use live state — never rely on cached partyId
        const rp = this.room.state.players.get(sessionId);
        if (rp && this.myPartyId !== "" && rp.partyId === this.myPartyId && rp.maxHp > 0) {
          const hpRatio = Math.max(0, Math.min(1, rp.hp / rp.maxHp));
          const bw = 40;
          const bx = sprite.x - bw / 2;
          const by = sprite.y - 38;
          entity.hpBar.fillStyle(0x000000, 0.6).fillRect(bx, by, bw, 4);
          entity.hpBar.fillStyle(0xff3333, 1).fillRect(bx, by, Math.floor(bw * hpRatio), 4);
          entity.hpBar.setDepth(playerDepth + 1);
        }
      }

      const dx = Math.abs(sprite.x - prevX);
      const dy = Math.abs(sprite.y - prevY);
      const moving = dx > 0.5 || dy > 0.5;

      // ── Remote weapon (axe orbit) ─────────────────────────────────────────
      // Tick orbit timer
      if (entity.attackOrbitTimer > 0) {
        entity.attackOrbitTimer = Math.max(0, entity.attackOrbitTimer - delta);
      }

      if (entity.attackOrbitTimer > 0) {
        const progress = 1 - entity.attackOrbitTimer / ATTACK_ANIM_MS;
        const angle    = -Math.PI / 2 + progress * 2 * Math.PI;
        const wx = sprite.x + AXE_ORBIT_RADIUS * Math.cos(angle);
        const wy = sprite.y + AXE_ORBIT_RADIUS * Math.sin(angle);
        weaponSprite.setPosition(wx, wy);
        weaponSprite.setRotation(angle + Math.PI / 2);
        weaponSprite.setDepth(playerDepth + 1);
        weaponSprite.setVisible(true);
      } else {
        weaponSprite.setVisible(false);
      }

      // ── Remote player sprite animation ───────────────────────────────────
      const safeKey = this.textures.exists(key) ? key : "male_1lvl";
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
    if (time - this.lastSendTime < SEND_RATE_MS) return;
    this.lastSendTime = time;
    this.room.send("move", {
      x: this.localSprite.x,
      y: this.localSprite.y,
      direction: this.localDirection,
      timestamp: time,
    });
  }

  // ── Static object placement ─────────────────────────────────────────────────

  private placeStaticObjects(objects: StaticObjectData[]): void {
    for (const obj of objects) {
      const def = STATIC_OBJECT_REGISTRY[obj.type];
      if (!def) continue;

      const img = this.staticObjectsGroup.create(obj.x, obj.y, obj.type) as Phaser.Physics.Arcade.Image;
      img.setDisplaySize(def.imageWidth, def.imageHeight);

      const body = img.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(def.collision.x1 - def.collision.x0, def.collision.y1 - def.collision.y0);
      body.setOffset(def.collision.x0, def.collision.y0);
      img.setDepth(obj.y + def.imageHeight / 2);
    }
    this.staticObjectsGroup.refresh();
  }

  // ── Chat display ────────────────────────────────────────────────────────────

  private displayChatMessage(data: { sessionId: string; nickname: string; message: string }): void {
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
    this.chatDisplay.appendChild(msgEl);

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
    this.navCols = Math.ceil(MAP_W / NAV_CELL);
    this.navRows = Math.ceil(MAP_H / NAV_CELL);
    this.navGrid = new Uint8Array(this.navCols * this.navRows);

    for (const obj of objects) {
      const def = STATIC_OBJECT_REGISTRY[obj.type];
      if (!def) continue;

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
    this.weaponHudIcon    = this.add.image(0, 0, "axe_attacking")
      .setScrollFactor(0).setDepth(D + 1).setDisplaySize(44, 44);
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

    // Sync icon texture to current weapon (always use the attacking sprite)
    const displayKey = `${this.localWeaponKey}_attacking`;
    if (this.weaponHudIcon.texture.key !== displayKey) {
      this.weaponHudIcon.setTexture(displayKey);
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

  // ── Trader NPC & Shop ──────────────────────────────────────────────────────

  private placeNpcs(npcs: NpcData[]): void {
    this.npcPositions = npcs.map(n => ({ type: n.type, x: n.x, y: n.y }));
    for (const npc of npcs) {
      if (npc.type === "trader") {
        this.createTrader(npc.x, npc.y);
      }
    }
  }

  private createTrader(traderX: number, traderY: number): void {
    const depth   = traderY + 40;

    const sprite = this.add.image(traderX, traderY, "trader")
      .setDepth(depth)
      .setInteractive({ useHandCursor: true });

    this.add.text(traderX, traderY - 40, "Trader", {
      fontSize: "13px", color: "#ffd700",
      stroke: "#000000", strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(depth + 1);

    this.add.text(traderX, traderY - 54, "[click to trade]", {
      fontSize: "10px", color: "#aaaaaa",
      stroke: "#000000", strokeThickness: 2, resolution: 2,
    }).setOrigin(0.5, 1).setDepth(depth + 1);

    sprite.on("pointerover", () => sprite.setTint(0xdddddd));
    sprite.on("pointerout",  () => sprite.clearTint());
    sprite.on("pointerdown", () => {
      this.ignoreNextMapClick = true;
      this.shopUI.toggle();
    });
  }

  // ── Disconnect banner ──────────────────────────────────────────────────────

  private showDisconnectBanner(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "Disconnected from server\n(refresh to reconnect)", {
        fontSize: "24px",
        color: "#ff4444",
        stroke: "#000",
        strokeThickness: 4,
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(99999);
  }
}
