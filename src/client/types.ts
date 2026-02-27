/** Static game object data sent from server on room join */
export interface StaticObjectData {
  type: string;
  x: number;
  y: number;
}

/** NPC data sent from server on room join */
export interface NpcData {
  type: string;
  x: number;
  y: number;
}

/** One mob spawn zone received from the server — always represents exactly one mob instance */
export interface MobPlacement {
  type:   string;
  x:      number;
  y:      number;
  width:  number;
  height: number;
  // behaviour values — always present (filled from registry defaults by the designer)
  speed?:                      number;
  changeTime?:                 number;
  specialTime?:                number;
  chanceOfDoingSpecialAction?: number;
  howManyAnimationsPerSec?:    number;
  specialActionArray?:         number[];
}

/** Enemy definition fields the client needs (display + animation; stats stay server-side) */
export interface ClientEnemyDef {
  type:           string;
  label:          string;
  level:          number;
  frameWidth:     number;
  frameHeight:    number;
  framesPerState: number;
  spritePath:     string;
}

/** One enemy spawn point loaded from the map JSON */
export interface EnemyPlacement {
  type:        string;
  x:           number;
  y:           number;
  respawnTime: number;  // seconds
}

/** A tile placed at a specific grid-snapped position on the map */
export interface TilePlacement {
  type: string;
  x:    number;
  y:    number;
}

/** A door that teleports the player to another map */
export interface DoorData {
  id:           string;
  x:            number;
  y:            number;
  targetMap:    string;
  targetDoorId: string;
}

/** Map initialisation message payload */
export interface MapDataMessage {
  defaultTile?: string;
  spawnPoint?:  { x: number; y: number };
  tiles?:       TilePlacement[];
  objects:      StaticObjectData[];
  npcs:         NpcData[];
  mobs:         MobPlacement[];
  doors?:       DoorData[];
}

/** Chat message payload */
export interface ChatMessage {
  sessionId: string;
  nickname: string;
  message: string;
}

/** Colyseus player proxy shape (mirrored from server schema) */
export interface RemotePlayer {
  x: number;
  y: number;
  nickname: string;
  skin: string;
  direction: number;
  showWeapon: boolean;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  attackBonus: number;
  isAttacking: boolean;
  attackDirection: number;
  isDead: boolean;
  partyId: string;
  isPartyOwner: boolean;
  partyName: string;
  partyRoster: string;
  gold: number;
  weapon: string;
  potions: number;
  potionHealRemaining: number;
  disconnected: boolean;
  onChange: (cb: () => void) => void;
}

/** Scene init data passed from HomeScene → GameScene (or GameScene → GameScene on teleport) */
export interface GameSceneData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  room:      any; // Colyseus.Room<any>
  nickname:  string;
  skin:      string;
  mapName?:  string;
  leaderboardData?: Array<{ nickname: string; level: number; xp: number; partyName: string }>;
  actionBarState?: any;
  equipmentState?: any;
}

/** Represents one remote player entity in the GameScene */
export interface RemotePlayerEntity {
  sprite: Phaser.Physics.Arcade.Sprite;
  weaponSprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  chatBubble?: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  direction: number;
  showWeapon: boolean;
  skinKey: string;
  level: number;
  isAttacking: boolean;
  attackDirection: number;
  attackOrbitTimer: number;
  weapon: string;
  isDead: boolean;
  graveSprite?: Phaser.GameObjects.Image;
  hpBar?: Phaser.GameObjects.Graphics;
  partyId: string;
  partyLabel?: Phaser.GameObjects.Text;
  /** Last HP ratio drawn to the world HP bar (-1 = bar is cleared / force redraw) */
  lastHpRatio: number;
}

/** Enemy state proxy (mirrors server EnemyState schema) */
export interface EnemyData {
  id: string;
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  direction: number;
  isAttacking: boolean;
  attackDirection: number;
  isDead: boolean;
  onChange: (cb: () => void) => void;
}

/** One rendered enemy entity in the GameScene */
export interface EnemyEntity {
  sprite: Phaser.GameObjects.Sprite;
  hpBar: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  direction: number;
  isAttacking: boolean;
  attackDirection: number;
  isDead: boolean;
  type: string;
  hp: number;
  maxHp: number;
  /** Last HP ratio drawn to the world HP bar (-1 = bar is cleared / force redraw) */
  lastHpRatio: number;
  /** Last animation key passed to sprite.play() — skip if unchanged */
  lastAnimKey: string;
}
