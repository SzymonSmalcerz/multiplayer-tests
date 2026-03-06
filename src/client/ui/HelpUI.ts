import Phaser from "phaser";

const D       = 200000;
const PANEL_W = 400;
const LS_KEY  = "help_pos";

interface SavedPos { rightOffset: number; topOffset: number; }

export class HelpUI {
  private scene: Phaser.Scene;
  private getPlayerState: () => { isGM: boolean } | null;
  private onInteract: () => void;

  private isOpen = false;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private savedPos: SavedPos | null = null;

  private dragPreview:     Phaser.GameObjects.Graphics | null            = null;
  private dragMoveHandler: ((ptr: Phaser.Input.Pointer) => void) | null = null;
  private dragUpHandler:   ((ptr: Phaser.Input.Pointer) => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    getPlayerState: () => { isGM: boolean } | null,
    onInteract: () => void,
  ) {
    this.scene          = scene;
    this.getPlayerState = getPlayerState;
    this.onInteract     = onInteract;

    const raw = localStorage.getItem(LS_KEY);
    if (raw) { try { this.savedPos = JSON.parse(raw); } catch { /* ignore */ } }
  }

  toggle(): void { this.isOpen ? this.close() : this.open(); }

  open(): void {
    if (this.isOpen) { this.close(); return; }
    this.isOpen = true;

    const s              = this.scene;
    const { width, height } = s.scale;
    const isGM          = this.getPlayerState()?.isGM ?? false;
    const HEADER_H      = 40;
    const CONTENT_H     = isGM ? 460 : 280;
    const panelH        = HEADER_H + CONTENT_H;

    const { px, py } = this.getPanelOrigin(width, height, PANEL_W, panelH);

    const add = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };

    // ── Panel background ──────────────────────────────────────────────────────
    add(s.add.graphics())
      .fillStyle(0x1a1005, 0.96)
      .fillRoundedRect(px, py, PANEL_W, panelH, 8)
      .lineStyle(2, 0xc8a84b, 1)
      .strokeRoundedRect(px, py, PANEL_W, panelH, 8)
      .setScrollFactor(0).setDepth(D);

    // ── Title ─────────────────────────────────────────────────────────────────
    add(s.add.text(px + PANEL_W / 2, py + 16, "Help & Controls", {
      fontSize: "16px", color: "#e8c96a",
      stroke: "#000000", strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 1));

    // ── Close button ──────────────────────────────────────────────────────────
    const closeBtn = add(s.add.text(px + PANEL_W - 10, py + 10, "×", {
      fontSize: "22px", color: "#ffffff",
      stroke: "#000000", strokeThickness: 2, resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 1)
      .setInteractive({ useHandCursor: true })) as Phaser.GameObjects.Text;
    closeBtn.on("pointerover", () => closeBtn.setColor("#ff4444"));
    closeBtn.on("pointerout",  () => closeBtn.setColor("#ffffff"));
    closeBtn.on("pointerdown", () => { this.onInteract(); this.close(); });

    // ── Drag handle ───────────────────────────────────────────────────────────
    const dragHandle = add(s.add.rectangle(
      px + (PANEL_W - 32) / 2, py + HEADER_H / 2,
      PANEL_W - 32, HEADER_H,
      0x000000, 0,
    ).setScrollFactor(0).setDepth(D + 2).setInteractive({ useHandCursor: true })) as Phaser.GameObjects.Rectangle;

    dragHandle.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      this.onInteract();
      this.beginPanelDrag(ptr, px, py, PANEL_W, panelH);
    });

    // ── Divider below title ───────────────────────────────────────────────────
    add(s.add.graphics())
      .lineStyle(1, 0x665533, 1)
      .lineBetween(px + 10, py + 30, px + PANEL_W - 10, py + 30)
      .setScrollFactor(0).setDepth(D + 1);

    // ── Content ───────────────────────────────────────────────────────────────
    let cy = py + HEADER_H + 8;
    const COL_KEY  = px + 14;
    const COL_DESC = px + 140;
    const ROW_H    = 18;

    const section = (title: string): void => {
      add(s.add.text(px + PANEL_W / 2, cy, title, {
        fontSize: "11px", color: "#c9a227",
        stroke: "#000000", strokeThickness: 2, resolution: 2,
        fontStyle: "bold",
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D + 1));
      cy += ROW_H + 2;
    };

    const divider = (): void => {
      add(s.add.graphics())
        .lineStyle(1, 0x443322, 0.8)
        .lineBetween(px + 10, cy, px + PANEL_W - 10, cy)
        .setScrollFactor(0).setDepth(D + 1);
      cy += 8;
    };

    const row = (key: string, desc: string): void => {
      add(s.add.text(COL_KEY, cy, key, {
        fontSize: "11px", color: "#88ff88",
        stroke: "#000000", strokeThickness: 2, resolution: 2,
      }).setScrollFactor(0).setDepth(D + 1));
      add(s.add.text(COL_DESC, cy, desc, {
        fontSize: "11px", color: "#e8d5a0",
        stroke: "#000000", strokeThickness: 2, resolution: 2,
      }).setScrollFactor(0).setDepth(D + 1));
      cy += ROW_H;
    };

    section("Movement & Combat");
    row("WASD / Arrows", "Move Character");
    row("Left Click",    "Walk to Destination");
    row("Space",         "Attack");
    row("1 - 4",         "Use Action Bar Item");
    row("Right Click",   "Use Item in Inventory");

    cy += 4;
    divider();
    section("Interface & Actions");
    row("I",     "Toggle Equipment & Inventory");
    row("C",     "Toggle Character Stats");
    row("M",     "Toggle Minimap");
    row("Enter", "Open Chat");
    row("H",     "Toggle this Help Window");
    row("Esc",   "Close Windows / Cancel Chat");

    if (isGM) {
      cy += 4;
      divider();
      section("GM Commands (Chat)");
      row("/spawn",    "[mob] [amount] - Spawn enemies");
      row("/kick",     "[name] - Kick player from server");
      row("/exp",      "[amount] [name] - Give XP");
      row("/gold",     "[amount] [name] - Give Gold");
      row("/summon",   "[name] - Bring player to you");
      row("/teleport", "[name] - Go to player");
      row("/unstuck",  "[name] - Send player to spawn");
      row("/time",     "[seconds] - Add/remove session time");
    }
  }

  private getPanelOrigin(width: number, height: number, panelW: number, panelH: number): { px: number; py: number } {
    if (this.savedPos) {
      const px = Math.max(0, Math.min(width  - panelW, width  - this.savedPos.rightOffset));
      const py = Math.max(0, Math.min(height - panelH, this.savedPos.topOffset));
      return { px, py };
    }
    return {
      px: Math.round((width  - panelW) / 2),
      py: Math.round((height - panelH) / 2),
    };
  }

  private beginPanelDrag(ptr: Phaser.Input.Pointer, panelX: number, panelY: number, panelW: number, panelH: number): void {
    const { width, height } = this.scene.scale;
    const startX = ptr.x;
    const startY = ptr.y;

    const preview = this.scene.add.graphics()
      .lineStyle(2, 0xc8a84b, 0.8)
      .strokeRoundedRect(panelX, panelY, panelW, panelH, 8)
      .setScrollFactor(0).setDepth(300000);
    this.dragPreview = preview;

    this.dragMoveHandler = (p: Phaser.Input.Pointer) => {
      const newPx = Math.max(0, Math.min(width  - panelW, panelX + p.x - startX));
      const newPy = Math.max(0, Math.min(height - panelH, panelY + p.y - startY));
      preview.clear()
        .lineStyle(2, 0xc8a84b, 0.8)
        .strokeRoundedRect(newPx, newPy, panelW, panelH, 8);
    };

    this.dragUpHandler = (p: Phaser.Input.Pointer) => {
      const newPx = Math.max(0, Math.min(width  - panelW, panelX + p.x - startX));
      const newPy = Math.max(0, Math.min(height - panelH, panelY + p.y - startY));

      this.savedPos = { rightOffset: width - newPx, topOffset: newPy };
      localStorage.setItem(LS_KEY, JSON.stringify(this.savedPos));

      this.cleanupDrag();
      this.close();
      this.open();
    };

    this.scene.input.on("pointermove", this.dragMoveHandler);
    this.scene.input.on("pointerup",   this.dragUpHandler);
  }

  private cleanupDrag(): void {
    if (this.dragMoveHandler) { this.scene.input.off("pointermove", this.dragMoveHandler); this.dragMoveHandler = null; }
    if (this.dragUpHandler)   { this.scene.input.off("pointerup",   this.dragUpHandler);   this.dragUpHandler   = null; }
    if (this.dragPreview)     { this.dragPreview.destroy(); this.dragPreview = null; }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.cleanupDrag();
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
  }
}
