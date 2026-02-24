import Phaser from "phaser";
import { WeaponDef } from "../../shared/weapons";

/**
 * Self-contained equipment panel UI.
 * Upper section: eq_background.png with an overlay weapon slot.
 * Lower section: 3×3 inventory grid (empty for now).
 * All objects are scene-level (no Container) so scrollFactor(0) input works correctly.
 */
export class EquipmentUI {
  private scene: Phaser.Scene;
  private weaponsRegistry: Record<string, WeaponDef>;
  private isOpen = false;

  private objects: Phaser.GameObjects.GameObject[] = [];
  private tooltipObjects: Phaser.GameObjects.GameObject[] = [];

  private getPlayerState: () => { weapon: string } | null;
  private onInteract: () => void;

  constructor(
    scene: Phaser.Scene,
    weaponsRegistry: Record<string, WeaponDef>,
    getPlayerState: () => { weapon: string } | null,
    onInteract: () => void,
  ) {
    this.scene          = scene;
    this.weaponsRegistry = weaponsRegistry;
    this.getPlayerState  = getPlayerState;
    this.onInteract      = onInteract;
  }

  get isEquipmentOpen(): boolean { return this.isOpen; }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  open(): void {
    if (this.isOpen) { this.close(); return; }
    this.isOpen = true;

    const s = this.scene;
    const { width, height } = s.scale;
    const D = 200000;

    // ── Layout constants ─────────────────────────────────────────────────────
    const PANEL_W    = 300;
    const HEADER_H   = 38;
    const BG_H       = 200;   // eq_background section height
    const DIV_GAP    = 6;
    const INV_LBL_H  = 26;
    const CELL       = 60;
    const CELL_GAP   = 8;
    const GRID_ROWS  = 3;
    const GRID_COLS  = 3;
    const GRID_H     = GRID_ROWS * CELL + (GRID_ROWS - 1) * CELL_GAP;
    const BOT_PAD    = 14;
    const PANEL_H    = HEADER_H + BG_H + DIV_GAP + INV_LBL_H + GRID_H + BOT_PAD;

    const px = Math.round((width  - PANEL_W) / 2);
    const py = Math.round((height - PANEL_H) / 2);

    const add = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };

    // ── Panel shadow ──────────────────────────────────────────────────────────
    add(s.add.graphics()
      .fillStyle(0x000000, 0.45)
      .fillRoundedRect(px + 6, py + 6, PANEL_W, PANEL_H, 10)
      .setScrollFactor(0).setDepth(D - 1));

    // ── Panel background ──────────────────────────────────────────────────────
    add(s.add.graphics()
      .fillStyle(0x1a1005, 0.97)
      .fillRoundedRect(px, py, PANEL_W, PANEL_H, 10)
      .lineStyle(2, 0xc8a84b, 1)
      .strokeRoundedRect(px, py, PANEL_W, PANEL_H, 10)
      .setScrollFactor(0).setDepth(D));

    // Inner decorative border
    add(s.add.graphics()
      .lineStyle(1, 0x7a5c1e, 0.45)
      .strokeRoundedRect(px + 5, py + 5, PANEL_W - 10, PANEL_H - 10, 7)
      .setScrollFactor(0).setDepth(D + 1));

    // ── Title ─────────────────────────────────────────────────────────────────
    add(s.add.text(px + PANEL_W / 2, py + HEADER_H / 2, "✦  Equipment  ✦", {
      fontSize: "16px", color: "#e8c96a",
      stroke: "#1a0e00", strokeThickness: 4, resolution: 2,
      fontStyle: "bold",
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2));

    // ── Close button ──────────────────────────────────────────────────────────
    const closeBtn = add(s.add.text(px + PANEL_W - 12, py + 10, "✕", {
      fontSize: "18px", color: "#c8a84b",
      stroke: "#000", strokeThickness: 2, resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 2)
      .setInteractive({ useHandCursor: true })) as Phaser.GameObjects.Text;
    closeBtn.on("pointerover", () => closeBtn.setColor("#ff6644"));
    closeBtn.on("pointerout",  () => closeBtn.setColor("#c8a84b"));
    closeBtn.on("pointerdown", () => { this.onInteract(); this.close(); });

    // Header divider
    add(s.add.graphics()
      .lineStyle(1, 0x7a5c1e, 0.9)
      .lineBetween(px + 10, py + HEADER_H, px + PANEL_W - 10, py + HEADER_H)
      .setScrollFactor(0).setDepth(D + 1));

    // ── eq_background section ─────────────────────────────────────────────────
    const bgTop = py + HEADER_H;

    // Dark inset behind background image
    add(s.add.graphics()
      .fillStyle(0x0d0a04, 0.9)
      .fillRect(px + 6, bgTop + 4, PANEL_W - 12, BG_H - 8)
      .setScrollFactor(0).setDepth(D + 1));

    if (s.textures.exists("eq_background")) {
      const bgImg = s.add.image(px + PANEL_W / 2, bgTop + BG_H / 2, "eq_background");
      bgImg.setScrollFactor(0).setDepth(D + 2);
      const scale = Math.min((PANEL_W - 16) / bgImg.width, (BG_H - 16) / bgImg.height);
      bgImg.setDisplaySize(Math.round(bgImg.width * scale), Math.round(bgImg.height * scale));
      add(bgImg);
    }

    // ── Weapon slot ───────────────────────────────────────────────────────────
    const SLOT  = 54;
    const slotX = px + PANEL_W - SLOT - 16;
    const slotY = bgTop + Math.round((BG_H - SLOT) / 2);

    // Slot backing
    add(s.add.graphics()
      .fillStyle(0x0a0702, 0.88)
      .fillRect(slotX, slotY, SLOT, SLOT)
      .lineStyle(2, 0xc8a84b, 1)
      .strokeRect(slotX, slotY, SLOT, SLOT)
      // Corner accent lines
      .lineStyle(1, 0xffd770, 0.8)
      .lineBetween(slotX,        slotY,        slotX + 10,  slotY)
      .lineBetween(slotX,        slotY,        slotX,        slotY + 10)
      .lineBetween(slotX + SLOT, slotY,        slotX + SLOT - 10, slotY)
      .lineBetween(slotX + SLOT, slotY,        slotX + SLOT, slotY + 10)
      .lineBetween(slotX,        slotY + SLOT, slotX + 10,  slotY + SLOT)
      .lineBetween(slotX,        slotY + SLOT, slotX,        slotY + SLOT - 10)
      .lineBetween(slotX + SLOT, slotY + SLOT, slotX + SLOT - 10, slotY + SLOT)
      .lineBetween(slotX + SLOT, slotY + SLOT, slotX + SLOT, slotY + SLOT - 10)
      .setScrollFactor(0).setDepth(D + 3));

    // "Weapon" label above slot
    add(s.add.text(slotX + SLOT / 2, slotY - 11, "Weapon", {
      fontSize: "10px", color: "#9a8040",
      stroke: "#0d0a00", strokeThickness: 2, resolution: 2,
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 3));

    // Weapon icon
    const playerState = this.getPlayerState();
    const weaponKey   = playerState?.weapon ?? "sword";
    const weaponDef   = this.weaponsRegistry[weaponKey];

    const MAX_ICON  = SLOT - 10;
    const weaponIcon = s.add.image(slotX + SLOT / 2, slotY + SLOT / 2, weaponKey);
    weaponIcon.setScrollFactor(0).setDepth(D + 4);
    const iconScale = Math.min(MAX_ICON / weaponIcon.width, MAX_ICON / weaponIcon.height);
    weaponIcon.setDisplaySize(
      Math.round(weaponIcon.width  * iconScale),
      Math.round(weaponIcon.height * iconScale),
    );
    add(weaponIcon);

    // Hover hit area for tooltip
    const slotHit = s.add.rectangle(
      slotX + SLOT / 2, slotY + SLOT / 2, SLOT, SLOT, 0, 0,
    ).setScrollFactor(0).setDepth(D + 5).setInteractive({ useHandCursor: false });
    add(slotHit);

    slotHit.on("pointerover", () => {
      weaponIcon.setTint(0xffd88a);
      this.showTooltip(slotX, slotY, SLOT, weaponKey, weaponDef, D + 6);
    });
    slotHit.on("pointerout", () => {
      weaponIcon.clearTint();
      this.hideTooltip();
    });
    slotHit.on("pointerdown", () => { this.onInteract(); });

    // ── Section divider ───────────────────────────────────────────────────────
    const invY = bgTop + BG_H + DIV_GAP / 2;
    add(s.add.graphics()
      .lineStyle(1, 0x7a5c1e, 0.9)
      .lineBetween(px + 10, invY, px + PANEL_W - 10, invY)
      .setScrollFactor(0).setDepth(D + 1));

    // ── Inventory label ───────────────────────────────────────────────────────
    add(s.add.text(px + PANEL_W / 2, invY + INV_LBL_H / 2, "Inventory", {
      fontSize: "13px", color: "#c8a84b",
      stroke: "#1a0e00", strokeThickness: 3, resolution: 2,
      fontStyle: "bold",
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2));

    // ── 3×3 inventory grid ────────────────────────────────────────────────────
    const gridTop  = invY + INV_LBL_H;
    const totalW   = GRID_COLS * CELL + (GRID_COLS - 1) * CELL_GAP;
    const gridLeft = px + Math.round((PANEL_W - totalW) / 2);

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const cx = gridLeft + col * (CELL + CELL_GAP);
        const cy = gridTop  + row * (CELL + CELL_GAP);

        add(s.add.graphics()
          .fillStyle(0x0a0702, 0.72)
          .fillRect(cx, cy, CELL, CELL)
          .lineStyle(1, 0x7a5c1e, 0.85)
          .strokeRect(cx, cy, CELL, CELL)
          // Corner dots
          .fillStyle(0xc8a84b, 0.45)
          .fillRect(cx,              cy,              3, 3)
          .fillRect(cx + CELL - 3,   cy,              3, 3)
          .fillRect(cx,              cy + CELL - 3,   3, 3)
          .fillRect(cx + CELL - 3,   cy + CELL - 3,   3, 3)
          .setScrollFactor(0).setDepth(D + 2));
      }
    }
  }

  private showTooltip(
    slotX: number, slotY: number, slotSize: number,
    weaponKey: string, weaponDef: WeaponDef | undefined,
    depth: number,
  ): void {
    this.hideTooltip();
    const s = this.scene;

    const name   = weaponDef?.label    ?? weaponKey;
    const damage = weaponDef?.damage   ?? "?";
    const range  = weaponDef?.hitRadius ?? "?";

    const TIP_W = 148;
    const TIP_H = 66;
    // Position tooltip to the left of the weapon slot
    const tipX = slotX - TIP_W - 10;
    const tipY = slotY + Math.round((slotSize - TIP_H) / 2);

    const addT = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.tooltipObjects.push(obj);
      return obj;
    };

    addT(s.add.graphics()
      .fillStyle(0x1a1005, 0.97)
      .fillRoundedRect(tipX, tipY, TIP_W, TIP_H, 6)
      .lineStyle(1, 0xc8a84b, 0.9)
      .strokeRoundedRect(tipX, tipY, TIP_W, TIP_H, 6)
      .setScrollFactor(0).setDepth(depth));

    const lines: Array<{ text: string; color: string; size: string }> = [
      { text: name,               color: "#e8c96a", size: "13px" },
      { text: `Damage: ${damage}`, color: "#ff9977", size: "11px" },
      { text: `Range: ${range}`,  color: "#88ccff", size: "11px" },
    ];

    lines.forEach(({ text, color, size }, i) => {
      addT(s.add.text(tipX + 10, tipY + 8 + i * 19, text, {
        fontSize: size, color, resolution: 2,
        stroke: "#000", strokeThickness: 1,
      }).setScrollFactor(0).setDepth(depth + 1));
    });
  }

  private hideTooltip(): void {
    for (const obj of this.tooltipObjects) obj.destroy();
    this.tooltipObjects = [];
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.hideTooltip();
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
  }
}
