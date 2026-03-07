import Phaser from "phaser";
import { HomeScene } from "./HomeScene";
import { GameScene } from "./GameScene";

// Use the exact physical pixel ratio — no rounding, no floor.
// Math.ceil() or a minimum of 2 causes a canvas size mismatch on fractional
// displays (Android 2.625x, Windows 125%) which forces the browser to apply a
// CSS blur over the entire canvas.
const dpr = window.devicePixelRatio || 1;

// Patch every scene.add.text() call:
//   1. Strip any hardcoded `resolution` values baked into UI style configs so
//      they don't override the device pixel ratio.
//   2. Call setResolution() — the only API that works in Phaser 3.60+.
const _origText = Phaser.GameObjects.GameObjectFactory.prototype.text;
Phaser.GameObjects.GameObjectFactory.prototype.text = function (
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle
) {
  const cleanStyle = { ...style };
  delete cleanStyle.resolution;
  const t = _origText.call(this, x, y, text, cleanStyle);
  t.setResolution(dpr);
  return t;
};

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: window.innerWidth,
  height: window.innerHeight,
  transparent: true,
  pixelArt: true,      // NEAREST filtering keeps pixel-art sprites crisp
  roundPixels: false,  // must be false — true mangles text kerning on fractional DPR
  resolution: dpr,     // exact hardware match prevents browser CSS blur
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [HomeScene, GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    autoDensity: true,  // syncs CSS size with the high-res WebGL buffer
  },
};

window.addEventListener("load", () => {
  new Phaser.Game(config);
});
