export interface WeaponDef {
  type:        string;   // unique key, e.g. "great_sword"
  label:       string;   // display name shown in shop
  damage:      number;   // base damage per hit
  cost:        number;   // gold price; 0 = not for sale (default weapon)
  hitRadius:   number;   // px — bounding-circle radius of the attacking sprite
  orbitRadius: number;   // px — distance from player centre to weapon sprite centre (= spriteHeight/2 + 10)
  spritePath:  string;   // e.g. "/assets/weapons/great_sword.png"
}

/**
 * Mutable registry populated at server startup via loadWeaponRegistry().
 * Also mutated in-memory on POST /design/save-weapon and /design/update-weapon.
 * The client never calls loadWeaponRegistry(); it fetches /assets/weapons/weapons.json
 * directly via Phaser's loader.
 */
export const WEAPON_REGISTRY: Record<string, WeaponDef> = {};

/**
 * Read public/assets/weapons/weapons.json and populate WEAPON_REGISTRY.
 * Called once at server startup. The require("fs") lives inside the function
 * body so client-side bundlers tree-shake it away.
 */
export function loadWeaponRegistry(jsonPath: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Record<string, WeaponDef>;
    for (const [key, def] of Object.entries(data)) {
      WEAPON_REGISTRY[key] = def;
    }
  } catch { /* file missing or malformed */ }
}
