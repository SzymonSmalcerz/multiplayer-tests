import Phaser from "phaser";
import { HomeScene } from "./HomeScene";
import { GameScene } from "./GameScene";

const dpr = window.devicePixelRatio || 1;

// Integer ceiling for the text's internal 2D canvas only.
// Fractional 2D canvas sizes (e.g. 2.625) cause sub-pixel blur in the browser.
// The WebGL canvas still uses exact dpr below — these are two different canvases.
const textRes = Math.max(2, Math.ceil(dpr));

// Patch every scene.add.text() call:
//   1. Strip any hardcoded `resolution` values baked into UI style configs so
//      they don't override the device pixel ratio.
//   2. Call setResolution() with integer ceiling — crisp 2D text canvas.
const _origText = Phaser.GameObjects.GameObjectFactory.prototype.text;
Phaser.GameObjects.GameObjectFactory.prototype.text = function (
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle
) {
  const cleanStyle = { ...style };
  delete cleanStyle.resolution;  // strip any hardcoded resolution from UI files
  const t = _origText.call(this, x, y, text, cleanStyle);
  t.setResolution(textRes);      // integer ceiling for crisp 2D text canvas
  return t;
};

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: window.innerWidth,
  height: window.innerHeight,
  transparent: true,
  roundPixels: true,  // prevents camera/sprite jitter
  resolution: dpr,    // exact DPR — no rounding — prevents CSS blur on WebGL canvas
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [HomeScene, GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    autoDensity: true,
  },
};

window.addEventListener("load", () => {
  new Phaser.Game(config);
});
