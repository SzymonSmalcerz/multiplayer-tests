#!/usr/bin/env node
// import-desert-tiles.js
// Extracts 4 tiles from tiles_desert.png (64×64, 32×32 tiles, 2 cols × 2 rows)
// Output: tile_0441..tile_0444

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ROOT = path.resolve(__dirname, "..");
const SRC_IMAGE = path.join(ROOT, "tiles_desert.png");
const OUT_DIR = path.join(ROOT, "public", "assets", "tiles");
const TILES_JSON = path.join(OUT_DIR, "tiles.json");

const TILE = 32;

function cropTile(src, srcX, srcY) {
  const dst = new PNG({ width: TILE, height: TILE });
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const si = ((srcY + y) * src.width + (srcX + x)) * 4;
      const di = (y * TILE + x) * 4;
      dst.data[di]     = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

async function main() {
  if (!fs.existsSync(SRC_IMAGE)) {
    console.error(`Source image not found: ${SRC_IMAGE}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const srcData = fs.readFileSync(SRC_IMAGE);
  const src = PNG.sync.read(srcData);

  console.log(`Source image: ${src.width}×${src.height}`);
  if (src.width !== 64 || src.height !== 64) {
    console.warn(`WARNING: Expected 64×64 but got ${src.width}×${src.height}`);
  }

  let tiles = {};
  if (fs.existsSync(TILES_JSON)) {
    tiles = JSON.parse(fs.readFileSync(TILES_JSON, "utf8"));
  }

  const newEntries = [];
  let n = 1;

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const srcX = col * TILE;
      const srcY = row * TILE;
      const tileKey = `tile_044${n}`;
      const outPath = path.join(OUT_DIR, `${tileKey}.png`);

      const tile = cropTile(src, srcX, srcY);
      fs.writeFileSync(outPath, PNG.sync.write(tile));

      tiles[tileKey] = {
        type: tileKey,
        tag: "desert",
        label: tileKey,
        imageWidth: 32,
        imageHeight: 32,
      };

      newEntries.push(tileKey);
      n++;
    }
  }

  fs.writeFileSync(TILES_JSON, JSON.stringify(tiles, null, 2));

  console.log(`Done! Wrote ${newEntries.length} tiles: ${newEntries.join(", ")}`);
  console.log(`tiles.json now has ${Object.keys(tiles).length} entries`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
