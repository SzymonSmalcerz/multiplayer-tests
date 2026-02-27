import Phaser from "phaser";

type ItemType = "health_potion";

interface SlotState {
  item: ItemType | null;
}

interface PlayerSnapshot {
  potions: number;
  potionHealRemaining: number;
  hp: number;
  maxHp: number;
}

/**
 * Always-visible 4-slot action bar at the bottom-centre of the screen.
 * Slots are assigned by dragging items from the Equipment panel.
 * Keys 1–4 (handled in GameScene) and right-click consume the item in that slot.
 */
export class ActionBarUI {
  private scene: Phaser.Scene;
  private slots: SlotState[] = [
    { item: null }, { item: null }, { item: null }, { item: null },
  ];

  // Per-slot display objects
  private slotBg:     Phaser.GameObjects.Graphics[]          = [];
  private slotIcons:  Array<Phaser.GameObjects.Image | null> = [null, null, null, null];
  private slotCounts: Phaser.GameObjects.Text[]              = [];
  private slotLabels: Phaser.GameObjects.Text[]              = [];

  // Screen-space bounds for each slot (used by EquipmentUI drag-drop)
  private bounds: Array<{ x: number; y: number; w: number; h: number }> = [];

  private getPlayerState: () => PlayerSnapshot | null;
  private onActivate:     (itemType: ItemType) => void;

  private lastSnapshot: PlayerSnapshot = { potions: 0, potionHealRemaining: 0, hp: 0, maxHp: 100 };

  static readonly SLOT_W  = 60;
  static readonly SLOT_H  = 60;
  static readonly SLOT_GAP = 8;

  constructor(
    scene:          Phaser.Scene,
    getPlayerState: () => PlayerSnapshot | null,
    onActivate:     (itemType: ItemType) => void,
  ) {
    this.scene          = scene;
    this.getPlayerState = getPlayerState;
    this.onActivate     = onActivate;

    // Load from localStorage if available
    const saved = localStorage.getItem("actionBarState");
    if (saved) {
      try {
        const state = JSON.parse(saved);
        if (Array.isArray(state)) {
          for (let i = 0; i < 4; i++) this.slots[i].item = state[i] ?? null;
        }
      } catch (e) { /* ignore */ }
    }
  }

  /** Call once after scene `create()` to build the bar. */
  build(): void {
    const s = this.scene;
    const { width, height } = s.scale;
    const D = 99990;

    const { SLOT_W, SLOT_H, SLOT_GAP } = ActionBarUI;
    const totalW = 4 * SLOT_W + 3 * SLOT_GAP;
    const startX = Math.round((width - totalW) / 2);
    const startY = height - SLOT_H - 14;

    for (let i = 0; i < 4; i++) {
      const cx = startX + i * (SLOT_W + SLOT_GAP);
      const cy = startY;

      this.bounds.push({ x: cx, y: cy, w: SLOT_W, h: SLOT_H });

      // Background + border (redrawn on update)
      const bg = s.add.graphics().setScrollFactor(0).setDepth(D);
      this.slotBg.push(bg);
      this.drawSlotBg(i, false);

      // Key number label (bottom-left)
      this.slotLabels.push(
        s.add.text(cx + 4, cy + SLOT_H - 14, String(i + 1), {
          fontSize: "10px", color: "#887755",
          stroke: "#000", strokeThickness: 2, resolution: 2,
        }).setScrollFactor(0).setDepth(D + 3),
      );

      // Count text (bottom-right, hidden until slot is filled)
      this.slotCounts.push(
        s.add.text(cx + SLOT_W - 4, cy + SLOT_H - 14, "", {
          fontSize: "11px", color: "#ffffff",
          stroke: "#000", strokeThickness: 2, resolution: 2,
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 3).setVisible(false),
      );

      this.slotIcons.push(null);

      // Hit area — handles right-click
      const idx = i;
      const hitArea = s.add.rectangle(cx + SLOT_W / 2, cy + SLOT_H / 2, SLOT_W, SLOT_H, 0, 0)
        .setScrollFactor(0).setDepth(D + 4)
        .setInteractive({ useHandCursor: true });

      hitArea.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
        if (ptr.rightButtonDown()) this.activateSlot(idx);
      });
      hitArea.on("pointerover", () => this.drawSlotBg(idx, true));
      hitArea.on("pointerout",  () => this.drawSlotBg(idx, false));

      // Re-render icon if slot was imported before build()
      if (this.slots[i].item) this.rebuildSlotIcon(i);
    }
  }

  exportState(): any {
    return this.slots.map(s => s.item);
  }

  importState(state: any): void {
    if (!Array.isArray(state)) return;
    for (let i = 0; i < 4; i++) {
      this.slots[i].item = state[i] ?? null;
      // If built, icon will be updated in next update() or build() handles it
      if (this.slotBg.length > 0) this.rebuildSlotIcon(i);
    }
    localStorage.setItem("actionBarState", JSON.stringify(this.exportState()));
  }

  /** Called every frame by GameScene to refresh counts and availability. */
  update(potions: number, potionHealRemaining: number, hp: number, maxHp: number): void {
    this.lastSnapshot = { potions, potionHealRemaining, hp, maxHp };

    for (let i = 0; i < 4; i++) {
      const item = this.slots[i].item;
      if (!item) continue;

      const count    = this.countOf(item);
      const usable   = this.canUse(item);
      const countTxt = this.slotCounts[i];
      const icon     = this.slotIcons[i];

      countTxt.setText(String(count)).setVisible(count > 0);
      if (icon) {
        icon.setVisible(count > 0);
        if (count > 0) icon.setAlpha(usable ? 1 : 0.45);
      }
    }
  }

  /** Assign an item type to a slot (called by EquipmentUI drag-drop). */
  assignSlot(slotIndex: number, itemType: ItemType): void {
    if (slotIndex < 0 || slotIndex >= 4) return;
    this.slots[slotIndex].item = itemType;
    this.rebuildSlotIcon(slotIndex);
    localStorage.setItem("actionBarState", JSON.stringify(this.exportState()));
  }

  /** Returns screen-space bounds of each slot for drag-drop hit-testing. */
  getSlotBounds(): Array<{ x: number; y: number; w: number; h: number }> {
    return this.bounds;
  }

  /** Triggered by keyboard (1–4) from GameScene or right-click on slot. */
  activateSlot(index: number): void {
    const item = this.slots[index]?.item;
    if (!item) return;
    if (!this.canUse(item)) return;
    this.onActivate(item);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private canUse(item: ItemType): boolean {
    const s = this.lastSnapshot;
    if (item === "health_potion") {
      return s.potions > 0
        && s.hp < s.maxHp
        && s.potionHealRemaining < (s.maxHp - s.hp);
    }
    return false;
  }

  private countOf(item: ItemType): number {
    if (item === "health_potion") return this.lastSnapshot.potions;
    return 0;
  }

  private rebuildSlotIcon(slotIndex: number): void {
    const s    = this.scene;
    const item = this.slots[slotIndex].item;
    const D    = 99990;
    const { SLOT_W, SLOT_H, SLOT_GAP } = ActionBarUI;
    const { width, height } = s.scale;
    const totalW = 4 * SLOT_W + 3 * SLOT_GAP;
    const cx = Math.round((width - totalW) / 2) + slotIndex * (SLOT_W + SLOT_GAP);
    const cy = height - SLOT_H - 14;

    // Destroy previous icon
    if (this.slotIcons[slotIndex]) {
      this.slotIcons[slotIndex]!.destroy();
      this.slotIcons[slotIndex] = null;
    }

    if (!item) {
      this.slotCounts[slotIndex].setVisible(false);
      return;
    }

    const texKey  = item; // texture key matches item type
    const MAX_ICO = SLOT_W - 12;
    const icon = s.add.image(cx + SLOT_W / 2, cy + SLOT_H / 2 - 4, texKey)
      .setScrollFactor(0).setDepth(D + 2);
    const sc = Math.min(MAX_ICO / icon.width, MAX_ICO / icon.height);
    icon.setDisplaySize(Math.round(icon.width * sc), Math.round(icon.height * sc));
    this.slotIcons[slotIndex] = icon;
  }

  private drawSlotBg(index: number, hovered: boolean): void {
    const { SLOT_W, SLOT_H, SLOT_GAP } = ActionBarUI;
    const { width, height } = this.scene.scale;
    const totalW = 4 * SLOT_W + 3 * SLOT_GAP;
    const cx = Math.round((width - totalW) / 2) + index * (SLOT_W + SLOT_GAP);
    const cy = height - SLOT_H - 14;

    const borderCol = hovered ? 0xffd770 : 0xc8a84b;
    const bg        = this.slotBg[index];
    bg.clear()
      .fillStyle(0x0a0702, 0.82)
      .fillRect(cx, cy, SLOT_W, SLOT_H)
      .lineStyle(2, borderCol, 1)
      .strokeRect(cx, cy, SLOT_W, SLOT_H)
      // Corner accents
      .lineStyle(1, 0xffd770, 0.6)
      .lineBetween(cx,          cy,          cx + 8,       cy)
      .lineBetween(cx,          cy,          cx,            cy + 8)
      .lineBetween(cx + SLOT_W, cy,          cx + SLOT_W - 8, cy)
      .lineBetween(cx + SLOT_W, cy,          cx + SLOT_W,  cy + 8)
      .lineBetween(cx,          cy + SLOT_H, cx + 8,       cy + SLOT_H)
      .lineBetween(cx,          cy + SLOT_H, cx,            cy + SLOT_H - 8)
      .lineBetween(cx + SLOT_W, cy + SLOT_H, cx + SLOT_W - 8, cy + SLOT_H)
      .lineBetween(cx + SLOT_W, cy + SLOT_H, cx + SLOT_W,  cy + SLOT_H - 8);
  }
}
