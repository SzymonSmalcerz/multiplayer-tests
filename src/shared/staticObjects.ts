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
};
