// ─── Static game object definitions ──────────────────────────────────────────
// Single source of truth for every placeable, collidable static object.
// Import this on both server (for object filtering) and client (for rendering
// and physics body setup).
//
// collision coords are in image-local space (pixels from image top-left),
// at the object's native display size (imageWidth × imageHeight).

export interface StaticObjectDef {
  type: string;
  imageWidth: number;
  imageHeight: number;
  /** Collision rectangle in image-local pixels (from top-left of the image). */
  collision: { x0: number; y0: number; x1: number; y1: number };
}

export const STATIC_OBJECT_REGISTRY: Record<string, StaticObjectDef> = {
  tree1: {
    type: "tree1",
    imageWidth: 96,
    imageHeight: 128,
    collision: { x0: 36, y0: 94, x1: 64, y1: 111 },
  },
  tree2: {
    type: "tree2",
    imageWidth: 96,
    imageHeight: 128,
    collision: { x0: 36, y0: 94, x1: 64, y1: 111 },
  },
  tree3: {
    type: "tree3",
    imageWidth: 96,
    imageHeight: 128,
    collision: { x0: 36, y0: 94, x1: 64, y1: 111 },
  },
  house_cottage_big: {
    type: "house_cottage_big",
    imageWidth: 270,
    imageHeight: 350,
    // Only the ground-floor footprint — roof overhangs excluded
    collision: { x0: 21, y0: 211, x1: 230, y1: 343 },
  },
  house_cottage_small: {
    type: "house_cottage_small",
    imageWidth: 125,
    imageHeight: 150,
    collision: { x0: 18, y0: 106, x1: 100, y1: 139 },
  },
  house_cottage_big_2: {
    type: "house_cottage_big_2",
    imageWidth: 340,
    imageHeight: 340,
    collision: { x0: 30, y0: 210, x1: 310, y1: 340 },
  },
  house2_b: {
    type: "house2_b",
    imageWidth: 270,
    imageHeight: 350,
    collision: { x0: 21, y0: 211, x1: 230, y1: 343 },
  },
  house2_old: {
    type: "house2_old",
    imageWidth: 270,
    imageHeight: 350,
    collision: { x0: 21, y0: 211, x1: 230, y1: 343 },
  },

  // ── Semitown houses ────────────────────────────────────────────────────────
  house_semitown_big_1: {
    type: "house_semitown_big_1",
    imageWidth: 262,
    imageHeight: 192,
    collision: { x0: 0, y0: 100, x1: 253, y1: 192 },
  },
  house_semitown_big_2: {
    type: "house_semitown_big_2",
    imageWidth: 262,
    imageHeight: 192,
    collision: { x0: 0, y0: 100, x1: 253, y1: 192 },
  },
  house_semitown_long_1: {
    type: "house_semitown_long_1",
    imageWidth: 147,
    imageHeight: 309,
    collision: { x0: 0, y0: 134, x1: 133, y1: 309 },
  },
  house_semitown_small_1: {
    type: "house_semitown_small_1",
    imageWidth: 110,
    imageHeight: 160,
    collision: { x0: 3, y0: 75, x1: 93, y1: 160 },
  },
  house_semitown_small_2: {
    type: "house_semitown_small_2",
    imageWidth: 110,
    imageHeight: 160,
    collision: { x0: 3, y0: 75, x1: 93, y1: 160 },
  },
  house_semitown_small_3: {
    type: "house_semitown_small_3",
    imageWidth: 110,
    imageHeight: 160,
    collision: { x0: 3, y0: 75, x1: 93, y1: 160 },
  },
  house_semitown_small_4: {
    type: "house_semitown_small_4",
    imageWidth: 110,
    imageHeight: 160,
    collision: { x0: 3, y0: 75, x1: 93, y1: 160 },
  },
  house_semitown_small_5: {
    type: "house_semitown_small_5",
    imageWidth: 110,
    imageHeight: 160,
    collision: { x0: 3, y0: 75, x1: 93, y1: 160 },
  },
  house_semitown_small_6: {
    type: "house_semitown_small_6",
    imageWidth: 110,
    imageHeight: 160,
    collision: { x0: 3, y0: 75, x1: 93, y1: 160 },
  },

  // ── Town houses ────────────────────────────────────────────────────────────
  house_town_1: {
    type: "house_town_1",
    imageWidth: 318,
    imageHeight: 227,
    collision: { x0: 10, y0: 100, x1: 308, y1: 227 },
  },
  house_town_2: {
    type: "house_town_2",
    imageWidth: 197,
    imageHeight: 272,
    collision: { x0: 15, y0: 122, x1: 182, y1: 272 },
  },
  house_town_3: {
    type: "house_town_3",
    imageWidth: 147,
    imageHeight: 198,
    collision: { x0: 10, y0: 80, x1: 137, y1: 198 },
  },
  house_town_4: {
    type: "house_town_4",
    imageWidth: 193,
    imageHeight: 213,
    collision: { x0: 15, y0: 113, x1: 178, y1: 213 },
  },
  house_town_5: {
    type: "house_town_5",
    imageWidth: 185,
    imageHeight: 168,
    collision: { x0: 15, y0: 88, x1: 170, y1: 168 },
  },
  house_town_6: {
    type: "house_town_6",
    imageWidth: 423,
    imageHeight: 210,
    collision: { x0: 10, y0: 0, x1: 423, y1: 210 },
  },

  // ── Props & decorations ────────────────────────────────────────────────────
  barell: {
    type: "barell",
    imageWidth: 30,
    imageHeight: 40,
    collision: { x0: 0, y0: 25, x1: 30, y1: 35 },
  },
  bucket_empty: {
    type: "bucket_empty",
    imageWidth: 25,
    imageHeight: 30,
    collision: { x0: 3, y0: 16, x1: 22, y1: 26 },
  },
  bucket_full: {
    type: "bucket_full",
    imageWidth: 25,
    imageHeight: 30,
    collision: { x0: 3, y0: 16, x1: 22, y1: 26 },
  },
  cage_animal_1: {
    type: "cage_animal_1",
    imageWidth: 96,
    imageHeight: 96,
    collision: { x0: 0, y0: 0, x1: 96, y1: 96 },
  },
  cart_full: {
    type: "cart_full",
    imageWidth: 90,
    imageHeight: 60,
    collision: { x0: 19, y0: 36, x1: 83, y1: 51 },
  },
  lamp: {
    type: "lamp",
    // Displayed at 28×78 (1/3 original width); collision matches that display size
    imageWidth: 28,
    imageHeight: 78,
    collision: { x0: 9, y0: 62, x1: 19, y1: 78 },
  },
  monument_lion: {
    type: "monument_lion",
    imageWidth: 51,
    imageHeight: 88,
    // Estimated base/pedestal footprint (source data was corrupted in original map)
    collision: { x0: 10, y0: 50, x1: 41, y1: 88 },
  },
  tent: {
    type: "tent",
    imageWidth: 130,
    imageHeight: 160,
    collision: { x0: 0, y0: 65, x1: 130, y1: 160 },
  },
  waterFountain: {
    type: "waterFountain",
    // Displayed at 64×76 (½ original width); collision matches that display size
    imageWidth: 64,
    imageHeight: 76,
    collision: { x0: 0, y0: 33, x1: 64, y1: 70 },
  },
  well: {
    type: "well",
    imageWidth: 77,
    imageHeight: 109,
    collision: { x0: 5, y0: 50, x1: 72, y1: 100 },
  },
  wheat: {
    type: "wheat",
    imageWidth: 30,
    imageHeight: 40,
    collision: { x0: 0, y0: 29, x1: 30, y1: 39 },
  },
  wood: {
    type: "wood",
    imageWidth: 30,
    imageHeight: 40,
    collision: { x0: 0, y0: 19, x1: 30, y1: 39 },
  },
  bower_1: {
    type: "bower_1",
    imageWidth: 96,
    imageHeight: 132,
    collision: { x0: 30, y0: 100, x1: 66, y1: 132 },
  },
  bower_2: {
    type: "bower_2",
    imageWidth: 100,
    imageHeight: 110,
    collision: { x0: 20, y0: 80, x1: 80, y1: 110 },
  },
  bower_3: {
    type: "bower_3",
    imageWidth: 96,
    imageHeight: 132,
    collision: { x0: 30, y0: 100, x1: 66, y1: 132 },
  },
  toitoi: {
    type: "toitoi",
    imageWidth: 70,
    imageHeight: 94,
    collision: { x0: 5, y0: 30, x1: 65, y1: 94 },
  },
};
