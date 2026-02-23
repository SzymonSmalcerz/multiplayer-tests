export interface EnemyDef {
  type:               string;
  label:              string;
  level:              number;
  hp:                 number;
  damage:             number;
  xpReward:           number;
  goldAmount:         number;
  goldChance:         number;
  defaultRespawnTime: number;
  speed:              number;
  aggroRange:         number;
  attackRange:        number;
  attackCooldownMs:   number;
  frameWidth:         number;
  frameHeight:        number;
  framesPerState:     number;
  spritePath:         string;
  hitbox: { x: number; y: number; width: number; height: number };
}

/**
 * Mutable registry populated at server startup via loadEnemyRegistry().
 * Also mutated in-memory on POST /design/save-enemy for hot-reload.
 * The client never calls loadEnemyRegistry(); it fetches /assets/enemies/enemies.json
 * directly via Phaser's loader.
 */
export const ENEMY_REGISTRY: Record<string, EnemyDef> = {};

/**
 * Read public/assets/enemies/enemies.json and populate ENEMY_REGISTRY.
 * Called once at server startup. The require("fs") lives inside the function
 * body so client-side bundlers tree-shake it away.
 */
export function loadEnemyRegistry(jsonPath: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs   = require("fs") as typeof import("fs");
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Record<string, EnemyDef>;
  for (const [key, def] of Object.entries(data)) {
    ENEMY_REGISTRY[key] = def;
  }
}
