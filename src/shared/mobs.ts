// ─── Mob definitions ──────────────────────────────────────────────────────────
// Single source of truth for every client-side decorative mob type.
// Imported by the server only for the designer API endpoint;
// all movement/animation logic lives exclusively in src/client/MobSystem.ts.

export interface MobFrames {
  goLeft:        number[];
  goRight:       number[];
  goUp:          number[];
  goDown:        number[];
  specialAction: number[];
}

export interface MobDef {
  type:        string;
  frameWidth:  number;
  frameHeight: number;
  /** Default animation frames; individual map placements may override specialAction. */
  frames:      MobFrames;
  /** Pixels moved per frame (at 60 fps). */
  defaultSpeed:                  number;
  /** ms between action changes. */
  defaultChangeTime:             number;
  /** Probability (0–1) of choosing specialAction on each change. */
  defaultChanceOfSpecialAction:  number;
  /** ms to hold specialAction before picking a new action. */
  defaultSpecialTime:            number;
  /** Sprite animation frames per second. */
  defaultFrameRate:              number;
}

export const MOB_REGISTRY: Record<string, MobDef> = {
  butterfly: {
    type: "butterfly",
    frameWidth: 16, frameHeight: 32,
    frames: {
      goLeft:        [0, 1, 2, 3],
      goRight:       [4, 5, 6, 7],
      goUp:          [8, 9, 10, 11],
      goDown:        [12, 13, 14, 15],
      specialAction: [16, 17, 18, 19],
    },
    defaultSpeed: 1,
    defaultChangeTime: 3000,
    defaultChanceOfSpecialAction: 0.3,
    defaultSpecialTime: 2000,
    defaultFrameRate: 5,
  },

  cat: {
    type: "cat",
    frameWidth: 30, frameHeight: 30,
    frames: {
      goLeft:        [0, 1, 2, 3],
      goRight:       [4, 5, 6, 7],
      goUp:          [8, 9, 10, 11],
      goDown:        [12, 13, 14, 15],
      specialAction: [16, 17, 18, 19],
    },
    defaultSpeed: 1,
    defaultChangeTime: 5000,
    defaultChanceOfSpecialAction: 0.3,
    defaultSpecialTime: 4000,
    defaultFrameRate: 4,
  },

  chicken: {
    type: "chicken",
    frameWidth: 32, frameHeight: 32,
    frames: {
      goLeft:        [0, 1, 2, 3],
      goRight:       [4, 5, 6, 7],
      goUp:          [8, 9, 10, 11],
      goDown:        [12, 13, 14, 15],
      specialAction: [16, 17, 18, 19],
    },
    defaultSpeed: 1,
    defaultChangeTime: 5000,
    defaultChanceOfSpecialAction: 0.55,
    defaultSpecialTime: 3000,
    defaultFrameRate: 5,
  },

  cow: {
    type: "cow",
    frameWidth: 80, frameHeight: 80,
    frames: {
      goLeft:        [0, 1, 2, 3],
      goRight:       [4, 5, 6, 7],
      goUp:          [8, 9, 10, 11],
      goDown:        [12, 13, 14, 15],
      specialAction: [16, 17, 18, 19],
    },
    defaultSpeed: 2,
    defaultChangeTime: 2000,
    defaultChanceOfSpecialAction: 0.4,
    defaultSpecialTime: 10000,
    defaultFrameRate: 1.5,
  },

  dog: {
    type: "dog",
    frameWidth: 32, frameHeight: 32,
    frames: {
      goLeft:        [0, 1, 2, 3],
      goRight:       [4, 5, 6, 7],
      goUp:          [8, 9, 10, 11],
      goDown:        [12, 13, 14, 15],
      specialAction: [16, 17, 18, 19],
    },
    defaultSpeed: 1,
    defaultChangeTime: 3000,
    defaultChanceOfSpecialAction: 0.2,
    defaultSpecialTime: 2000,
    defaultFrameRate: 2,
  },

  pig: {
    type: "pig",
    frameWidth: 60, frameHeight: 60,
    frames: {
      goLeft:        [0, 1, 2, 3],
      goRight:       [4, 5, 6, 7],
      goUp:          [8, 9, 10, 11],
      goDown:        [12, 13, 14, 15],
      specialAction: [16, 17, 18, 19],
    },
    defaultSpeed: 1,
    defaultChangeTime: 4000,
    defaultChanceOfSpecialAction: 0.4,
    defaultSpecialTime: 4000,
    defaultFrameRate: 4,
  },
};
