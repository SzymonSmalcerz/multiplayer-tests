import Phaser from "phaser";

export interface DragConfig {
  panelW:       number;
  panelH:       number;
  lsKey:        string;
  borderColor:  number;
  borderRadius: number;
  onDone:       (pos: { rightOffset: number; topOffset: number }) => void;
}

/**
 * Wires drag-to-reposition behaviour onto a panel drag handle.
 * Returns a cleanup function that removes scene-level pointermove/pointerup
 * listeners — call it when closing the panel.
 */
export function makeDraggable(
  scene:     Phaser.Scene,
  handle:    Phaser.GameObjects.Rectangle,
  getOrigin: () => { x: number; y: number },
  cfg:       DragConfig,
): () => void {
  let preview:     Phaser.GameObjects.Graphics | null          = null;
  let moveHandler: ((p: Phaser.Input.Pointer) => void) | null = null;
  let upHandler:   ((p: Phaser.Input.Pointer) => void) | null = null;

  const cleanup = (): void => {
    if (moveHandler) { scene.input.off("pointermove", moveHandler); moveHandler = null; }
    if (upHandler)   { scene.input.off("pointerup",   upHandler);   upHandler   = null; }
    if (preview)     { preview.destroy(); preview = null; }
  };

  handle.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
    const { width, height } = scene.scale;
    const { x: panelX, y: panelY } = getOrigin();
    const startX = ptr.x;
    const startY = ptr.y;
    const { panelW, panelH, borderColor, borderRadius } = cfg;

    preview = scene.add.graphics()
      .lineStyle(2, borderColor, 0.8)
      .strokeRoundedRect(panelX, panelY, panelW, panelH, borderRadius)
      .setScrollFactor(0).setDepth(300000);

    moveHandler = (p: Phaser.Input.Pointer) => {
      const nx = Math.max(0, Math.min(width  - panelW, panelX + p.x - startX));
      const ny = Math.max(0, Math.min(height - panelH, panelY + p.y - startY));
      preview!.clear()
        .lineStyle(2, borderColor, 0.8)
        .strokeRoundedRect(nx, ny, panelW, panelH, borderRadius);
    };

    upHandler = (p: Phaser.Input.Pointer) => {
      const nx  = Math.round(Math.max(0, Math.min(width  - panelW, panelX + p.x - startX)));
      const ny  = Math.round(Math.max(0, Math.min(height - panelH, panelY + p.y - startY)));
      const pos = { rightOffset: width - nx, topOffset: ny };
      localStorage.setItem(cfg.lsKey, JSON.stringify(pos));
      cleanup();
      cfg.onDone(pos);
    };

    scene.input.on("pointermove", moveHandler);
    scene.input.on("pointerup",   upHandler);
  });

  return cleanup;
}
