import Phaser from "phaser";
import { GameSceneData, MapDataMessage, RemotePlayer, RemotePlayerEntity, TreeData } from "./types";
import { ALL_SKINS, FRAME_W as FRAME_SIZE } from "./skins";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAP_W = 2000;
const MAP_H = 2000;
const PLAYER_SPEED = 200;            // px/s — client prediction speed
const SEND_RATE_MS = 50;             // send position @ 20 Hz
const LERP_FACTOR = 0.18;            // interpolation factor for remote players
const RECONCILE_THRESHOLD = 120;     // px — snap if server disagrees by more than this
const ANIM_FPS = 10;

// All selectable skins — preloaded so any player's chosen skin renders correctly
const SKINS_TO_LOAD = ALL_SKINS;

const TREE_KEYS = ["tree1", "tree2", "tree3", "tree4", "tree_pink_1", "tree_pink_2"];

// Maps game direction index (0=down,1=left,2=up,3=right) → animation name
const DIR_NAMES = ["walk_down", "walk_left", "walk_up", "walk_right"] as const;

// Sprite-sheet row → animation name  (row 0=up, 1=left, 2=down, 3=right per spec)
const ROW_ANIM_NAMES = ["walk_up", "walk_left", "walk_down", "walk_right"] as const;

// Direction index → sprite-sheet row  (down→row2, left→row1, up→row0, right→row3)
const DIR_TO_ROW = [2, 1, 0, 3] as const;

// Converts "male/1lvl" → "male_1lvl" (safe Phaser key)
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
  private localDirection = 0;

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;

  // Remote players
  private remoteMap = new Map<string, RemotePlayerEntity>();

  // Trees
  private treesGroup!: Phaser.Physics.Arcade.StaticGroup;

  // Timing
  private lastSendTime = 0;

  constructor() {
    super({ key: "GameScene" });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(data: GameSceneData): void {
    this.room = data.room;
    this.localNickname = data.nickname;
    this.localSkin = data.skin;
    this.mySessionId = data.room.sessionId as string;
  }

  preload(): void {
    // Player sprite sheets
    for (const skin of SKINS_TO_LOAD) {
      this.load.spritesheet(skinKey(skin), `/assets/player/${skin}.png`, {
        frameWidth: FRAME_SIZE,
        frameHeight: FRAME_SIZE,
      });
    }

    // Background tile
    this.load.image("grass", "/assets/maps/grass.png");

    // Tree images
    for (const key of TREE_KEYS) {
      this.load.image(key, `/assets/trees/${key}.png`);
    }
  }

  create(): void {
    // ── Background ────────────────────────────────────────────────────────────
    this.add.tileSprite(0, 0, MAP_W, MAP_H, "grass").setOrigin(0, 0).setDepth(0);

    // ── Physics world bounds ──────────────────────────────────────────────────
    this.physics.world.setBounds(0, 0, MAP_W, MAP_H);

    // ── Trees static group (populated when map_data arrives) ──────────────────
    this.treesGroup = this.physics.add.staticGroup();

    // ── Animations ────────────────────────────────────────────────────────────
    this.createAnimations();

    // ── Local player (position updated once server onAdd fires) ───────────────
    this.createLocalPlayer(MAP_W / 2, MAP_H / 2);

    // ── Camera ────────────────────────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, MAP_W, MAP_H);
    this.cameras.main.startFollow(this.localSprite, true, 0.08, 0.08);

    // ── Input ─────────────────────────────────────────────────────────────────
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyW = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // ── Colyseus listeners ────────────────────────────────────────────────────
    this.setupRoomListeners();
  }

  update(time: number, delta: number): void {
    this.handleLocalMovement(delta);
    this.interpolateRemotePlayers();
    this.sendPositionIfNeeded(time);
  }

  // ── Setup helpers ──────────────────────────────────────────────────────────

  private createLocalPlayer(x: number, y: number): void {
    const key = skinKey(this.localSkin);
    this.localSprite = this.physics.add.sprite(x, y, key);
    this.localSprite.setCollideWorldBounds(true);
    this.localSprite.setDepth(y);
    this.localSprite.play(`${key}_walk_down`);
    this.localSprite.stop();
    this.localSprite.setFrame(DIR_TO_ROW[0] * 9); // idle facing down = row 2, frame 18

    this.localLabel = this.add
      .text(x, y - 42, this.localNickname, {
        fontSize: "13px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(9999);
  }

  private createAnimations(): void {
    for (const skin of SKINS_TO_LOAD) {
      const key = skinKey(skin);
      if (!this.textures.exists(key)) continue;

      for (let row = 0; row < 4; row++) {
        const start = row * 9;
        const end = start + 8;
        this.anims.create({
          key: `${key}_${ROW_ANIM_NAMES[row]}`,
          frames: this.anims.generateFrameNumbers(key, { start, end }),
          frameRate: ANIM_FPS,
          repeat: -1,
        });
      }
    }
  }

  private setupRoomListeners(): void {
    // Map layout (trees) — arrives once right after join
    this.room.onMessage("map_data", (data: MapDataMessage) => {
      this.placeTrees(data.trees);
      // Enable collision between local player and trees
      this.physics.add.collider(this.localSprite, this.treesGroup);
    });

    // A player entered the room (including our own entry for initial position)
    this.room.state.players.onAdd((player: RemotePlayer, sessionId: string) => {
      if (sessionId === this.mySessionId) {
        // Teleport local sprite to server-assigned spawn
        this.localSprite.setPosition(player.x, player.y);
        return;
      }
      this.addRemotePlayer(player, sessionId);
    });

    // A player left
    this.room.state.players.onRemove((_player: RemotePlayer, sessionId: string) => {
      this.removeRemotePlayer(sessionId);
    });

    // Authoritative position update for our own player → reconcile
    this.room.state.players.onChange((player: RemotePlayer, sessionId: string) => {
      if (sessionId !== this.mySessionId) return;
      const dx = Math.abs(player.x - this.localSprite.x);
      const dy = Math.abs(player.y - this.localSprite.y);
      if (dx > RECONCILE_THRESHOLD || dy > RECONCILE_THRESHOLD) {
        // Server is correcting a cheat or very large drift — snap
        this.localSprite.setPosition(player.x, player.y);
      }
    });

    // Connection dropped
    this.room.onLeave(() => {
      this.showDisconnectBanner();
    });
  }

  // ── Tree placement ─────────────────────────────────────────────────────────

  private placeTrees(trees: TreeData[]): void {
    for (const td of trees) {
      const img = this.treesGroup.create(
        td.x, td.y, td.sprite
      ) as Phaser.Physics.Arcade.Image;

      // Use a small trunk-sized collision box at the bottom of the sprite
      const w = img.width;
      const h = img.height;
      const bodyW = Math.min(40, w);
      const bodyH = Math.min(28, h * 0.4);
      const body = img.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(bodyW, bodyH);
      body.setOffset((w - bodyW) / 2, h - bodyH);

      // Y-based depth so taller trees are behind lower ones
      img.setDepth(td.y);
    }
    this.treesGroup.refresh();
  }

  // ── Remote player management ───────────────────────────────────────────────

  private addRemotePlayer(player: RemotePlayer, sessionId: string): void {
    const key = skinKey(player.skin ?? "male/1lvl");
    const safeKey = this.textures.exists(key) ? key : "male_1lvl";

    const sprite = this.physics.add.sprite(player.x, player.y, safeKey);
    sprite.setDepth(player.y);
    sprite.play(`${safeKey}_walk_down`);
    sprite.stop();
    sprite.setFrame(DIR_TO_ROW[0] * 9); // idle facing down = row 2, frame 18

    const label = this.add
      .text(player.x, player.y - 42, player.nickname ?? "", {
        fontSize: "13px",
        color: "#ffffaa",
        stroke: "#000000",
        strokeThickness: 3,
        resolution: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(9999);

    const entity: RemotePlayerEntity = {
      sprite,
      label,
      targetX: player.x,
      targetY: player.y,
      direction: player.direction ?? 0,
      skinKey: safeKey,
    };

    this.remoteMap.set(sessionId, entity);

    // Listen for position/direction updates from server state patches
    player.onChange(() => {
      const e = this.remoteMap.get(sessionId);
      if (!e) return;
      e.targetX = player.x;
      e.targetY = player.y;
      e.direction = player.direction ?? 0;
    });
  }

  private removeRemotePlayer(sessionId: string): void {
    const entity = this.remoteMap.get(sessionId);
    if (!entity) return;
    entity.sprite.destroy();
    entity.label.destroy();
    this.remoteMap.delete(sessionId);
  }

  // ── Per-frame logic ────────────────────────────────────────────────────────

  private handleLocalMovement(_delta: number): void {
    const left  = this.cursors.left!.isDown  || this.keyA.isDown;
    const right = this.cursors.right!.isDown || this.keyD.isDown;
    const up    = this.cursors.up!.isDown    || this.keyW.isDown;
    const down  = this.cursors.down!.isDown  || this.keyS.isDown;

    let vx = 0, vy = 0;
    let moving = false;
    let dir = this.localDirection;

    if (left)  { vx = -PLAYER_SPEED; dir = 1; moving = true; }
    if (right) { vx =  PLAYER_SPEED; dir = 3; moving = true; }
    if (up)    { vy = -PLAYER_SPEED; if (!left && !right) dir = 2; moving = true; }
    if (down)  { vy =  PLAYER_SPEED; if (!left && !right) dir = 0; moving = true; }

    // Normalise diagonal speed
    if (vx !== 0 && vy !== 0) {
      const norm = Math.SQRT2;
      vx /= norm;
      vy /= norm;
    }

    this.localSprite.setVelocity(vx, vy);
    this.localDirection = dir;

    // Animation
    const key = skinKey(this.localSkin);
    const animKey = `${key}_${DIR_NAMES[dir]}`;
    if (moving) {
      if (this.localSprite.anims.currentAnim?.key !== animKey) {
        this.localSprite.play(animKey);
      }
    } else {
      if (this.localSprite.anims.isPlaying) {
        this.localSprite.stop();
        this.localSprite.setFrame(DIR_TO_ROW[dir] * 9); // standing frame for current direction
      }
    }

    // Depth and label
    this.localSprite.setDepth(this.localSprite.y);
    this.localLabel.setPosition(this.localSprite.x, this.localSprite.y - 42);
  }

  private interpolateRemotePlayers(): void {
    this.remoteMap.forEach((entity) => {
      const { sprite, label, targetX, targetY, direction, skinKey: key } = entity;

      const prevX = sprite.x;
      const prevY = sprite.y;

      // Lerp towards server-authoritative target
      sprite.x = Phaser.Math.Linear(sprite.x, targetX, LERP_FACTOR);
      sprite.y = Phaser.Math.Linear(sprite.y, targetY, LERP_FACTOR);

      label.setPosition(sprite.x, sprite.y - 42);
      sprite.setDepth(sprite.y);

      // Animate based on whether the sprite is visually moving
      const dx = Math.abs(sprite.x - prevX);
      const dy = Math.abs(sprite.y - prevY);
      const moving = dx > 0.5 || dy > 0.5;
      const safeKey = this.textures.exists(key) ? key : "male_1lvl";
      const animKey = `${safeKey}_${DIR_NAMES[direction]}`;

      if (moving) {
        if (sprite.anims.currentAnim?.key !== animKey) {
          sprite.play(animKey);
        }
      } else {
        if (sprite.anims.isPlaying) {
          sprite.stop();
          sprite.setFrame(DIR_TO_ROW[direction] * 9);
        }
      }
    });
  }

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
