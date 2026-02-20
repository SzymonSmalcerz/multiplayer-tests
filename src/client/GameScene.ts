import Phaser from "phaser";
import {
  GameSceneData, MapDataMessage, RemotePlayer, RemotePlayerEntity,
  TreeData, EnemyData, EnemyEntity,
} from "./types";
import { ALL_SKINS, FRAME_W as FRAME_SIZE } from "./skins";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAP_W = 2000;
const MAP_H = 2000;
const PLAYER_SPEED        = 200;   // px/s — client prediction speed
const SEND_RATE_MS        = 50;    // send position @ 20 Hz
const LERP_FACTOR         = 0.18;  // interpolation factor for remote players / enemies
const RECONCILE_THRESHOLD = 120;   // px — snap if server disagrees by more than this
const ANIM_FPS            = 10;
const ATTACK_ANIM_MS      = 350;   // local attack animation duration (ms)

// All selectable skins — preloaded so any player's chosen skin renders correctly
const SKINS_TO_LOAD = ALL_SKINS;

const TREE_KEYS = ["tree1", "tree2", "tree3"];

// Tree sprite dimensions and trunk collision box (pixel coords within the 96×128 sprite)
const TREE_W = 96;
const TREE_H = 128;
const TRUNK_BODY_X      = 36;
const TRUNK_BODY_Y      = 94;
const TRUNK_BODY_WIDTH  = 64 - 36;   // 28 px
const TRUNK_BODY_HEIGHT = 111 - 94;  // 17 px

// Player collision box (pixel coords within the 64×64 sprite frame)
const PLAYER_BODY_X      = 26;
const PLAYER_BODY_Y      = 47;
const PLAYER_BODY_WIDTH  = 39 - 26;  // 13 px
const PLAYER_BODY_HEIGHT = 54 - 47;  //  7 px

// Click-to-move / pathfinding
const NAV_CELL           = 16;  // px per nav-grid cell
const WAYPOINT_THRESHOLD = 8;   // px — advance to next waypoint when within this range

// Maps direction index (0=down,1=left,2=up,3=right) → walk animation suffix
const DIR_NAMES = ["walk_down", "walk_left", "walk_up", "walk_right"] as const;

// Maps direction index → attack animation suffix (for blue_sword)
// dir 0=down, 1=left (uses right+flip), 2=up, 3=right
const ATTACK_DIR_NAMES = ["down", "left", "up", "right"] as const;

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

// XP required to advance from `level` to `level+1` (mirrors server formula)
function xpForNextLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.1, level - 1));
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
  private localWeapon!: Phaser.GameObjects.Sprite;
  private localLevel = 1;

  // Local attack state
  private localIsAttacking = false;
  private localAttackDir   = 0;
  private localAttackTimer = 0;

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
  private treesGroup!: Phaser.Physics.Arcade.StaticGroup;

  // HUD
  private hudHpBar!: Phaser.GameObjects.Graphics;
  private hudXpBar!: Phaser.GameObjects.Graphics;
  private hudHpText!: Phaser.GameObjects.Text;
  private hudXpText!: Phaser.GameObjects.Text;

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

  // Nav grid for click-to-move
  private navGrid = new Uint8Array(0);
  private navCols = 0;
  private navRows = 0;

  // Active path waypoints
  private pathWaypoints: Phaser.Math.Vector2[] = [];
  private pathIndex = 0;

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

    // Click-to-move markers
    this.load.image("x_green", "/assets/shortestPath/xGreen.png");
    this.load.image("x_red",   "/assets/shortestPath/xRed.png");

    // Tree images
    for (const key of TREE_KEYS) {
      this.load.image(key, `/assets/trees/${key}.png`);
    }

    // Weapon sprite sheet (64×64 frames, 9 cols × 5 rows)
    this.load.spritesheet("blue_sword", "/assets/weapons/blue_sword.png", {
      frameWidth: FRAME_SIZE, frameHeight: FRAME_SIZE,
    });

    // Hit enemy sprite sheet (32×32 frames, 2 cols × 7 rows)
    this.load.spritesheet("hit_enemy", "/assets/enemies/hit.png", {
      frameWidth: 32, frameHeight: 32,
    });

    // Grave shown at player's death location
    this.load.image("grave", "/assets/deathState/grave.png");
  }

  create(): void {
    // ── Background ─────────────────────────────────────────────────────────
    this.add.tileSprite(0, 0, MAP_W, MAP_H, "grass").setOrigin(0, 0).setDepth(0);

    // ── Physics world bounds ────────────────────────────────────────────────
    this.physics.world.setBounds(0, 0, MAP_W, MAP_H);

    // ── Trees static group ──────────────────────────────────────────────────
    this.treesGroup = this.physics.add.staticGroup();

    // ── Animations ─────────────────────────────────────────────────────────
    this.createAnimations();

    // ── Local player ────────────────────────────────────────────────────────
    this.createLocalPlayer(MAP_W / 2, MAP_H / 2);

    // ── HUD ─────────────────────────────────────────────────────────────────
    this.createHUD();
    this.createPartyHUD();

    // ── Death UI (hidden by default) ─────────────────────────────────────────
    this.createDeathUI();

    // ── Camera ──────────────────────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);
    this.cameras.main.startFollow(this.localSprite, true, 0.08, 0.08);

    // ── Input ────────────────────────────────────────────────────────────────
    this.cursors  = this.input.keyboard!.createCursorKeys();
    this.keyW     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyI     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.keyU     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.U);
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
    if (this.localIsAttacking) return; // already mid-swing
    if (this.localIsDead) return;

    this.room.send("attack", { direction: this.localDirection });

    // Optimistically start attack animation
    this.localIsAttacking = true;
    this.localAttackDir   = this.localDirection;
    this.localAttackTimer = ATTACK_ANIM_MS;

    // Ensure weapon is visible immediately even if server hasn't confirmed yet
    this.localWeapon.setVisible(true);
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
    this.interpolateRemotePlayers();
    this.updateEnemies();
    this.updateHUD();
    this.updatePartyHUD();
    this.tickDeathTimer(delta);
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

    this.localWeapon = this.add.sprite(x, y, "blue_sword");
    this.localWeapon.setDepth(this.localSprite.depth - 0.1);
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

    // ── Weapon walk animations (rows 0–3, 9 frames each) ─────────────────────
    if (this.textures.exists("blue_sword")) {
      for (let row = 0; row < 4; row++) {
        const start = row * 9;
        const end   = start + 8;
        const aKey  = `blue_sword_${ROW_ANIM_NAMES[row]}`;
        if (!this.anims.exists(aKey)) {
          this.anims.create({
            key: aKey,
            frames: this.anims.generateFrameNumbers("blue_sword", { start, end }),
            frameRate: ANIM_FPS,
            repeat: -1,
          });
        }
      }

      // Row 4 attack animations (3 frames each, plays once)
      // Frame layout in row 4: [36,37,38]=right, [39,40,41]=up, [42,43,44]=down
      // Left attack uses right frames + 180° flip at runtime
      const attackDefs: [string, number[]][] = [
        ["blue_sword_attack_right", [36, 37, 38]],
        ["blue_sword_attack_up",    [39, 40, 41]],
        ["blue_sword_attack_down",  [42, 43, 44]],
      ];
      for (const [aKey, frames] of attackDefs) {
        if (!this.anims.exists(aKey)) {
          this.anims.create({
            key: aKey,
            frames: this.anims.generateFrameNumbers("blue_sword", { frames }),
            frameRate: 10,
            repeat: 0,
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
      this.placeTrees(data.trees);
      this.buildNavGrid(data.trees);
      this.physics.add.collider(this.localSprite, this.treesGroup);
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

    // Party invite received
    this.room.onMessage("party_invite", (data: { fromId: string; fromNickname: string }) => {
      this.showPartyInvitePopup(data.fromId, data.fromNickname);
    });

    // Track local player's own party state (for color syncs etc.)
    this.room.state.players.onChange((player: RemotePlayer, sessionId: string) => {
      if (sessionId !== this.mySessionId) return;
      // Position reconciliation (existing logic)
      const dx = Math.abs(player.x - this.localSprite.x);
      const dy = Math.abs(player.y - this.localSprite.y);
      if (dx > RECONCILE_THRESHOLD || dy > RECONCILE_THRESHOLD) {
        this.localSprite.setPosition(player.x, player.y);
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

    const weaponSprite = this.add.sprite(player.x, player.y, "blue_sword");
    weaponSprite.setVisible(player.showWeapon || false);
    weaponSprite.setDepth(sprite.depth - 0.1);

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
    sprite.on("pointerover", () => sprite.setTint(0xaaddff));
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
      isDead: player.isDead || false,
      partyId: player.partyId ?? "",
    };

    this.remoteMap.set(sessionId, entity);

    player.onChange(() => {
      const e = this.remoteMap.get(sessionId);
      if (!e) return;

      const wasDeadBefore = e.isDead;
      const isDeadNow     = player.isDead || false;

      e.targetX         = player.x;
      e.targetY         = player.y;
      e.direction       = player.direction ?? 0;
      e.showWeapon      = player.showWeapon || false;
      e.isAttacking     = player.isAttacking || false;
      e.attackDirection = player.attackDirection ?? 0;
      e.isDead          = isDeadNow;

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

    // ── Weapon animation ───────────────────────────────────────────────────
    // Tick down attack timer
    if (this.localIsAttacking) {
      this.localAttackTimer -= delta;
      if (this.localAttackTimer <= 0) {
        this.localIsAttacking = false;
        this.localWeapon.setFlipX(false);
        this.localWeapon.setFlipY(false);
      }
    }

    const playerState = this.room.state.players.get(this.mySessionId);
    const showWeapon  = playerState?.showWeapon || this.localIsAttacking;

    this.localWeapon.setVisible(showWeapon);

    if (showWeapon) {
      this.localWeapon.setPosition(this.localSprite.x, this.localSprite.y);

      if (this.localIsAttacking) {
        // Play attack animation
        const atkDir = this.localAttackDir;
        if (atkDir === 1) {
          // left = right frames rotated 180°
          this.localWeapon.setFlipX(true);
          this.localWeapon.setFlipY(true);
          this.localWeapon.play("blue_sword_attack_right", true);
        } else {
          this.localWeapon.setFlipX(false);
          this.localWeapon.setFlipY(false);
          const atkKey = `blue_sword_attack_${ATTACK_DIR_NAMES[atkDir]}`;
          this.localWeapon.play(atkKey, true);
        }
      } else if (moving) {
        this.localWeapon.setFlipX(false);
        this.localWeapon.setFlipY(false);
        this.localWeapon.play(`blue_sword_${DIR_NAMES[dir]}`, true);
      } else {
        this.localWeapon.stop();
        this.localWeapon.setFlipX(false);
        this.localWeapon.setFlipY(false);
        this.localWeapon.setFrame(DIR_TO_ROW[dir] * 9);
      }

      // Depth: render in front when facing down, behind otherwise
      if (dir === 0) {
        this.localWeapon.setDepth(playerDepth + 0.1);
      } else {
        this.localWeapon.setDepth(playerDepth - 0.1);
      }
    }
  }

  // ── Remote player interpolation ─────────────────────────────────────────────

  private interpolateRemotePlayers(): void {
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
              targetX, targetY, direction, showWeapon,
              isAttacking, attackDirection, skinKey: key } = entity;

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

      // ── Remote weapon ────────────────────────────────────────────────────
      const showW = showWeapon || isAttacking;
      weaponSprite.setVisible(showW);

      if (showW) {
        weaponSprite.setPosition(sprite.x, sprite.y);

        if (isAttacking) {
          const atkDir = attackDirection;
          if (atkDir === 1) {
            weaponSprite.setFlipX(true);
            weaponSprite.setFlipY(true);
            weaponSprite.play("blue_sword_attack_right", true);
          } else {
            weaponSprite.setFlipX(false);
            weaponSprite.setFlipY(false);
            weaponSprite.play(`blue_sword_attack_${ATTACK_DIR_NAMES[atkDir]}`, true);
          }
        } else if (moving) {
          weaponSprite.setFlipX(false);
          weaponSprite.setFlipY(false);
          weaponSprite.play(`blue_sword_${DIR_NAMES[direction]}`, true);
        } else {
          weaponSprite.stop();
          weaponSprite.setFlipX(false);
          weaponSprite.setFlipY(false);
          weaponSprite.setFrame(DIR_TO_ROW[direction] * 9);
        }

        if (direction === 0) {
          weaponSprite.setDepth(playerDepth + 0.1);
        } else {
          weaponSprite.setDepth(playerDepth - 0.1);
        }
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

  // ── Tree placement ─────────────────────────────────────────────────────────

  private placeTrees(trees: TreeData[]): void {
    for (const td of trees) {
      const img = this.treesGroup.create(td.x, td.y, td.sprite) as Phaser.Physics.Arcade.Image;
      img.setDisplaySize(TREE_W, TREE_H);

      const body = img.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(TRUNK_BODY_WIDTH, TRUNK_BODY_HEIGHT);
      body.setOffset(TRUNK_BODY_X, TRUNK_BODY_Y);
      img.setDepth(td.y + TREE_H / 2);
    }
    this.treesGroup.refresh();
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

  private buildNavGrid(trees: TreeData[]): void {
    this.navCols = Math.ceil(MAP_W / NAV_CELL);
    this.navRows = Math.ceil(MAP_H / NAV_CELL);
    this.navGrid = new Uint8Array(this.navCols * this.navRows);

    for (const td of trees) {
      const bx0 = td.x - 27;
      const bx1 = td.x + 30;
      const by0 = td.y;
      const by1 = td.y + 40;

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
  ): Phaser.Math.Vector2[] | null {
    if (this.navGrid.length === 0) return null;

    const cols = this.navCols;
    const rows = this.navRows;
    const N    = cols * rows;

    const sc = Math.max(0, Math.min(cols - 1, Math.floor(fromX / NAV_CELL)));
    const sr = Math.max(0, Math.min(rows - 1, Math.floor(fromY / NAV_CELL)));
    const tc = Math.max(0, Math.min(cols - 1, Math.floor(toX   / NAV_CELL)));
    const tr = Math.max(0, Math.min(rows - 1, Math.floor(toY   / NAV_CELL)));

    if (this.navGrid[tr * cols + tc]) return null;

    const start = sr * cols + sc;
    const goal  = tr * cols + tc;

    if (start === goal) return [new Phaser.Math.Vector2(toX, toY)];

    const gScore = new Float32Array(N).fill(Infinity);
    const fScore = new Float32Array(N).fill(Infinity);
    const parent = new Int32Array(N).fill(-1);
    const inOpen = new Uint8Array(N);
    const closed = new Uint8Array(N);
    const open: number[] = [];

    const h = (c1: number, r1: number): number => {
      const dx = Math.abs(c1 - tc);
      const dy = Math.abs(r1 - tr);
      return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * NAV_CELL;
    };

    gScore[start] = 0;
    fScore[start] = h(sc, sr);
    open.push(start);
    inOpen[start] = 1;

    const DC       = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DR       = [-1,-1,-1,  0, 0,  1, 1, 1];
    const STEPCOST = [
      Math.SQRT2 * NAV_CELL, NAV_CELL, Math.SQRT2 * NAV_CELL,
      NAV_CELL, NAV_CELL,
      Math.SQRT2 * NAV_CELL, NAV_CELL, Math.SQRT2 * NAV_CELL,
    ];

    while (open.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (fScore[open[i]] < fScore[open[bestIdx]]) bestIdx = i;
      }
      const cur = open[bestIdx];
      open[bestIdx] = open[open.length - 1];
      open.pop();
      inOpen[cur] = 0;

      if (cur === goal) {
        const path: Phaser.Math.Vector2[] = [];
        let node = goal;
        while (node !== -1) {
          const c = node % cols;
          const r = Math.floor(node / cols);
          path.push(new Phaser.Math.Vector2(
            c * NAV_CELL + NAV_CELL / 2,
            r * NAV_CELL + NAV_CELL / 2,
          ));
          node = parent[node];
        }
        path.reverse();
        path[path.length - 1].set(toX, toY);
        return path;
      }

      closed[cur] = 1;
      const cc = cur % cols;
      const cr = Math.floor(cur / cols);

      for (let i = 0; i < 8; i++) {
        const nc = cc + DC[i];
        const nr = cr + DR[i];
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;

        const nb = nr * cols + nc;
        if (closed[nb] || this.navGrid[nb]) continue;

        const tg = gScore[cur] + STEPCOST[i];
        if (tg < gScore[nb]) {
          parent[nb] = cur;
          gScore[nb] = tg;
          fScore[nb] = tg + h(nc, nr);
          if (!inOpen[nb]) {
            open.push(nb);
            inOpen[nb] = 1;
          }
        }
      }
    }

    return null;
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
