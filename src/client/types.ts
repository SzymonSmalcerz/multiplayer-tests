/** Tree data sent from server on room join */
export interface TreeData {
  x: number;
  y: number;
  sprite: string;
}

/** NPC data sent from server on room join */
export interface NpcData {
  type: string;
  x: number;
  y: number;
}

/** Map initialisation message payload */
export interface MapDataMessage {
  trees: TreeData[];
  npcs: NpcData[];
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
  gold: number;
  weapon: string;
  onChange: (cb: () => void) => void;
}

/** Scene init data passed from HomeScene → GameScene */
export interface GameSceneData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  room: any; // Colyseus.Room<any>
  nickname: string;
  skin: string;
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
}
