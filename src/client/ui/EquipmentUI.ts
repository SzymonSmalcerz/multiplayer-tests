import Phaser from "phaser";
import { WeaponDef } from "../../shared/weapons";
import { ActionBarUI } from "./ActionBarUI";

interface PlayerSnapshot {
  weapon: string;
  potions: number;
  potionHealRemaining: number;
  hp: number;
  maxHp: number;
}

interface SavedPos { rightOffset: number; topOffset: number; }

/**
 * Self-contained equipment panel UI.
 * Upper section: eq_background.png with an overlay weapon slot.
 * Lower section: 3×3 inventory grid — cell (0,0) holds Health Potions.
 *   Right-click potion cell → consume one potion.
 *   Left-drag potion cell  → assign to action bar slot.
 */
export class EquipmentUI {
  private scene: Phaser.Scene;
  private weaponsRegistry: Record<string, WeaponDef>;
  private actionBarUI: ActionBarUI;
  private isOpen = false;

  private objects: Phaser.GameObjects.GameObject[]        = [];
  private tooltipObjects: Phaser.GameObjects.GameObject[] = [];

  // Inventory state: 3x3 grid (9 slots). null means empty.
  private inventory: Array<string | null> = [
    "health_potion", null, null,
    null, null, null,
    null, null, null
  ];
  // Screen-space bounds for each inventory cell (for drag-drop)
  private gridBounds: Array<{ x: number; y: number; w: number; h: number }> = [];

  // Live-updatable potion display (null when panel is closed or no potions)
  private potionCountText:   Phaser.GameObjects.Text  | null = null;
  private potionIconObj:     Phaser.GameObjects.Image | null = null;
  // Tracked separately so the whole cell can be destroyed when count hits 0
  private potionCellObjects: Phaser.GameObjects.GameObject[] = [];

  // Item drag state (inventory → action bar)
  private dragGhost:        Phaser.GameObjects.Image | null = null;
  private dragSourceIdx:    number | null = null;
  private dragMoveHandler:  ((ptr: Phaser.Input.Pointer) => void) | null = null;
  private dragUpHandler:    ((ptr: Phaser.Input.Pointer) => void) | null = null;

  // Panel drag-to-reposition state
  private static readonly LS_KEY = "equipment_pos";
  private savedPos:              SavedPos | null                              = null;
  private panelDragPreview:      Phaser.GameObjects.Graphics | null          = null;
  private panelDragMoveHandler:  ((ptr: Phaser.Input.Pointer) => void) | null = null;
  private panelDragUpHandler:    ((ptr: Phaser.Input.Pointer) => void) | null = null;

  private getPlayerState: () => PlayerSnapshot | null;
  private onUsePotion:    () => void;
  private onInteract:     () => void;

  constructor(
    scene:          Phaser.Scene,
    weaponsRegistry: Record<string, WeaponDef>,
    getPlayerState:  () => PlayerSnapshot | null,
    onUsePotion:     () => void,
    onInteract:      () => void,
    actionBarUI:     ActionBarUI,
  ) {
    this.scene           = scene;
    this.weaponsRegistry = weaponsRegistry;
    this.getPlayerState  = getPlayerState;
    this.onUsePotion     = onUsePotion;
    this.onInteract      = onInteract;
    this.actionBarUI     = actionBarUI;

    // Load inventory state from localStorage
    const saved = localStorage.getItem("equipmentState");
    if (saved) {
      try {
        const state = JSON.parse(saved);
        if (Array.isArray(state)) this.inventory = [...state];
      } catch (e) { /* ignore */ }
    }

    // Load saved panel position
    const rawPos = localStorage.getItem(EquipmentUI.LS_KEY);
    if (rawPos) { try { this.savedPos = JSON.parse(rawPos); } catch (e) { /* ignore */ } }
  }

  get isEquipmentOpen(): boolean { return this.isOpen; }

  toggle(): void { this.isOpen ? this.close() : this.open(); }

  exportState(): any {
    return [...this.inventory];
  }

  importState(state: any): void {
    if (Array.isArray(state)) {
      this.inventory = [...state];
      localStorage.setItem("equipmentState", JSON.stringify(this.inventory));
    }
  }

  /** Call every frame from GameScene while the panel is open. */
  updateItems(potions: number, potionHealRemaining: number, hp: number, maxHp: number): void {
    if (!this.isOpen) return;

    if (potions === 0 && this.potionCellObjects.length > 0) {
      // Player just used their last potion — tear down all potion cells
      for (const obj of this.potionCellObjects) obj.destroy();
      this.potionCellObjects = [];
      this.potionCountText   = null;
      this.potionIconObj     = null;
      return;
    }

    // Update count text and tint for whatever potion cell is currently rendered
    if (this.potionCountText) this.potionCountText.setText(String(potions));
    if (this.potionIconObj) {
      const canUse = potions > 0 && hp < maxHp && potionHealRemaining < (maxHp - hp);
      this.potionIconObj.setTint(canUse ? 0xffffff : 0xaaaaaa);
    }
  }

  open(): void {
    if (this.isOpen) { this.close(); return; }
    this.isOpen = true;

    const s = this.scene;
    const { width, height } = s.scale;
    const D = 200000;

    // ── Layout ───────────────────────────────────────────────────────────────
    const PANEL_W   = 300;
    const HEADER_H  = 38;
    const BG_H      = 200;
    const DIV_GAP   = 6;
    const INV_LBL_H = 26;
    const CELL      = 60;
    const CELL_GAP  = 8;
    const GRID_ROWS = 3;
    const GRID_COLS = 3;
    const GRID_H    = GRID_ROWS * CELL + (GRID_ROWS - 1) * CELL_GAP;
    const BOT_PAD   = 14;
    const PANEL_H   = HEADER_H + BG_H + DIV_GAP + INV_LBL_H + GRID_H + BOT_PAD;

    const { px, py } = this.getPanelOrigin(width, height, PANEL_W, PANEL_H);

    const add = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };

    // ── Shadow ───────────────────────────────────────────────────────────────
    add(s.add.graphics()
      .fillStyle(0x000000, 0.45)
      .fillRoundedRect(px + 6, py + 6, PANEL_W, PANEL_H, 10)
      .setScrollFactor(0).setDepth(D - 1));

    // ── Panel ────────────────────────────────────────────────────────────────
    add(s.add.graphics()
      .fillStyle(0x1a1005, 0.97)
      .fillRoundedRect(px, py, PANEL_W, PANEL_H, 10)
      .lineStyle(2, 0xc8a84b, 1)
      .strokeRoundedRect(px, py, PANEL_W, PANEL_H, 10)
      .setScrollFactor(0).setDepth(D));

    add(s.add.graphics()
      .lineStyle(1, 0x7a5c1e, 0.45)
      .strokeRoundedRect(px + 5, py + 5, PANEL_W - 10, PANEL_H - 10, 7)
      .setScrollFactor(0).setDepth(D + 1));

    // ── Title ────────────────────────────────────────────────────────────────
    add(s.add.text(px + PANEL_W / 2, py + HEADER_H / 2, "✦  Equipment  ✦", {
      fontSize: "16px", color: "#e8c96a",
      stroke: "#1a0e00", strokeThickness: 4, resolution: 2, fontStyle: "bold",
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2));

    // ── Close button ─────────────────────────────────────────────────────────
    const closeBtn = add(s.add.text(px + PANEL_W - 12, py + 10, "✕", {
      fontSize: "18px", color: "#c8a84b",
      stroke: "#000", strokeThickness: 2, resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 2)
      .setInteractive({ useHandCursor: true })) as Phaser.GameObjects.Text;
    closeBtn.on("pointerover", () => closeBtn.setColor("#ff6644"));
    closeBtn.on("pointerout",  () => closeBtn.setColor("#c8a84b"));
    closeBtn.on("pointerdown", () => { this.onInteract(); this.close(); });

    // ── Drag handle (title bar left of close button) ──────────────────────────
    const dragHandle = add(s.add.rectangle(
      px + (PANEL_W - 32) / 2, py + HEADER_H / 2,
      PANEL_W - 32, HEADER_H,
      0x000000, 0,
    ).setScrollFactor(0).setDepth(D + 3).setInteractive({ useHandCursor: true })) as Phaser.GameObjects.Rectangle;

    dragHandle.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      this.onInteract();
      this.beginPanelDrag(ptr, px, py, PANEL_W, PANEL_H);
    });

    add(s.add.graphics()
      .lineStyle(1, 0x7a5c1e, 0.9)
      .lineBetween(px + 10, py + HEADER_H, px + PANEL_W - 10, py + HEADER_H)
      .setScrollFactor(0).setDepth(D + 1));

    // ── eq_background section ─────────────────────────────────────────────────
    const bgTop = py + HEADER_H;
    add(s.add.graphics()
      .fillStyle(0x0d0a04, 0.9)
      .fillRect(px + 6, bgTop + 4, PANEL_W - 12, BG_H - 8)
      .setScrollFactor(0).setDepth(D + 1));

    if (s.textures.exists("eq_background")) {
      const bgImg = s.add.image(px + PANEL_W / 2, bgTop + BG_H / 2, "eq_background");
      bgImg.setScrollFactor(0).setDepth(D + 2);
      const sc = Math.min((PANEL_W - 16) / bgImg.width, (BG_H - 16) / bgImg.height);
      bgImg.setDisplaySize(Math.round(bgImg.width * sc), Math.round(bgImg.height * sc));
      add(bgImg);
    }

    // ── Weapon slot ───────────────────────────────────────────────────────────
    const WSLOT  = 54;
    const wslotX = px + PANEL_W - WSLOT - 16;
    const wslotY = bgTop + Math.round((BG_H - WSLOT) / 2);

    add(s.add.graphics()
      .fillStyle(0x0a0702, 0.88)
      .fillRect(wslotX, wslotY, WSLOT, WSLOT)
      .lineStyle(2, 0xc8a84b, 1)
      .strokeRect(wslotX, wslotY, WSLOT, WSLOT)
      .lineStyle(1, 0xffd770, 0.8)
      .lineBetween(wslotX,          wslotY,          wslotX + 10,        wslotY)
      .lineBetween(wslotX,          wslotY,          wslotX,              wslotY + 10)
      .lineBetween(wslotX + WSLOT,  wslotY,          wslotX + WSLOT - 10, wslotY)
      .lineBetween(wslotX + WSLOT,  wslotY,          wslotX + WSLOT,      wslotY + 10)
      .lineBetween(wslotX,          wslotY + WSLOT,  wslotX + 10,         wslotY + WSLOT)
      .lineBetween(wslotX,          wslotY + WSLOT,  wslotX,              wslotY + WSLOT - 10)
      .lineBetween(wslotX + WSLOT,  wslotY + WSLOT,  wslotX + WSLOT - 10, wslotY + WSLOT)
      .lineBetween(wslotX + WSLOT,  wslotY + WSLOT,  wslotX + WSLOT,      wslotY + WSLOT - 10)
      .setScrollFactor(0).setDepth(D + 3));

    add(s.add.text(wslotX + WSLOT / 2, wslotY - 11, "Weapon", {
      fontSize: "10px", color: "#9a8040",
      stroke: "#0d0a00", strokeThickness: 2, resolution: 2,
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 3));

    const ps        = this.getPlayerState();
    const weaponKey = ps?.weapon ?? "sword";
    const weaponDef = this.weaponsRegistry[weaponKey];

    const weaponIcon = s.add.image(wslotX + WSLOT / 2, wslotY + WSLOT / 2, weaponKey);
    weaponIcon.setScrollFactor(0).setDepth(D + 4);
    const wsc = Math.min((WSLOT - 10) / weaponIcon.width, (WSLOT - 10) / weaponIcon.height);
    weaponIcon.setDisplaySize(Math.round(weaponIcon.width * wsc), Math.round(weaponIcon.height * wsc));
    add(weaponIcon);

    const wHit = s.add.rectangle(wslotX + WSLOT / 2, wslotY + WSLOT / 2, WSLOT, WSLOT, 0, 0)
      .setScrollFactor(0).setDepth(D + 5).setInteractive({ useHandCursor: false });
    add(wHit);
    wHit.on("pointerover", () => {
      weaponIcon.setTint(0xffd88a);
      this.showWeaponTooltip(wslotX, wslotY, WSLOT, weaponKey, weaponDef, D + 6);
    });
    wHit.on("pointerout",  () => { weaponIcon.clearTint(); this.hideTooltip(); });
    wHit.on("pointerdown", () => { this.onInteract(); });

    // ── Section divider ───────────────────────────────────────────────────────
    const invY = bgTop + BG_H + DIV_GAP / 2;
    add(s.add.graphics()
      .lineStyle(1, 0x7a5c1e, 0.9)
      .lineBetween(px + 10, invY, px + PANEL_W - 10, invY)
      .setScrollFactor(0).setDepth(D + 1));

    add(s.add.text(px + PANEL_W / 2, invY + INV_LBL_H / 2, "Inventory", {
      fontSize: "13px", color: "#c8a84b",
      stroke: "#1a0e00", strokeThickness: 3, resolution: 2, fontStyle: "bold",
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 2));

    // ── 3×3 inventory grid ────────────────────────────────────────────────────
    const gridTop  = invY + INV_LBL_H;
    const totalW   = GRID_COLS * CELL + (GRID_COLS - 1) * CELL_GAP;
    const gridLeft = px + Math.round((PANEL_W - totalW) / 2);

    this.gridBounds = [];

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const cx = gridLeft + col * (CELL + CELL_GAP);
        const cy = gridTop  + row * (CELL + CELL_GAP);
        const idx = row * GRID_COLS + col;

        this.gridBounds.push({ x: cx, y: cy, w: CELL, h: CELL });

        // Cell background — always rendered for every cell
        add(s.add.graphics()
          .fillStyle(0x0a0702, 0.72)
          .fillRect(cx, cy, CELL, CELL)
          .lineStyle(1, 0x7a5c1e, 0.85)
          .strokeRect(cx, cy, CELL, CELL)
          .fillStyle(0xc8a84b, 0.45)
          .fillRect(cx,            cy,            3, 3)
          .fillRect(cx + CELL - 3, cy,            3, 3)
          .fillRect(cx,            cy + CELL - 3, 3, 3)
          .fillRect(cx + CELL - 3, cy + CELL - 3, 3, 3)
          .setScrollFactor(0).setDepth(D + 2));

        // Render item if slot is not empty
        const itemType = this.inventory[idx];
        if (itemType === "health_potion" && (ps?.potions ?? 0) > 0) {
          this.buildPotionCell(s, cx, cy, CELL, ps!.potions, ps!.potionHealRemaining ?? 0, ps!.hp ?? 0, ps!.maxHp ?? 100, D, idx);
        }
      }
    }
  }

  private buildPotionCell(
    s: Phaser.Scene,
    cx: number, cy: number, CELL: number,
    potions: number, potionHealRemaining: number, hp: number, maxHp: number,
    D: number,
    slotIdx: number,
  ): void {
    // All objects tracked in potionCellObjects so they can be destroyed independently
    const add = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.potionCellObjects.push(obj);
      return obj;
    };

    // Potion icon
    const MAX_ICO = CELL - 14;
    const icon = s.add.image(cx + CELL / 2, cy + CELL / 2 - 4, "health_potion")
      .setScrollFactor(0).setDepth(D + 3);
    const sc = Math.min(MAX_ICO / icon.width, MAX_ICO / icon.height);
    icon.setDisplaySize(Math.round(icon.width * sc), Math.round(icon.height * sc));
    const canUse = potions > 0 && hp < maxHp && potionHealRemaining < (maxHp - hp);
    icon.setAlpha(potions > 0 ? 1 : 0.35);
    icon.setTint(canUse ? 0xffffff : 0xaaaaaa);
    add(icon);
    this.potionIconObj = icon;

    // Count text (bottom-right of cell)
    const countTxt = s.add.text(cx + CELL - 4, cy + CELL - 14, String(potions), {
      fontSize: "11px", color: "#ffffff",
      stroke: "#000", strokeThickness: 2, resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 4);
    add(countTxt);
    this.potionCountText = countTxt;

    // "Potion" label (top of cell)
    add(s.add.text(cx + CELL / 2, cy + 6, "Potion", {
      fontSize: "9px", color: "#9a8040",
      stroke: "#0d0a00", strokeThickness: 2, resolution: 2,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D + 4));

    // Hit area — right-click to consume, left-drag to action bar
    const hit = s.add.rectangle(cx + CELL / 2, cy + CELL / 2, CELL, CELL, 0, 0)
      .setScrollFactor(0).setDepth(D + 5).setInteractive({ useHandCursor: true });
    add(hit);

    hit.on("pointerover", () => {
      if (potions > 0) this.showPotionTooltip(cx, cy, CELL, potionHealRemaining, maxHp, D + 6);
    });
    hit.on("pointerout", () => this.hideTooltip());

    hit.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      this.onInteract();
      if (ptr.rightButtonDown()) {
        // Right-click: consume
        const live = this.getPlayerState();
        if (!live) return;
        if (live.potions <= 0) return;
        if (live.hp >= live.maxHp) return;
        if (live.potionHealRemaining >= live.maxHp - live.hp) return;
        this.onUsePotion();
      } else {
        // Left-click: begin drag
        this.beginDrag(ptr, cx, cy, CELL, D, slotIdx);
      }
    });
  }

  private beginDrag(ptr: Phaser.Input.Pointer, cellX: number, cellY: number, CELL: number, D: number, sourceIdx: number): void {
    const itemType = this.inventory[sourceIdx];
    if (!itemType) return;

    // For potions, check if player has any
    if (itemType === "health_potion") {
      const live = this.getPlayerState();
      if (!live || live.potions <= 0) return;
    }

    const s = this.scene;
    this.dragSourceIdx = sourceIdx;

    // Ghost image following pointer
    const ghost = s.add.image(ptr.x, ptr.y, itemType === "health_potion" ? "health_potion" : itemType)
      .setScrollFactor(0).setDepth(D + 10).setAlpha(0.75);
    ghost.setDisplaySize(36, 36);
    this.dragGhost = ghost;
    this.objects.push(ghost);

    // Get target bounds
    const actionBarBounds = this.actionBarUI.getSlotBounds();
    const invBounds       = this.gridBounds;

    this.dragMoveHandler = (p: Phaser.Input.Pointer) => {
      if (this.dragGhost) this.dragGhost.setPosition(p.x, p.y);
    };

    this.dragUpHandler = (p: Phaser.Input.Pointer) => {
      this.endDrag(p, actionBarBounds, invBounds);
    };

    s.input.on("pointermove", this.dragMoveHandler);
    s.input.on("pointerup",   this.dragUpHandler);
  }

  private endDrag(
    ptr: Phaser.Input.Pointer,
    actionBarBounds: Array<{ x: number; y: number; w: number; h: number }>,
    invBounds: Array<{ x: number; y: number; w: number; h: number }>,
  ): void {
    const s = this.scene;

    if (this.dragMoveHandler) { s.input.off("pointermove", this.dragMoveHandler); this.dragMoveHandler = null; }
    if (this.dragUpHandler)   { s.input.off("pointerup",   this.dragUpHandler);   this.dragUpHandler   = null; }

    if (this.dragGhost) {
      this.dragGhost.destroy();
      const idx = this.objects.indexOf(this.dragGhost);
      if (idx !== -1) this.objects.splice(idx, 1);
      this.dragGhost = null;
    }

    const sourceIdx = this.dragSourceIdx;
    this.dragSourceIdx = null;
    if (sourceIdx === null) return;

    const itemType = this.inventory[sourceIdx];
    if (!itemType) return;

    // 1. Check action bar drop
    for (let i = 0; i < actionBarBounds.length; i++) {
      const b = actionBarBounds[i];
      if (ptr.x >= b.x && ptr.x <= b.x + b.w && ptr.y >= b.y && ptr.y <= b.y + b.h) {
        if (itemType === "health_potion") {
          this.actionBarUI.assignSlot(i, "health_potion");
        }
        return; // drop handled
      }
    }

    // 2. Check inventory grid drop (reordering)
    for (let i = 0; i < invBounds.length; i++) {
      const b = invBounds[i];
      if (ptr.x >= b.x && ptr.x <= b.x + b.w && ptr.y >= b.y && ptr.y <= b.y + b.h) {
        if (i === sourceIdx) return; // dropped on same slot

        // Swap items between sourceIdx and i
        const targetItem = this.inventory[i];
        this.inventory[i] = itemType;
        this.inventory[sourceIdx] = targetItem;

        localStorage.setItem("equipmentState", JSON.stringify(this.inventory));

        // Redraw panel to reflect new order
        this.close();
        this.open();
        return;
      }
    }
  }

  // ── Tooltips ─────────────────────────────────────────────────────────────────

  private showWeaponTooltip(
    slotX: number, slotY: number, slotSize: number,
    weaponKey: string, weaponDef: WeaponDef | undefined, depth: number,
  ): void {
    this.hideTooltip();
    const s = this.scene;
    const name   = weaponDef?.label    ?? weaponKey;
    const damage = weaponDef?.damage   ?? "?";
    const range  = weaponDef?.hitRadius ?? "?";
    const TIP_W = 148; const TIP_H = 66;
    const tipX = slotX - TIP_W - 10;
    const tipY = slotY + Math.round((slotSize - TIP_H) / 2);
    const addT = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.tooltipObjects.push(o); return o; };
    addT(s.add.graphics().fillStyle(0x1a1005, 0.97).fillRoundedRect(tipX, tipY, TIP_W, TIP_H, 6)
      .lineStyle(1, 0xc8a84b, 0.9).strokeRoundedRect(tipX, tipY, TIP_W, TIP_H, 6)
      .setScrollFactor(0).setDepth(depth));
    [
      { text: name,               color: "#e8c96a", size: "13px" },
      { text: `Damage: ${damage}`, color: "#ff9977", size: "11px" },
      { text: `Range:  ${range}`, color: "#88ccff", size: "11px" },
    ].forEach(({ text, color, size }, i) =>
      addT(s.add.text(tipX + 10, tipY + 8 + i * 19, text, {
        fontSize: size, color, resolution: 2, stroke: "#000", strokeThickness: 1,
      }).setScrollFactor(0).setDepth(depth + 1)),
    );
  }

  private showPotionTooltip(
    cellX: number, cellY: number, cellSize: number,
    potionHealRemaining: number, maxHp: number, depth: number,
  ): void {
    this.hideTooltip();
    const s = this.scene;
    const pct = maxHp > 0 ? Math.round((potionHealRemaining / maxHp) * 100) : 0;
    const TIP_W = 168; const TIP_H = 72;
    const tipX  = cellX + cellSize + 8;
    const tipY  = cellY + Math.round((cellSize - TIP_H) / 2);
    const addT  = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.tooltipObjects.push(o); return o; };
    addT(s.add.graphics().fillStyle(0x1a1005, 0.97).fillRoundedRect(tipX, tipY, TIP_W, TIP_H, 6)
      .lineStyle(1, 0x88ffcc, 0.7).strokeRoundedRect(tipX, tipY, TIP_W, TIP_H, 6)
      .setScrollFactor(0).setDepth(depth));
    [
      { text: "Health Potion",              color: "#e8c96a", size: "13px" },
      { text: "Heals 30% of HP",  color: "#88ffcc", size: "11px" },
      { text: `Active pool: ${pct}% max HP`, color: "#aaffaa", size: "11px" },
      { text: "Right-click to consume",     color: "#888888", size: "10px" },
    ].forEach(({ text, color, size }, i) =>
      addT(s.add.text(tipX + 10, tipY + 6 + i * 16, text, {
        fontSize: size, color, resolution: 2, stroke: "#000", strokeThickness: 1,
      }).setScrollFactor(0).setDepth(depth + 1)),
    );
  }

  private hideTooltip(): void {
    for (const obj of this.tooltipObjects) obj.destroy();
    this.tooltipObjects = [];
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    // Clean up item-drag listeners if closed mid-drag
    if (this.dragMoveHandler) { this.scene.input.off("pointermove", this.dragMoveHandler); this.dragMoveHandler = null; }
    if (this.dragUpHandler)   { this.scene.input.off("pointerup",   this.dragUpHandler);   this.dragUpHandler   = null; }
    this.dragGhost = null;

    this.cleanupPanelDrag();

    this.potionCountText = null;
    this.potionIconObj   = null;
    this.hideTooltip();
    for (const obj of this.potionCellObjects) obj.destroy();
    this.potionCellObjects = [];
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
  }

  // ── Panel drag-to-reposition ───────────────────────────────────────────────

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
      .strokeRoundedRect(panelX, panelY, panelW, panelH, 10)
      .setScrollFactor(0).setDepth(300000);
    this.panelDragPreview = preview;

    this.panelDragMoveHandler = (p: Phaser.Input.Pointer) => {
      const newPx = Math.max(0, Math.min(width  - panelW, panelX + p.x - startX));
      const newPy = Math.max(0, Math.min(height - panelH, panelY + p.y - startY));
      preview.clear()
        .lineStyle(2, 0xc8a84b, 0.8)
        .strokeRoundedRect(newPx, newPy, panelW, panelH, 10);
    };

    this.panelDragUpHandler = (p: Phaser.Input.Pointer) => {
      const newPx = Math.max(0, Math.min(width  - panelW, panelX + p.x - startX));
      const newPy = Math.max(0, Math.min(height - panelH, panelY + p.y - startY));

      this.savedPos = { rightOffset: width - newPx, topOffset: newPy };
      localStorage.setItem(EquipmentUI.LS_KEY, JSON.stringify(this.savedPos));

      this.cleanupPanelDrag();
      this.close();
      this.open();
    };

    this.scene.input.on("pointermove", this.panelDragMoveHandler);
    this.scene.input.on("pointerup",   this.panelDragUpHandler);
  }

  private cleanupPanelDrag(): void {
    if (this.panelDragMoveHandler) { this.scene.input.off("pointermove", this.panelDragMoveHandler); this.panelDragMoveHandler = null; }
    if (this.panelDragUpHandler)   { this.scene.input.off("pointerup",   this.panelDragUpHandler);   this.panelDragUpHandler   = null; }
    if (this.panelDragPreview)     { this.panelDragPreview.destroy(); this.panelDragPreview = null; }
  }
}
