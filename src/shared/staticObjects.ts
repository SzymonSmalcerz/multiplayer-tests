// ─── Static game object type definition ──────────────────────────────────────
// Shared between server (for registry/validation) and client (for rendering and
// physics body setup). All runtime data lives in objects.json; this file is
// the TypeScript interface only.
//
// collision coords are in image-local space (pixels from image top-left),
// at the object's native display size (imageWidth × imageHeight).

export interface StaticObjectDef {
  type: string;
  imageWidth: number;
  imageHeight: number;
  /** Collision rectangle in image-local pixels. Omit for visual-only objects. */
  collision?: { x0: number; y0: number; x1: number; y1: number };
  /** Number of horizontal animation frames in the sprite sheet. Omit for static objects. */
  frameCount?: number;
  /** Animation playback speed in frames per second. Only used when frameCount > 1. */
  frameRate?: number;
  /** URL of the sprite image. Resolved at load time from objects.json. */
  spritePath?: string;
}
