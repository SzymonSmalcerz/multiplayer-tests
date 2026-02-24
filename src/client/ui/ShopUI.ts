import Phaser from "phaser";
import { WeaponDef } from "../../shared/weapons";

interface ScrollItem {
  obj: Phaser.GameObjects.Image; // widest concrete type that has setY + setMask
  baseY: number;
}

/**
 * Self-contained shop panel UI.
 * All weapon rows are scene-level objects (NOT inside a Container) so that
 * Phaser's input hit-testing works correctly with scrollFactor(0).
 * A GeometryMask clips items to the visible window; scrolling shifts their y.
 */
export class ShopUI {
  private scene: Phaser.Scene;
  private weapons: WeaponDef[];
  private isOpen = false;

  /** Every Phaser object created by this panel — destroyed in close(). */
  private objects: Phaser.GameObjects.GameObject[] = [];
  /** Subset of objects that participate in scrolling. */
  private scrollItems: ScrollItem[] = [];
  /** Geometry mask applied to each scroll item. */
  private geomMask: Phaser.Display.Masks.GeometryMask | null = null;
  /** Phaser wheel handler — removed in close(). */
  private wheelHandler: ((...args: unknown[]) => void) | null = null;

  private scrollOffset = 0;
  private maxScroll    = 0;
  private scrollThumb: Phaser.GameObjects.Graphics | null = null;
  private scrollThumbCfg: { trackY: number; trackH: number; thumbH: number; thumbW: number; barX: number } | null = null;

  /** Returns current player gold and equipped weapon from live game state. */
  private getPlayerState: () => { gold: number; weapon: string } | null;
  /** Called when the player confirms a purchase. */
  private onBuy: (weaponKey: string) => void;
  /** Called on any interactive click inside the panel (suppresses map click). */
  private onInteract: () => void;

  constructor(
    scene: Phaser.Scene,
    weapons: WeaponDef[],
    getPlayerState: () => { gold: number; weapon: string } | null,
    onBuy: (weaponKey: string) => void,
    onInteract: () => void,
  ) {
    this.scene          = scene;
    this.weapons        = weapons;
    this.getPlayerState = getPlayerState;
    this.onBuy          = onBuy;
    this.onInteract     = onInteract;
  }

  get isShopOpen(): boolean { return this.isOpen; }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  open(): void {
    if (this.isOpen) { this.close(); return; }
    this.isOpen = true;

    const s = this.scene;
    const { width, height } = s.scale;

    // Sort cheapest first
    const weapons = [...this.weapons].sort((a, b) => a.cost - b.cost);

    const ITEM_H      = 120;
    const PANEL_W     = 320;
    const HEADER_H    = 40;
    const PADDING_B   = 10;
    const SCROLLBAR_W = 12;

    const MAX_PANEL_H   = Math.min(height - 80, 600);
    const totalH        = weapons.length * ITEM_H;
    const panelH        = Math.min(HEADER_H + totalH + PADDING_B, MAX_PANEL_H);
    const visibleH      = panelH - HEADER_H - PADDING_B;
    const isScrollable  = totalH > visibleH;

    const px  = Math.round((width  - PANEL_W) / 2);
    const py  = Math.round((height - panelH)  / 2);
    const D   = 200000;
    const scrollY = py + HEADER_H;   // top of the scrollable content area

    this.scrollOffset = 0;
    this.maxScroll    = isScrollable ? totalH - visibleH : 0;
    this.scrollItems  = [];

    // ── helpers ──────────────────────────────────────────────────────────────

    /** Track a scene-level (non-scrolling) object. */
    const add = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };

    /**
     * Track a scrolling item.
     * baseY is the absolute screen Y the object sits at when scrollOffset = 0.
     * The object's x must already be set correctly before calling this.
     */
    const addS = <T extends Phaser.GameObjects.Image>(obj: T, baseY: number): T => {
      this.objects.push(obj);
      if (this.geomMask) obj.setMask(this.geomMask);
      this.scrollItems.push({ obj, baseY });
      obj.setY(baseY);
      return obj;
    };

    // ── Panel background ─────────────────────────────────────────────────────
    add(s.add.graphics())
      .fillStyle(0x111111, 0.93)
      .fillRoundedRect(px, py, PANEL_W, panelH, 8)
      .lineStyle(2, 0x998844, 1)
      .strokeRoundedRect(px, py, PANEL_W, panelH, 8)
      .setScrollFactor(0).setDepth(D);

    // ── Title ────────────────────────────────────────────────────────────────
    add(s.add.text(px + PANEL_W / 2, py + 16, "Trader's Shop", {
      fontSize: "16px", color: "#ffd700",
      stroke: "#000000", strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 1));

    // ── Close button ─────────────────────────────────────────────────────────
    const closeBtn = add(s.add.text(px + PANEL_W - 10, py + 10, "×", {
      fontSize: "22px", color: "#ffffff",
      stroke: "#000000", strokeThickness: 2, resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 1)
      .setInteractive({ useHandCursor: true })) as Phaser.GameObjects.Text;
    closeBtn.on("pointerover", () => closeBtn.setColor("#ff4444"));
    closeBtn.on("pointerout",  () => closeBtn.setColor("#ffffff"));
    closeBtn.on("pointerdown", () => { this.onInteract(); this.close(); });

    // ── Divider ──────────────────────────────────────────────────────────────
    add(s.add.graphics())
      .lineStyle(1, 0x665533, 1)
      .lineBetween(px + 10, py + 30, px + PANEL_W - 10, py + 30)
      .setScrollFactor(0).setDepth(D + 1);

    // ── Geometry mask (set before addS calls so items get masked immediately) ─
    const maskW   = PANEL_W - (isScrollable ? SCROLLBAR_W + 8 : 8);
    const maskGfx = add(s.add.graphics()
      .fillStyle(0xffffff, 1)
      .fillRect(px + 4, scrollY, maskW, visibleH)
      .setScrollFactor(0).setDepth(D - 1)
      .setVisible(false));
    this.geomMask = (maskGfx as Phaser.GameObjects.Graphics).createGeometryMask();

    // ── Weapon rows ──────────────────────────────────────────────────────────
    const playerState   = this.getPlayerState();
    const playerGold    = playerState?.gold   ?? 0;
    const currentWeapon = playerState?.weapon ?? "sword";
    const rowInnerW     = PANEL_W - (isScrollable ? SCROLLBAR_W + 8 : 16);

    weapons.forEach((item, i) => {
      const rowBase   = scrollY + i * ITEM_H;   // y of row top at scroll=0
      const canAfford = playerGold >= item.cost;
      const equipped  = currentWeapon === item.type;

      // Row background (Graphics: draw commands offset by gfx.y)
      addS(s.add.graphics().setScrollFactor(0).setDepth(D + 1)
        .fillStyle(0x1a1a0d, 0.7)
        .fillRect(px + 8, 2, rowInnerW, ITEM_H - 8) as unknown as Phaser.GameObjects.Image,
        rowBase);

      // Weapon image (origin 0.5,0.5 → pass absolute centre y)
      addS(s.add.image(px + 44, 0, item.type)
        .setScrollFactor(0).setDepth(D + 2),
        rowBase + ITEM_H / 2 - 4);

      // Weapon name
      addS(s.add.text(px + 84, 0, item.label, {
        fontSize: "14px", color: "#ffdd88",
        stroke: "#000000", strokeThickness: 2, resolution: 2,
      }).setScrollFactor(0).setDepth(D + 2) as unknown as Phaser.GameObjects.Image,
        rowBase + 16);

      // Damage
      addS(s.add.text(px + 84, 0, `Damage: ${item.damage}`, {
        fontSize: "12px", color: "#ff9988",
        stroke: "#000000", strokeThickness: 2, resolution: 2,
      }).setScrollFactor(0).setDepth(D + 2) as unknown as Phaser.GameObjects.Image,
        rowBase + 38);

      // Cost
      addS(s.add.text(px + 84, 0, `Cost: ${item.cost} gold`, {
        fontSize: "12px", color: "#ffd700",
        stroke: "#000000", strokeThickness: 2, resolution: 2,
      }).setScrollFactor(0).setDepth(D + 2) as unknown as Phaser.GameObjects.Image,
        rowBase + 57);

      // Buy / Equipped
      const btnX    = px + rowInnerW + 4;
      const btnRelY = ITEM_H / 2 + 10;

      if (equipped) {
        addS(s.add.text(btnX, 0, "Equipped", {
          fontSize: "12px", color: "#44ff44",
          stroke: "#000000", strokeThickness: 2, resolution: 2,
        }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(D + 2) as unknown as Phaser.GameObjects.Image,
          rowBase + btnRelY);
      } else {
        const bgColor  = canAfford ? "#336633" : "#333333";
        const txtColor = canAfford ? "#ffffff"  : "#666666";

        const buyBtn = addS(s.add.text(btnX, 0, "Buy", {
          fontSize: "13px", color: txtColor, backgroundColor: bgColor,
          padding: { x: 16, y: 7 },
          stroke: "#000000", strokeThickness: 1, resolution: 2,
        }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(D + 2) as unknown as Phaser.GameObjects.Image,
          rowBase + btnRelY);

        if (canAfford) {
          (buyBtn as unknown as Phaser.GameObjects.Text)
            .setInteractive({ useHandCursor: true })
            .on("pointerover", () => {
              if (buyBtn.y < scrollY || buyBtn.y > scrollY + visibleH) return;
              (buyBtn as unknown as Phaser.GameObjects.Text).setBackgroundColor("#448844");
            })
            .on("pointerout", () =>
              (buyBtn as unknown as Phaser.GameObjects.Text).setBackgroundColor(bgColor))
            .on("pointerdown", () => {
              if (buyBtn.y < scrollY || buyBtn.y > scrollY + visibleH) return;
              this.onInteract();
              this.onBuy(item.type);
              this.close();
            });
        }
      }

      // Row divider (between rows)
      if (i < weapons.length - 1) {
        addS(s.add.graphics().setScrollFactor(0).setDepth(D + 1)
          .lineStyle(1, 0x443322, 0.7)
          .lineBetween(px + 8, ITEM_H - 4, px + rowInnerW + 4, ITEM_H - 4) as unknown as Phaser.GameObjects.Image,
          rowBase);
      }
    });

    // ── Scrollbar ────────────────────────────────────────────────────────────
    if (isScrollable) {
      const barX      = px + PANEL_W - SCROLLBAR_W - 2;
      const trackY    = scrollY + 4;
      const trackH    = visibleH - 8;
      const thumbW    = SCROLLBAR_W - 2;
      const thumbH    = Math.max(28, Math.round(trackH * visibleH / totalH));

      // Track
      add(s.add.graphics()
        .fillStyle(0x222222, 0.8)
        .fillRoundedRect(barX, trackY, thumbW, trackH, 3)
        .setScrollFactor(0).setDepth(D + 2));

      // Thumb (redrawn each scroll)
      this.scrollThumb    = add(s.add.graphics().setScrollFactor(0).setDepth(D + 3)) as Phaser.GameObjects.Graphics;
      this.scrollThumbCfg = { trackY, trackH, thumbH, thumbW, barX };
      this.redrawThumb();

      // Fixed 60 px step per wheel notch — works regardless of browser delta mode
      this.wheelHandler = (_ptr: unknown, _gos: unknown, _dx: unknown, dy: unknown) => {
        const step        = Math.sign(dy as number) * 60;
        this.scrollOffset = Math.max(0, Math.min(this.maxScroll, this.scrollOffset + step));
        this.applyScroll();
        this.redrawThumb();
      };
      s.input.on("wheel", this.wheelHandler);
    }
  }

  private applyScroll(): void {
    for (const { obj, baseY } of this.scrollItems) {
      obj.setY(baseY - this.scrollOffset);
    }
  }

  private redrawThumb(): void {
    if (!this.scrollThumb || !this.scrollThumbCfg) return;
    const { trackY, trackH, thumbH, thumbW, barX } = this.scrollThumbCfg;
    this.scrollThumb.clear();
    const ratio  = this.maxScroll > 0 ? this.scrollOffset / this.maxScroll : 0;
    const thumbY = trackY + Math.round(ratio * (trackH - thumbH));
    this.scrollThumb.fillStyle(0x998844, 0.9).fillRoundedRect(barX, thumbY, thumbW, thumbH, 3);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    if (this.wheelHandler) {
      this.scene.input.off("wheel", this.wheelHandler);
      this.wheelHandler = null;
    }
    if (this.geomMask) {
      this.geomMask.destroy();
      this.geomMask = null;
    }
    for (const obj of this.objects) obj.destroy();
    this.objects        = [];
    this.scrollItems    = [];
    this.scrollThumb    = null;
    this.scrollThumbCfg = null;
    this.scrollOffset   = 0;
    this.maxScroll      = 0;
  }
}
