#!/usr/bin/env node
// import-a2-tiles.js
// Extracts 192 tiles from A2_Ground.png (512×384, 32×32 tiles)
// and writes them + tiles.json entries into public/assets/tiles/

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ROOT = path.resolve(__dirname, "..");
const SRC_IMAGE = path.join(ROOT, "A2_Ground.png");
const OUT_DIR = path.join(ROOT, "public", "assets", "tiles");
const TILES_JSON = path.join(OUT_DIR, "tiles.json");

const TILE = 32;
const GROUP_W = 64;  // 2 tiles wide
const GROUP_H = 96;  // 3 tiles tall
const GROUPS_X = 8;  // 512 / 64
const GROUPS_Y = 4;  // 384 / 96

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

  // Read source PNG
  const srcData = fs.readFileSync(SRC_IMAGE);
  const src = PNG.sync.read(srcData);

  console.log(`Source image: ${src.width}×${src.height}`);
  if (src.width !== 512 || src.height !== 384) {
    console.warn(`WARNING: Expected 512×384 but got ${src.width}×${src.height}`);
  }

  // Load existing tiles.json
  let tiles = {};
  if (fs.existsSync(TILES_JSON)) {
    tiles = JSON.parse(fs.readFileSync(TILES_JSON, "utf8"));
  }

  let index = 0;
  const newEntries = [];

  for (let gy = 0; gy < GROUPS_Y; gy++) {
    for (let gx = 0; gx < GROUPS_X; gx++) {
      for (let ty = 0; ty < 3; ty++) {
        for (let tx = 0; tx < 2; tx++) {
          const srcX = gx * GROUP_W + tx * TILE;
          const srcY = gy * GROUP_H + ty * TILE;

          const tile = cropTile(src, srcX, srcY);
          const tileKey = `tile_${String(index).padStart(3, "0")}`;
          const outPath = path.join(OUT_DIR, `${tileKey}.png`);

          fs.writeFileSync(outPath, PNG.sync.write(tile));

          tiles[tileKey] = {
            type: tileKey,
            tag: "village",
            label: tileKey,
            imageWidth: 32,
            imageHeight: 32,
          };

          newEntries.push(tileKey);
          index++;
        }
      }
    }
  }

  fs.writeFileSync(TILES_JSON, JSON.stringify(tiles, null, 2));

  console.log(`Done! Wrote ${newEntries.length} tiles (tile_000 … tile_${String(index - 1).padStart(3, "0")})`);
  console.log(`tiles.json now has ${Object.keys(tiles).length} entries`);
  console.log(`Output: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
