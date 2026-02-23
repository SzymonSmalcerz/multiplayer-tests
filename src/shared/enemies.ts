export interface EnemyDef {
  type:               string;   // registry key, e.g. "hit"
  label:              string;   // human-readable name shown in designer sidebar
  defaultRespawnTime: number;   // seconds, pre-filled when the designer places one
  spritePath:         string;   // URL path to the spritesheet, e.g. "/assets/enemies/hit.png"
  frameWidth:         number;   // px per frame
  frameHeight:        number;
  idleFrame:          number;   // 0-based frame index of the first idle frame
}

export const ENEMY_REGISTRY: Record<string, EnemyDef> = {
  hit: {
    type:               "hit",
    label:              "Hit Enemy",
    defaultRespawnTime: 10,
    spritePath:         "/assets/enemies/hit.png",
    frameWidth:         32,
    frameHeight:        32,
    idleFrame:          0,
  },
};
