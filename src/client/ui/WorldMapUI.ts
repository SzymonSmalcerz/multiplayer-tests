import Phaser from "phaser";
import { makeDraggable } from "./DragHelper";

const D       = 210000;
const LS_KEY  = "world_map_pos";
const PADDING = 14;
const HEADER_H = 38;

interface SavedPos { rightOffset: number; topOffset: number; }

export class WorldMapUI {
  private scene:         Phaser.Scene;
  private getPlayerPos:  () => { x: number; y: number } | null;
  private getMapState:   () => { width: number; height: number; name: string; displayName: string } | null;
  private onInteract:    () => void;

  isOpen = false;
  private objects:      Phaser.GameObjects.GameObject[] = [];
  private savedPos:     SavedPos | null = null;
  private panelCleanup: (() => void) | null = null;

  // Image display rect (updated in open(), used for blip positioning in update())
  private imgX = 0;
  private imgY = 0;
  private imgW = 0;
  private imgH = 0;
  private mapW = 0;
  private mapH = 0;

  private blip: Phaser.GameObjects.Graphics | null = null;
  private blipTime = 0;

  constructor(
    scene:        Phaser.Scene,
    getPlayerPos: () => { x: number; y: number } | null,
    getMapState:  () => { width: number; height: number; name: string; displayName: string } | null,
    onInteract:   () => void,
  ) {
    this.scene        = scene;
    this.getPlayerPos = getPlayerPos;
    this.getMapState  = getMapState;
    this.onInteract   = onInteract;

    const raw = localStorage.getItem(LS_KEY);
    if (raw) { try { this.savedPos = JSON.parse(raw); } catch { /* ignore */ } }
  }

  toggle(): void {
    if (!this.isOpen) {
      const ms = this.getMapState();
      if (!ms) return;
      if (!this.scene.textures.exists(`${ms.name}_minimap`)) return;
    }
    this.isOpen ? this.close() : this.open();
  }

  open(): void {
    if (this.isOpen) { this.close(); return; }
    this.isOpen = true;

    const s   = this.scene;
    const ms  = this.getMapState();
    if (!ms) { this.isOpen = false; return; }

    const imageKey = `${ms.name}_minimap`;
    const hasImage = s.textures.exists(imageKey);

    const { width: screenW, height: screenH } = s.scale;

    const add = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.objects.push(obj);
      return obj;
    };

    let PANEL_W: number;
    let PANEL_H: number;

    if (hasImage) {
      const tex  = s.textures.get(imageKey).getSourceImage() as HTMLImageElement;
      const texW = tex.width;
      const texH = tex.height;

      const maxW = Math.round(screenW * 0.85);
      const maxH = Math.round(screenH * 0.80) - HEADER_H;
      const scale = Math.min(1, maxW / texW, maxH / texH);

      this.imgW  = Math.round(texW * scale);
      this.imgH  = Math.round(texH * scale);
      this.mapW  = ms.width;
      this.mapH  = ms.height;

      PANEL_W = this.imgW + PADDING * 2;
      PANEL_H = HEADER_H + this.imgH + PADDING + 6;
    } else {
      PANEL_W = 320;
      PANEL_H = HEADER_H + 60;
    }

    const { px, py } = this.getPanelOrigin(screenW, screenH, PANEL_W, PANEL_H);

    // ── Panel background ──────────────────────────────────────────────────────
    add(s.add.graphics())
      .fillStyle(0x1a1208, 0.97)
      .fillRoundedRect(px, py, PANEL_W, PANEL_H, 8)
      .lineStyle(2, 0xc9a227, 1)
      .strokeRoundedRect(px, py, PANEL_W, PANEL_H, 8)
      .setScrollFactor(0).setDepth(D);

    // ── Title ─────────────────────────────────────────────────────────────────
    const displayName = ms.displayName || ms.name.replace(/_/g, " ");
    add(s.add.text(px + PANEL_W / 2, py + HEADER_H / 2, `✦  ${displayName}  ✦`, {
      fontSize: "15px", color: "#e8c96a",
      fontFamily: "Cinzel Decorative, serif",
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
    dragHandle.on("pointerdown", () => this.onInteract());
    this.panelCleanup = makeDraggable(s, dragHandle, () => ({ x: px, y: py }), {
      panelW: PANEL_W, panelH: PANEL_H, lsKey: LS_KEY, borderColor: 0xc9a227, borderRadius: 8,
      onDone: (pos) => { this.savedPos = pos; this.close(); this.open(); },
    });

    // ── Divider ───────────────────────────────────────────────────────────────
    add(s.add.graphics())
      .lineStyle(1, 0x665533, 1)
      .lineBetween(px + 10, py + HEADER_H - 2, px + PANEL_W - 10, py + HEADER_H - 2)
      .setScrollFactor(0).setDepth(D + 1);

    if (hasImage) {
      // ── Map image ────────────────────────────────────────────────────────────
      this.imgX = px + PADDING;
      this.imgY = py + HEADER_H + 4;

      add(s.add.image(this.imgX, this.imgY, imageKey)
        .setOrigin(0, 0)
        .setDisplaySize(this.imgW, this.imgH)
        .setScrollFactor(0).setDepth(D + 1));

      // ── Image border ─────────────────────────────────────────────────────────
      add(s.add.graphics())
        .lineStyle(1, 0x8a6020, 0.7)
        .strokeRect(this.imgX, this.imgY, this.imgW, this.imgH)
        .setScrollFactor(0).setDepth(D + 2);

      // ── Player blip ──────────────────────────────────────────────────────────
      this.blip = s.add.graphics().setScrollFactor(0).setDepth(D + 3);
      this.objects.push(this.blip);
      this.blipTime = 0;
      this.drawBlip();
    } else {
      // ── "Map not available" notice ────────────────────────────────────────────
      add(s.add.text(px + PANEL_W / 2, py + HEADER_H + 30, "Map not available", {
        fontSize: "13px", color: "#887755",
        stroke: "#000000", strokeThickness: 2, resolution: 2,
      }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(D + 1));
    }
  }

  update(): void {
    if (!this.isOpen || !this.blip) return;
    this.blipTime += this.scene.game.loop.delta;
    this.drawBlip();
  }

  private drawBlip(): void {
    if (!this.blip) return;
    const pos = this.getPlayerPos();
    if (!pos || this.mapW === 0 || this.mapH === 0) return;

    const bx = this.imgX + (pos.x / this.mapW) * this.imgW;
    const by = this.imgY + (pos.y / this.mapH) * this.imgH;

    // Pulsing alpha: 0.6–1.0 over ~800ms cycle
    const pulse = 0.7 + 0.3 * Math.abs(Math.sin(this.blipTime * 0.004));

    this.blip.clear();
    // Outer glow ring
    this.blip.fillStyle(0xffffff, pulse * 0.3);
    this.blip.fillCircle(bx, by, 6);
    // Inner dot
    this.blip.fillStyle(0xffffff, pulse);
    this.blip.fillCircle(bx, by, 3);
  }

  private getPanelOrigin(screenW: number, screenH: number, panelW: number, panelH: number): { px: number; py: number } {
    if (this.savedPos) {
      const px = Math.max(0, Math.min(screenW - panelW, screenW - this.savedPos.rightOffset));
      const py = Math.max(0, Math.min(screenH - panelH, this.savedPos.topOffset));
      return { px, py };
    }
    return {
      px: Math.round((screenW - panelW) / 2),
      py: Math.round((screenH - panelH) / 2),
    };
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.blip = null;
    this.panelCleanup?.(); this.panelCleanup = null;
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
  }
}
