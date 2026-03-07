import Phaser from "phaser";
import { HomeScene } from "./HomeScene";
import { GameScene } from "./GameScene";

// Phaser 3.60+ ignores root `resolution`; Text objects render into their own
// offscreen canvas at resolution=1 by default. Patch the factory so every
// scene.add.text() call automatically renders at the physical pixel density.
const baseDpr = window.devicePixelRatio || 1;
const bestRes = Math.ceil(Math.max(baseDpr, 2));

const _origText = Phaser.GameObjects.GameObjectFactory.prototype.text;
Phaser.GameObjects.GameObjectFactory.prototype.text = function (
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle
) {
  const t = _origText.call(this, x, y, text, style);
  t.setResolution(bestRes);
  return t;
};

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: window.innerWidth,
  height: window.innerHeight,
  transparent: true,
  roundPixels: true,
  resolution: bestRes,
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
