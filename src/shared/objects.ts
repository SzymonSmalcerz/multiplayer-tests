// ─── Runtime object registry ──────────────────────────────────────────────────
// Mutable registry populated at server startup from objects.json.
// New objects added via the designer are hot-reloaded into this map.
// Client loads the same JSON file via Phaser's asset loader.

import * as fs from "fs";
import { StaticObjectDef } from "./staticObjects";

export { StaticObjectDef };

/** All placeable static objects — built-ins + user-added. Populated by loadObjectRegistry(). */
export const OBJECT_REGISTRY: Record<string, StaticObjectDef> = {};

/** Load (or reload) objects.json into OBJECT_REGISTRY. Call once at server startup. */
export function loadObjectRegistry(filePath: string): void {
  try {
    const raw  = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, StaticObjectDef>;
    for (const [key, def] of Object.entries(data)) {
      OBJECT_REGISTRY[key] = def;
    }
  } catch {
    // File missing or malformed — registry stays with whatever was already loaded
  }
}
