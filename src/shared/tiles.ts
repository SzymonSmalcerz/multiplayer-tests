// ─── Runtime tile registry ─────────────────────────────────────────────────
// Mutable registry populated at server startup from tiles.json.
// New tiles added via the designer are hot-reloaded into this map.
// Client loads the same JSON file via Phaser's asset loader.

import * as fs from "fs";

export interface TileDef {
  type:        string;
  label:       string;
  imageWidth:  number;
  imageHeight: number;
}

/** All registered tile types. Populated by loadTileRegistry(). */
export const TILE_REGISTRY: Record<string, TileDef> = {};

/** Load (or reload) tiles.json into TILE_REGISTRY. Call once at server startup. */
export function loadTileRegistry(filePath: string): void {
  try {
    const raw  = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, TileDef>;
    for (const [key, def] of Object.entries(data)) {
      TILE_REGISTRY[key] = def;
    }
  } catch {
    // File missing or malformed — registry stays with whatever was already loaded
  }
}
