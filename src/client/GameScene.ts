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

const TREE_KEYS = ["tree1", "tree2", "tree3"];

// Tree sprite dimensions and trunk collision box (pixel coords within the 96×128 sprite)
const TREE_W = 96;
const TREE_H = 128;
// Collision box corners within sprite: top-left (36,94) → bottom-right (64,111)
const TRUNK_BODY_X      = 36;               // offset from sprite left
const TRUNK_BODY_Y      = 94;               // offset from sprite top
const TRUNK_BODY_WIDTH  = 64 - 36;          // 28 px
const TRUNK_BODY_HEIGHT = 111 - 94;         // 17 px

// Player collision box (pixel coords within the 64×64 sprite frame)
// Top-left corner (26,47) → bottom-right corner (39,54)
const PLAYER_BODY_X      = 26;              // offset from sprite left
const PLAYER_BODY_Y      = 47;              // offset from sprite top
const PLAYER_BODY_WIDTH  = 39 - 26;         // 13 px
const PLAYER_BODY_HEIGHT = 54 - 47;         // 7 px

// ─── Click-to-move / pathfinding ─────────────────────────────────────────────
const NAV_CELL = 16;           // px per nav-grid cell (2000/16 = 125 cols/rows)
const WAYPOINT_THRESHOLD = 8;  // px — distance at which we advance to the next waypoint

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

  // Nav grid for click-to-move (flat Uint8Array: 1 = blocked, 0 = free)
  private navGrid = new Uint8Array(0);
  private navCols = 0;
  private navRows = 0;

  // Active path (world-space waypoints) and current waypoint index
  private pathWaypoints: Phaser.Math.Vector2[] = [];
  private pathIndex = 0;

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

    // Click-to-move markers
    this.load.image("x_green", "/assets/shortestPath/xGreen.png");
    this.load.image("x_red",   "/assets/shortestPath/xRed.png");

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

    // ── Click / tap to move ───────────────────────────────────────────────────
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.onMapClick(pointer.worldX, pointer.worldY);
    });

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
    this.localSprite.setDepth(y + FRAME_SIZE / 2);

    // Narrow foot-area collision box so the player walks naturally under canopies.
    // setOffset is measured from the sprite's top-left corner (origin 0.5,0.5 is
    // accounted for by Phaser: top-left = sprite.x - 32, sprite.y - 32).
    const body = this.localSprite.body as Phaser.Physics.Arcade.Body;
    body.setSize(PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT);
    body.setOffset(PLAYER_BODY_X, PLAYER_BODY_Y);
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
    // Register the handler FIRST, then request the data so the message
    // is never received before the handler exists (timing-safe).
    this.room.onMessage("map_data", (data: MapDataMessage) => {
      this.placeTrees(data.trees);
      this.buildNavGrid(data.trees);
      this.physics.add.collider(this.localSprite, this.treesGroup);
    });
    this.room.send("get_map");

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
      const img = this.treesGroup.create(td.x, td.y, td.sprite) as Phaser.Physics.Arcade.Image;

      // Force the display size to the known sprite dimensions (96×128)
      img.setDisplaySize(TREE_W, TREE_H);

      /**
       * Collision box at the trunk base.
       * Sprite origin is (0.5, 0.5), so Phaser measures body.setOffset from
       * the sprite's top-left corner: (x - w/2, y - h/2).
       *
       * Box in sprite-local coords: x 36→64, y 94→111
       *   → offset  = (36, 94)
       *   → size    = (28, 17)
       */
      const body = img.body as Phaser.Physics.Arcade.StaticBody;
      body.setSize(TRUNK_BODY_WIDTH, TRUNK_BODY_HEIGHT);
      body.setOffset(TRUNK_BODY_X, TRUNK_BODY_Y);

      // Depth = bottom edge of the sprite (centre + half-height)
      img.setDepth(td.y + TREE_H / 2);
    }
    this.treesGroup.refresh();
  }

  // ── Remote player management ───────────────────────────────────────────────

  private addRemotePlayer(player: RemotePlayer, sessionId: string): void {
    const key = skinKey(player.skin ?? "male/1lvl");
    const safeKey = this.textures.exists(key) ? key : "male_1lvl";

    const sprite = this.physics.add.sprite(player.x, player.y, safeKey);
    sprite.setDepth(player.y + FRAME_SIZE / 2);
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
    const anyKey = left || right || up || down;

    // Any keyboard press cancels the active path
    if (anyKey) this.pathWaypoints = [];

    let vx = 0, vy = 0;
    let moving = false;
    let dir = this.localDirection;

    if (anyKey) {
      // ── Keyboard movement ────────────────────────────────────────────────
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
    } else if (this.pathWaypoints.length > 0) {
      // ── Path following ───────────────────────────────────────────────────
      let wp = this.pathWaypoints[this.pathIndex];
      let dx = wp.x - this.localSprite.x;
      let dy = wp.y - this.localSprite.y;
      let dist = Math.sqrt(dx * dx + dy * dy);

      // Skip waypoints that are already reached to prevent one-frame stutters
      while (dist < WAYPOINT_THRESHOLD && this.pathWaypoints.length > 0) {
        this.pathIndex++;
        if (this.pathIndex >= this.pathWaypoints.length) {
          this.pathWaypoints = [];
          break;
        }
        wp = this.pathWaypoints[this.pathIndex];
        dx = wp.x - this.localSprite.x;
        dy = wp.y - this.localSprite.y;
        dist = Math.sqrt(dx * dx + dy * dy);
      }

      if (this.pathWaypoints.length > 0) {
        vx = (dx / dist) * PLAYER_SPEED;
        vy = (dy / dist) * PLAYER_SPEED;
        moving = true;
        // Pick closest cardinal direction for animation
        if (Math.abs(dx) >= Math.abs(dy)) {
          dir = dx > 0 ? 3 : 1; // right or left
        } else {
          dir = dy > 0 ? 0 : 2; // down or up
        }
      }
    }

    this.localSprite.setVelocity(vx, vy);
    this.localDirection = dir;

    // Animation
    const key = skinKey(this.localSkin);
    const animKey = `${key}_${DIR_NAMES[dir]}`;
    if (moving) {
      // Use ignoreIfPlaying=true so the animation doesn't restart every frame,
      // but DOES start if it was currently stopped.
      this.localSprite.play(animKey, true);
    } else {
      if (this.localSprite.anims.isPlaying) {
        this.localSprite.stop();
        this.localSprite.setFrame(DIR_TO_ROW[dir] * 9);
      }
    }

    // Depth = bottom edge so lower entities render in front
    this.localSprite.setDepth(this.localSprite.y + FRAME_SIZE / 2);
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
      sprite.setDepth(sprite.y + FRAME_SIZE / 2);

      // Animate based on whether the sprite is visually moving
      const dx = Math.abs(sprite.x - prevX);
      const dy = Math.abs(sprite.y - prevY);
      const moving = dx > 0.5 || dy > 0.5;
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

  // ── Pathfinding ────────────────────────────────────────────────────────────

  /**
   * Build a flat nav grid from the tree list.
   * Each cell is 16×16 px.  A cell is blocked when the player's sprite-centre
   * being in that cell would cause the player body to overlap a tree trunk.
   *
   * Player body world extent (sprite centre = px,py):
   *   x: [px−6 … px+7]   y: [py+15 … py+22]
   * Tree trunk world extent (tree sprite centre = tx,ty):
   *   x: [tx−12 … tx+16]  y: [ty+30 … ty+47]
   *
   * Sprite-centre exclusion zone = Minkowski difference:
   *   x: (tx−19 … tx+22)   y: (ty+8 … ty+32)
   * Expanded by NAV_CELL/2 so any cell whose centre lies in the bloated box
   * is treated as blocked:
   *   x: [tx−27 … tx+30]   y: [ty … ty+40]
   */
  private buildNavGrid(trees: TreeData[]): void {
    this.navCols = Math.ceil(MAP_W / NAV_CELL);
    this.navRows = Math.ceil(MAP_H / NAV_CELL);
    this.navGrid = new Uint8Array(this.navCols * this.navRows); // 0 = free

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

  /** A* on the nav grid.  Returns world-space waypoints or null if no path. */
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

    if (this.navGrid[tr * cols + tc]) return null; // destination blocked

    const start = sr * cols + sc;
    const goal  = tr * cols + tc;

    if (start === goal) return [new Phaser.Math.Vector2(toX, toY)];

    const gScore = new Float32Array(N).fill(Infinity);
    const fScore = new Float32Array(N).fill(Infinity);
    const parent = new Int32Array(N).fill(-1);
    const inOpen = new Uint8Array(N);
    const closed = new Uint8Array(N);
    const open: number[] = [];

    // Octile-distance heuristic (admissible for 8-directional grids)
    const h = (c1: number, r1: number): number => {
      const dx = Math.abs(c1 - tc);
      const dy = Math.abs(r1 - tr);
      return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * NAV_CELL;
    };

    gScore[start] = 0;
    fScore[start] = h(sc, sr);
    open.push(start);
    inOpen[start] = 1;

    // 8-directional neighbour offsets and their movement costs
    const DC       = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DR       = [-1,-1,-1,  0, 0,  1, 1, 1];
    const STEPCOST = [
      Math.SQRT2 * NAV_CELL, NAV_CELL, Math.SQRT2 * NAV_CELL,
      NAV_CELL, NAV_CELL,
      Math.SQRT2 * NAV_CELL, NAV_CELL, Math.SQRT2 * NAV_CELL,
    ];

    while (open.length > 0) {
      // Find the open node with the lowest fScore (linear scan is fine for 125×125)
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (fScore[open[i]] < fScore[open[bestIdx]]) bestIdx = i;
      }
      const cur = open[bestIdx];
      // Fast removal: swap with last element
      open[bestIdx] = open[open.length - 1];
      open.pop();
      inOpen[cur] = 0;

      if (cur === goal) {
        // Reconstruct path — cell centres as waypoints; replace the last
        // with the exact click position so the player walks all the way in.
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

    return null; // no path found
  }

  /** Handle a tap/click on the world. Starts pathfinding and shows a marker. */
  private onMapClick(worldX: number, worldY: number): void {
    if (this.navGrid.length === 0) return; // map not loaded yet

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

  /** Show a green (reachable) or red (blocked) X marker that fades after 1 s. */
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
