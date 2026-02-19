/** Tree data sent from server on room join */
export interface TreeData {
  x: number;
  y: number;
  sprite: string;
}

/** Map initialisation message payload */
export interface MapDataMessage {
  trees: TreeData[];
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
  label: Phaser.GameObjects.Text;
  chatBubble?: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  direction: number;
  skinKey: string;
}
