#!/usr/bin/env node
// import-border-tiles.js
// Extracts 16 tiles from tiles_border.png (128×128, 32×32 tiles)
// Left half (cols 0-1): tile_0081..tile_0088
// Right half (cols 2-3): tile_0251..tile_0258

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ROOT = path.resolve(__dirname, "..");
const SRC_IMAGE = path.join(ROOT, "tiles_border.png");
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

const GROUPS = [
  { startX: 0,  startN: 81,  prefix: "tile_008" },
  { startX: 64, startN: 251, prefix: "tile_025" },
];

async function main() {
  if (!fs.existsSync(SRC_IMAGE)) {
    console.error(`Source image not found: ${SRC_IMAGE}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const srcData = fs.readFileSync(SRC_IMAGE);
  const src = PNG.sync.read(srcData);

  console.log(`Source image: ${src.width}×${src.height}`);
  if (src.width !== 128 || src.height !== 128) {
    console.warn(`WARNING: Expected 128×128 but got ${src.width}×${src.height}`);
  }

  let tiles = {};
  if (fs.existsSync(TILES_JSON)) {
    tiles = JSON.parse(fs.readFileSync(TILES_JSON, "utf8"));
  }

  const newEntries = [];

  for (const group of GROUPS) {
    let n = 0;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 2; col++) {
        const srcX = group.startX + col * TILE;
        const srcY = row * TILE;
        const tileNum = group.startN + n;
        const tileKey = `tile_${String(tileNum).padStart(4, "0")}`;
        const outPath = path.join(OUT_DIR, `${tileKey}.png`);

        const tile = cropTile(src, srcX, srcY);
        fs.writeFileSync(outPath, PNG.sync.write(tile));

        tiles[tileKey] = {
          type: tileKey,
          tag: "village",
          label: tileKey,
          imageWidth: 32,
          imageHeight: 32,
        };

        newEntries.push(tileKey);
        n++;
      }
    }
  }

  fs.writeFileSync(TILES_JSON, JSON.stringify(tiles, null, 2));

  console.log(`Done! Wrote ${newEntries.length} tiles: ${newEntries.join(", ")}`);
  console.log(`tiles.json now has ${Object.keys(tiles).length} entries`);
  console.log(`Output: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
