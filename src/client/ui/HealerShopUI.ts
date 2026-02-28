import Phaser from "phaser";

/**
 * Self-contained shop panel for the Healer NPC.
 * Sells a single item: Health Potion (20 gold each).
 */
export class HealerShopUI {
  private scene: Phaser.Scene;
  private isOpen = false;
  private objects: Phaser.GameObjects.GameObject[] = [];

  private ownedText: Phaser.GameObjects.Text | null = null;
  private buyBtn:    Phaser.GameObjects.Text | null = null;
  private localGold    = 0;
  private localPotions = 0;

  private getPlayerState: () => { gold: number; potions: number } | null;
  private onBuy:      () => void;
  private onInteract: () => void;

  constructor(
    scene: Phaser.Scene,
    getPlayerState: () => { gold: number; potions: number } | null,
    onBuy:      () => void,
    onInteract: () => void,
  ) {
    this.scene          = scene;
    this.getPlayerState = getPlayerState;
    this.onBuy          = onBuy;
    this.onInteract     = onInteract;
  }

  get isHealerShopOpen(): boolean { return this.isOpen; }

  toggle(): void { this.isOpen ? this.close() : this.open(); }

  open(): void {
    if (this.isOpen) { this.close(); return; }
    this.isOpen = true;

    const s = this.scene;
    const { width, height } = s.scale;
    const D = 200000;

    const PANEL_W = 280;
    const PANEL_H = 200;
    const px = Math.round((width  - PANEL_W) / 2);
    const py = Math.round((height - PANEL_H) / 2);

    const add = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };

    // ── Shadow ────────────────────────────────────────────────────────────────
    add(s.add.graphics()
      .fillStyle(0x000000, 0.4)
      .fillRoundedRect(px + 6, py + 6, PANEL_W, PANEL_H, 10)
      .setScrollFactor(0).setDepth(D - 1));

    // ── Panel ─────────────────────────────────────────────────────────────────
    add(s.add.graphics()
      .fillStyle(0x1a1005, 0.97)
      .fillRoundedRect(px, py, PANEL_W, PANEL_H, 10)
      .lineStyle(2, 0x88ffcc, 0.8)
      .strokeRoundedRect(px, py, PANEL_W, PANEL_H, 10)
      .setScrollFactor(0).setDepth(D));

    add(s.add.graphics()
      .lineStyle(1, 0x3a7a5a, 0.4)
      .strokeRoundedRect(px + 5, py + 5, PANEL_W - 10, PANEL_H - 10, 7)
      .setScrollFactor(0).setDepth(D + 1));

    // ── Title ─────────────────────────────────────────────────────────────────
    add(s.add.text(px + PANEL_W / 2, py + 20, "✦  Healer's Shop  ✦", {
      fontSize: "15px", color: "#88ffcc",
      stroke: "#0a1a10", strokeThickness: 4, resolution: 2, fontStyle: "bold",
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2));

    // ── Close ─────────────────────────────────────────────────────────────────
    const closeBtn = add(s.add.text(px + PANEL_W - 12, py + 10, "✕", {
      fontSize: "18px", color: "#88ffcc",
      stroke: "#000", strokeThickness: 2, resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 2)
      .setInteractive({ useHandCursor: true })) as Phaser.GameObjects.Text;
    closeBtn.on("pointerover", () => closeBtn.setColor("#ff6644"));
    closeBtn.on("pointerout",  () => closeBtn.setColor("#88ffcc"));
    closeBtn.on("pointerdown", () => { this.onInteract(); this.close(); });

    // Header divider
    add(s.add.graphics()
      .lineStyle(1, 0x3a7a5a, 0.9)
      .lineBetween(px + 10, py + 36, px + PANEL_W - 10, py + 36)
      .setScrollFactor(0).setDepth(D + 1));

    // ── Potion row ────────────────────────────────────────────────────────────
    const rowY  = py + 50;
    const state = this.getPlayerState();
    this.localGold    = state?.gold    ?? 0;
    this.localPotions = state?.potions ?? 0;
    const gold  = this.localGold;
    const owned = this.localPotions;

    // Potion icon
    const icon = s.add.image(px + 44, rowY + 44, "health_potion");
    icon.setScrollFactor(0).setDepth(D + 2);
    const iconScale = Math.min(52 / icon.width, 52 / icon.height);
    icon.setDisplaySize(Math.round(icon.width * iconScale), Math.round(icon.height * iconScale));
    add(icon);

    // Name
    add(s.add.text(px + 82, rowY + 10, "Health Potion", {
      fontSize: "14px", color: "#e8c96a",
      stroke: "#000", strokeThickness: 2, resolution: 2,
    }).setScrollFactor(0).setDepth(D + 2));

    // Description
    add(s.add.text(px + 82, rowY + 30, "Heals 30% of HP", {
      fontSize: "11px", color: "#88ffcc",
      stroke: "#000", strokeThickness: 1, resolution: 2,
    }).setScrollFactor(0).setDepth(D + 2));

    // Cost
    add(s.add.text(px + 82, rowY + 48, `Cost: 20 gold`, {
      fontSize: "11px", color: "#ffd700",
      stroke: "#000", strokeThickness: 1, resolution: 2,
    }).setScrollFactor(0).setDepth(D + 2));

    // Owned
    this.ownedText = add(s.add.text(px + 82, rowY + 64, `Owned: ${owned}`, {
      fontSize: "11px", color: "#aaaaaa",
      stroke: "#000", strokeThickness: 1, resolution: 2,
    }).setScrollFactor(0).setDepth(D + 2)) as Phaser.GameObjects.Text;

    // Buy button
    const canAfford = gold >= 20;
    this.buyBtn = add(s.add.text(px + PANEL_W - 16, rowY + 44, "Buy", {
      fontSize: "13px",
      color:           canAfford ? "#ffffff" : "#666666",
      backgroundColor: canAfford ? "#336633" : "#333333",
      padding: { x: 16, y: 7 },
      stroke: "#000", strokeThickness: 1, resolution: 2,
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(D + 2)) as Phaser.GameObjects.Text;

    if (canAfford) {
      this.buyBtn.setInteractive({ useHandCursor: true })
        .on("pointerover", () => this.buyBtn?.setBackgroundColor("#448844"))
        .on("pointerout",  () => this.buyBtn?.setBackgroundColor("#336633"))
        .on("pointerdown", () => {
          this.onInteract();
          this.onBuy();
          this.localPotions++;
          this.localGold -= 20;
          this.ownedText?.setText(`Owned: ${this.localPotions}`);
          if (this.localGold < 20) {
            this.buyBtn?.removeInteractive();
            this.buyBtn?.setColor("#666666").setBackgroundColor("#333333");
          }
        });
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    for (const obj of this.objects) obj.destroy();
    this.objects   = [];
    this.ownedText = null;
    this.buyBtn    = null;
  }
}
