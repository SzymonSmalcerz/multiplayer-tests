import Phaser from "phaser";
import { WeaponDef } from "../../shared/weapons";

/**
 * Self-contained shop panel UI.
 * Owns its open/close state and destroys all Phaser objects on close.
 */
export class ShopUI {
  private scene: Phaser.Scene;
  private weapons: WeaponDef[];
  private isOpen = false;
  private objects: Phaser.GameObjects.GameObject[] = [];

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
    const ITEM_H   = 120;
    const PANEL_W  = 320;
    const PANEL_H  = 50 + this.weapons.length * ITEM_H;
    const px       = Math.round((width  - PANEL_W) / 2);
    const py       = Math.round((height - PANEL_H) / 2);
    const D        = 200000;

    const add = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };

    // Background panel
    add(s.add.graphics())
      .fillStyle(0x111111, 0.93)
      .fillRoundedRect(px, py, PANEL_W, PANEL_H, 8)
      .lineStyle(2, 0x998844, 1)
      .strokeRoundedRect(px, py, PANEL_W, PANEL_H, 8)
      .setScrollFactor(0).setDepth(D);

    // Title
    add(s.add.text(px + PANEL_W / 2, py + 16, "Trader's Shop", {
      fontSize: "16px", color: "#ffd700",
      stroke: "#000000", strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 1));

    // Close button
    const closeBtn = add(s.add.text(px + PANEL_W - 10, py + 10, "×", {
      fontSize: "22px", color: "#ffffff",
      stroke: "#000000", strokeThickness: 2, resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 1)
      .setInteractive({ useHandCursor: true })) as Phaser.GameObjects.Text;

    closeBtn.on("pointerover", () => closeBtn.setColor("#ff4444"));
    closeBtn.on("pointerout",  () => closeBtn.setColor("#ffffff"));
    closeBtn.on("pointerdown", () => { this.onInteract(); this.close(); });

    // Title divider
    add(s.add.graphics())
      .lineStyle(1, 0x665533, 1)
      .lineBetween(px + 10, py + 30, px + PANEL_W - 10, py + 30)
      .setScrollFactor(0).setDepth(D + 1);

    const playerState   = this.getPlayerState();
    const playerGold    = playerState?.gold   ?? 0;
    const currentWeapon = playerState?.weapon ?? "sword";

    this.weapons.forEach((item, i) => {
      const rowY      = py + 38 + i * ITEM_H;
      const canAfford = playerGold >= item.cost;
      const equipped  = currentWeapon === item.type;

      // Row background
      add(s.add.graphics())
        .fillStyle(0x1a1a0d, 0.7)
        .fillRect(px + 8, rowY + 2, PANEL_W - 16, ITEM_H - 8)
        .setScrollFactor(0).setDepth(D + 1);

      // Weapon display image (single texture, same key used everywhere — natural size)
      add(s.add.image(px + 44, rowY + ITEM_H / 2 - 4, item.type)
        .setScrollFactor(0).setDepth(D + 2));

      // Weapon name
      add(s.add.text(px + 84, rowY + 16, item.label, {
        fontSize: "14px", color: "#ffdd88",
        stroke: "#000000", strokeThickness: 2, resolution: 2,
      }).setScrollFactor(0).setDepth(D + 2));

      // Damage
      add(s.add.text(px + 84, rowY + 38, `Damage: ${item.damage}`, {
        fontSize: "12px", color: "#ff9988",
        stroke: "#000000", strokeThickness: 2, resolution: 2,
      }).setScrollFactor(0).setDepth(D + 2));

      // Cost
      add(s.add.text(px + 84, rowY + 57, `Cost: ${item.cost} gold`, {
        fontSize: "12px", color: "#ffd700",
        stroke: "#000000", strokeThickness: 2, resolution: 2,
      }).setScrollFactor(0).setDepth(D + 2));

      // Buy / Equipped label
      if (equipped) {
        add(s.add.text(px + PANEL_W - 16, rowY + ITEM_H / 2 + 10, "Equipped", {
          fontSize: "12px", color: "#44ff44",
          stroke: "#000000", strokeThickness: 2, resolution: 2,
        }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(D + 2));
      } else {
        const bgColor  = canAfford ? "#336633" : "#333333";
        const txtColor = canAfford ? "#ffffff"  : "#666666";
        const buyBtn   = add(s.add.text(
          px + PANEL_W - 16, rowY + ITEM_H / 2 + 10, "Buy",
          {
            fontSize: "13px", color: txtColor, backgroundColor: bgColor,
            padding: { x: 16, y: 7 },
            stroke: "#000000", strokeThickness: 1, resolution: 2,
          },
        ).setOrigin(1, 0.5).setScrollFactor(0).setDepth(D + 2)) as Phaser.GameObjects.Text;

        if (canAfford) {
          buyBtn.setInteractive({ useHandCursor: true });
          buyBtn.on("pointerover", () => buyBtn.setBackgroundColor("#448844"));
          buyBtn.on("pointerout",  () => buyBtn.setBackgroundColor("#336633"));
          buyBtn.on("pointerdown", () => {
            this.onInteract();
            this.onBuy(item.type);
            this.close();
          });
        }
      }

      // Row divider (between items)
      if (i < this.weapons.length - 1) {
        add(s.add.graphics())
          .lineStyle(1, 0x443322, 0.7)
          .lineBetween(px + 10, rowY + ITEM_H - 4, px + PANEL_W - 10, rowY + ITEM_H - 4)
          .setScrollFactor(0).setDepth(D + 1);
      }
    });
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
  }
}
