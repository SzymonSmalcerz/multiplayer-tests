import Phaser from "phaser";
import { makeDraggable } from "./DragHelper";

export interface StatsSnapshot {
  statPoints: number;
  vitality:   number;
  strength:   number;
  level:      number;
  hp:         number;
  maxHp:      number;
}

interface SavedPos { rightOffset: number; topOffset: number; }

const PANEL_W = 260;
const HEADER_H = 38;
const ROW_H = 60;
const BOT_PAD = 16;
const PANEL_H = HEADER_H + 40 + 10 + ROW_H * 2 + BOT_PAD;

export class StatsUI {
  private scene: Phaser.Scene;
  private getPlayerState: () => StatsSnapshot | null;
  private onAllocate: (stat: string) => void;
  private onInteract: () => void;

  isOpen = false;
  private objects: Phaser.GameObjects.GameObject[] = [];

  // Live-updatable text refs
  private pointsText:    Phaser.GameObjects.Text | null = null;
  private vitValText:    Phaser.GameObjects.Text | null = null;
  private strValText:    Phaser.GameObjects.Text | null = null;
  private vitPlusBtn:    Phaser.GameObjects.Text | null = null;
  private strPlusBtn:    Phaser.GameObjects.Text | null = null;

  // Panel drag state
  private static readonly LS_KEY = "stats_pos";
  private savedPos:     SavedPos | null     = null;
  private panelCleanup: (() => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    getPlayerState: () => StatsSnapshot | null,
    onAllocate: (stat: string) => void,
    onInteract: () => void,
  ) {
    this.scene          = scene;
    this.getPlayerState = getPlayerState;
    this.onAllocate     = onAllocate;
    this.onInteract     = onInteract;

    const rawPos = localStorage.getItem(StatsUI.LS_KEY);
    if (rawPos) { try { this.savedPos = JSON.parse(rawPos); } catch (e) { /* ignore */ } }
  }

  get isStatsOpen(): boolean { return this.isOpen; }

  toggle(): void { this.isOpen ? this.close() : this.open(); }

  open(): void {
    if (this.isOpen) { this.close(); return; }
    this.isOpen = true;

    const s = this.scene;
    const { width, height } = s.scale;
    const D = 200000;

    const { px, py } = this.getPanelOrigin(width, height);

    const add = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };

    const ps = this.getPlayerState();

    // ── Shadow ────────────────────────────────────────────────────────────────
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

    add(s.add.graphics()
      .lineStyle(1, 0x7a5c1e, 0.45)
      .strokeRoundedRect(px + 5, py + 5, PANEL_W - 10, PANEL_H - 10, 7)
      .setScrollFactor(0).setDepth(D + 1));

    // ── Title ─────────────────────────────────────────────────────────────────
    add(s.add.text(px + PANEL_W / 2, py + HEADER_H / 2, "✦ Character Stats ✦", {
      fontSize: "15px", color: "#e8c96a",
      stroke: "#1a0e00", strokeThickness: 4, resolution: 2, fontStyle: "bold",
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

    // ── Drag handle ───────────────────────────────────────────────────────────
    const dragHandle = add(s.add.rectangle(
      px + (PANEL_W - 32) / 2, py + HEADER_H / 2,
      PANEL_W - 32, HEADER_H,
      0x000000, 0,
    ).setScrollFactor(0).setDepth(D + 3).setInteractive({ useHandCursor: true })) as Phaser.GameObjects.Rectangle;
    dragHandle.on("pointerdown", () => this.onInteract());
    this.panelCleanup = makeDraggable(this.scene, dragHandle, () => ({ x: px, y: py }), {
      panelW: PANEL_W, panelH: PANEL_H, lsKey: StatsUI.LS_KEY, borderColor: 0xc8a84b, borderRadius: 10,
      onDone: (pos) => { this.savedPos = pos; this.close(); this.open(); },
    });

    // ── Header divider ────────────────────────────────────────────────────────
    add(s.add.graphics()
      .lineStyle(1, 0x7a5c1e, 0.9)
      .lineBetween(px + 10, py + HEADER_H, px + PANEL_W - 10, py + HEADER_H)
      .setScrollFactor(0).setDepth(D + 1));

    // ── Stat points row ───────────────────────────────────────────────────────
    const pts = ps?.statPoints ?? 0;
    const ptsColor = pts > 0 ? "#88ff88" : "#8a7040";
    add(s.add.text(px + 14, py + HEADER_H + 12, "Available Points:", {
      fontSize: "12px", color: "#c8a84b",
      stroke: "#000", strokeThickness: 2, resolution: 2,
    }).setScrollFactor(0).setDepth(D + 2));

    this.pointsText = add(s.add.text(px + PANEL_W - 14, py + HEADER_H + 12, String(pts), {
      fontSize: "14px", color: ptsColor,
      stroke: "#000", strokeThickness: 2, resolution: 2, fontStyle: "bold",
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 2)) as Phaser.GameObjects.Text;

    // ── Divider ───────────────────────────────────────────────────────────────
    const divY = py + HEADER_H + 40;
    add(s.add.graphics()
      .lineStyle(1, 0x7a5c1e, 0.7)
      .lineBetween(px + 10, divY, px + PANEL_W - 10, divY)
      .setScrollFactor(0).setDepth(D + 1));

    // ── Vitality row ──────────────────────────────────────────────────────────
    this.buildStatRow(s, px, divY + 6, D, add, "Vitality", ps?.vitality ?? 0, "+4 Max HP / pt", "vitality", pts > 0);

    // ── Strength row ──────────────────────────────────────────────────────────
    this.buildStatRow(s, px, divY + 6 + ROW_H, D, add, "Strength", ps?.strength ?? 0, "+2 Damage / pt", "strength", pts > 0);
  }

  private buildStatRow(
    s: Phaser.Scene,
    px: number, rowY: number,
    D: number,
    add: <T extends Phaser.GameObjects.GameObject>(obj: T) => T,
    label: string,
    value: number,
    desc: string,
    stat: "vitality" | "strength",
    canAllocate: boolean,
  ): void {
    add(s.add.text(px + 14, rowY + 6, label, {
      fontSize: "13px", color: "#e8d5a0",
      stroke: "#000", strokeThickness: 2, resolution: 2, fontStyle: "bold",
    }).setScrollFactor(0).setDepth(D + 2));

    const valText = s.add.text(px + 14, rowY + 24, String(value), {
      fontSize: "18px", color: "#c9a227",
      stroke: "#000", strokeThickness: 2, resolution: 2, fontStyle: "bold",
    }).setScrollFactor(0).setDepth(D + 2);
    add(valText);

    add(s.add.text(px + 60, rowY + 28, desc, {
      fontSize: "10px", color: "#8a7040",
      stroke: "#000", strokeThickness: 1, resolution: 2,
    }).setScrollFactor(0).setDepth(D + 2));

    if (stat === "vitality") this.vitValText = valText;
    else                      this.strValText = valText;

    // [+] button
    const plusBtn = s.add.text(px + PANEL_W - 14, rowY + 18, "[+]", {
      fontSize: "14px", color: canAllocate ? "#88ff88" : "#444444",
      stroke: "#000", strokeThickness: 2, resolution: 2, fontStyle: "bold",
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 2)
      .setVisible(canAllocate)
      .setInteractive({ useHandCursor: canAllocate });
    add(plusBtn);

    if (stat === "vitality") this.vitPlusBtn = plusBtn;
    else                      this.strPlusBtn = plusBtn;

    if (canAllocate) {
      plusBtn.on("pointerover", () => plusBtn.setColor("#aaffaa"));
      plusBtn.on("pointerout",  () => plusBtn.setColor("#88ff88"));
      plusBtn.on("pointerdown", () => {
        this.onInteract();
        this.onAllocate(stat);
      });
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.pointsText = null;
    this.vitValText = null;
    this.strValText = null;
    this.vitPlusBtn = null;
    this.strPlusBtn = null;
    this.panelCleanup?.(); this.panelCleanup = null;
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
  }

  /** Call every frame while open to keep stat values fresh. */
  updateItems(): void {
    if (!this.isOpen) return;
    const ps = this.getPlayerState();
    if (!ps) return;

    const pts = ps.statPoints;
    const ptsColor = pts > 0 ? "#88ff88" : "#8a7040";
    this.pointsText?.setText(String(pts)).setColor(ptsColor);
    this.vitValText?.setText(String(ps.vitality));
    this.strValText?.setText(String(ps.strength));

    const canAllocate = pts > 0;
    this.vitPlusBtn?.setVisible(canAllocate);
    this.strPlusBtn?.setVisible(canAllocate);
  }

  // ── Panel drag-to-reposition ───────────────────────────────────────────────

  private getPanelOrigin(width: number, height: number): { px: number; py: number } {
    if (this.savedPos) {
      const px = Math.max(0, Math.min(width  - PANEL_W, width  - this.savedPos.rightOffset));
      const py = Math.max(0, Math.min(height - PANEL_H, this.savedPos.topOffset));
      return { px, py };
    }
    return {
      px: Math.round((width  - PANEL_W) / 2),
      py: Math.round((height - PANEL_H) / 2),
    };
  }
}
