#!/usr/bin/env node
// rename-tiles.js
// Renames tile_0.png … tile_191.png → tile_000.png … tile_191.png
// and patches tiles.json keys, type, and label fields accordingly.

const fs = require("fs");
const path = require("path");

const TILES_DIR = path.resolve(__dirname, "..", "public", "assets", "tiles");
const TILES_JSON = path.join(TILES_DIR, "tiles.json");

// Step 1: Rename PNG files
let renamed = 0;
for (let i = 0; i <= 191; i++) {
  const oldName = path.join(TILES_DIR, `tile_${i}.png`);
  const newName = path.join(TILES_DIR, `tile_${String(i).padStart(3, "0")}.png`);
  if (oldName === newName) continue; // already padded (i >= 100 with 3 digits)
  if (fs.existsSync(oldName)) {
    fs.renameSync(oldName, newName);
    renamed++;
  }
}
console.log(`Renamed ${renamed} PNG files.`);

// Step 2: Patch tiles.json
const tiles = JSON.parse(fs.readFileSync(TILES_JSON, "utf8"));
const patched = {};

for (const [key, value] of Object.entries(tiles)) {
  const m = key.match(/^tile_(\d+)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const paddedKey = `tile_${String(n).padStart(3, "0")}`;
    patched[paddedKey] = {
      ...value,
      type: paddedKey,
      label: paddedKey,
    };
  } else {
    // grass_basic, dirt, etc. — leave untouched
    patched[key] = value;
  }
}

fs.writeFileSync(TILES_JSON, JSON.stringify(patched, null, 2));
console.log(`tiles.json patched: ${Object.keys(patched).length} entries.`);
