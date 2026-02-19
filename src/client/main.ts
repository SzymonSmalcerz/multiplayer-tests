import Phaser from "phaser";
import { HomeScene } from "./HomeScene";
import { GameScene } from "./GameScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#2d7a2d",
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [HomeScene, GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

window.addEventListener("load", () => {
  new Phaser.Game(config);
});
