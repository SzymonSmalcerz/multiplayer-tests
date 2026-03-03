import Phaser from "phaser";
import {
  xpForNextLevel,
  sortLeaderboard,
  MINIMAP_SIZE,
} from "../logic";
import { getSkinForLevel, isTierBoundary } from "../skins";

// Mirror of the GameScene constant
const ATTACK_COOLDOWN_MS = 1000;

// Direction index → sprite-sheet row  (down→row2, left→row1, up→row0, right→row3)
const DIR_TO_ROW = [2, 1, 0, 3] as const;

function skinKey(skin: string): string {
  return skin.replace("/", "_");
}

/**
 * UIManager — owns all HUD, party panel, leaderboard, death screen, and weapon HUD.
 * Accepts a Phaser.Scene (actually GameScene) and accesses GameScene-private state
 * via a typed-as-any accessor to avoid a circular import.
 */
export class UIManager {
  private scene: Phaser.Scene;

  /** Convenience accessor for GameScene-specific fields (avoids circular import). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get gs(): any { return this.scene; }

  // ── Session timer HUD ──────────────────────────────────────────────────────
  private timerBg?:          Phaser.GameObjects.Graphics;
  private timerText?:        Phaser.GameObjects.Text;
  private lastTimerSeconds = -1;

  // ── HP/XP/Gold HUD ─────────────────────────────────────────────────────────
  private hudHpBar!:     Phaser.GameObjects.Graphics;
  private hudPotionBar!: Phaser.GameObjects.Graphics;
  private hudXpBar!:     Phaser.GameObjects.Graphics;
  private hudHpText!:    Phaser.GameObjects.Text;
  private hudXpText!:    Phaser.GameObjects.Text;
  private hudGoldText!:  Phaser.GameObjects.Text;
  private hudLastHpFillW   = -1;
  private hudLastHpText    = "";
  private hudLastPotionKey = "";
  private hudLastXpFillW   = -1;
  private hudLastXpText    = "";
  private hudLastGoldText  = "";

  // ── Party HUD ───────────────────────────────────────────────────────────────
  private partyHudHeaderBg!:   Phaser.GameObjects.Graphics;
  private partyHudHeaderText!: Phaser.GameObjects.Text;
  private partyHudLeaveBtn!:   Phaser.GameObjects.Text;
  private partyHudRenameBtn!:  Phaser.GameObjects.Text;
  private partyHudRows: Array<{
    bg:       Phaser.GameObjects.Graphics;
    hpBar:    Phaser.GameObjects.Graphics;
    xpBar:    Phaser.GameObjects.Graphics;
    nameText: Phaser.GameObjects.Text;
    kickBtn:  Phaser.GameObjects.Text;
  }> = [];
  private cachedRosterJson = "";
  private cachedRoster: Array<{
    pid: string;
    sessionId: string | null;
    nickname:  string;
    level:     number;
    hp:        number;
    maxHp:     number;
  }> = [];

  // ── Leaderboard ─────────────────────────────────────────────────────────────
  private leaderboardBg!:     Phaser.GameObjects.Graphics;
  private leaderboardHeader!: Phaser.GameObjects.Text;
  private leaderboardRows:    Phaser.GameObjects.Text[] = [];

  // ── Death UI ────────────────────────────────────────────────────────────────
  private diedOverlay?:  Phaser.GameObjects.Rectangle;
  private diedText?:     Phaser.GameObjects.Text;
  private countdownText?: Phaser.GameObjects.Text;
  private localGrave?:   Phaser.GameObjects.Image;

  // ── Weapon HUD ──────────────────────────────────────────────────────────────
  private weaponHudBg!:      Phaser.GameObjects.Graphics;
  private weaponHudIcon!:    Phaser.GameObjects.Image;
  private weaponHudOverlay!: Phaser.GameObjects.Graphics;
  private weaponHudBorder!:  Phaser.GameObjects.Graphics;
  private weaponHudHitArea!: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  private get isRestrictedMap(): boolean {
    return this.gs.currentMapName === "waitingArea" || this.gs.currentMapName === "quiz";
  }

  // ── HP/XP/Gold HUD ─────────────────────────────────────────────────────────

  createHUD(): void {
    if (this.isRestrictedMap) return;
    const D = 99998;

    // Dark wood background panel
    this.scene.add.graphics()
      .fillStyle(0x1a1208, 0.92)
      .fillRect(8, 8, 204, 50)
      .lineStyle(1, 0x4a2e15, 1)
      .strokeRect(8, 8, 204, 50)
      .setScrollFactor(0)
      .setDepth(D);

    // HP bar background (very dark red)
    this.scene.add.graphics()
      .fillStyle(0x2a0e0e, 1)
      .fillRect(12, 14, 192, 13)
      .setScrollFactor(0)
      .setDepth(D + 1);

    // XP bar background (very dark, near black)
    this.scene.add.graphics()
      .fillStyle(0x0e0a04, 1)
      .fillRect(12, 32, 192, 13)
      .setScrollFactor(0)
      .setDepth(D + 1);

    this.hudHpBar = this.scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(D + 2);

    this.hudPotionBar = this.scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(D + 2);

    this.hudXpBar = this.scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(D + 2);

    this.hudHpText = this.scene.add.text(14, 14, "HP: 100/100", {
      fontSize: "11px",
      color: "#e8d5a0",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setScrollFactor(0).setDepth(D + 3);

    this.hudXpText = this.scene.add.text(14, 32, "XP: 0/100", {
      fontSize: "11px",
      color: "#e8d5a0",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setScrollFactor(0).setDepth(D + 3);

    // Gold panel
    this.scene.add.graphics()
      .fillStyle(0x1a1208, 0.92)
      .fillRect(218, 8, 80, 20)
      .lineStyle(1, 0x4a2e15, 1)
      .strokeRect(218, 8, 80, 20)
      .setScrollFactor(0)
      .setDepth(D);

    this.hudGoldText = this.scene.add.text(222, 12, "Gold: 0", {
      fontSize: "11px",
      color: "#c9a227",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setScrollFactor(0).setDepth(D + 1);
  }

  updateHUD(): void {
    if (this.isRestrictedMap) return;
    const p = this.gs.room.state.players.get(this.gs.mySessionId);
    if (!p) return;

    // Detect death / respawn transitions
    const isDead = !!p.isDead;
    if (isDead !== this.gs.localIsDead) {
      this.gs.localIsDead = isDead;
      if (isDead) {
        this.onLocalPlayerDied();
      } else {
        this.onLocalPlayerRespawned();
      }
    }

    const maxBarW = 192;

    const hpRatio = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const hpFillW = Math.floor(maxBarW * hpRatio);
    if (hpFillW !== this.hudLastHpFillW) {
      this.hudLastHpFillW = hpFillW;
      this.hudHpBar.clear();
      this.hudHpBar.fillStyle(0xaa2020, 1);
      this.hudHpBar.fillRect(12, 14, hpFillW, 13);
    }
    const hpText = `HP: ${Math.floor(p.hp)}/${p.maxHp}`;
    if (hpText !== this.hudLastHpText) {
      this.hudLastHpText = hpText;
      this.hudHpText.setText(hpText);
    }

    const potionRemaining = (p.potionHealRemaining as number) ?? 0;
    const poolCapped = potionRemaining > 0 ? Math.min(potionRemaining, p.maxHp - p.hp) : 0;
    const poolW      = Math.floor(maxBarW * Math.max(0, poolCapped / (p.maxHp || 1)));
    const potionKey  = `${hpFillW}:${poolW}`;
    if (potionKey !== this.hudLastPotionKey) {
      this.hudLastPotionKey = potionKey;
      this.hudPotionBar.clear();
      if (poolW > 0) {
        this.hudPotionBar.fillStyle(0x4a9a30, 0.85);
        this.hudPotionBar.fillRect(12 + hpFillW, 14, poolW, 13);
      }
    }

    const xpNeeded = xpForNextLevel(p.level);
    const xpFillW  = Math.floor(maxBarW * Math.max(0, Math.min(1, p.xp / xpNeeded)));
    if (xpFillW !== this.hudLastXpFillW) {
      this.hudLastXpFillW = xpFillW;
      this.hudXpBar.clear();
      this.hudXpBar.fillStyle(0xc9a227, 1);
      this.hudXpBar.fillRect(12, 32, xpFillW, 13);
    }
    const xpText = `XP: ${Math.floor(p.xp)}/${xpNeeded}  Lv.${p.level}`;
    if (xpText !== this.hudLastXpText) {
      this.hudLastXpText = xpText;
      this.hudXpText.setText(xpText);
    }

    const goldText = `Gold: ${p.gold ?? 0}`;
    if (goldText !== this.hudLastGoldText) {
      this.hudLastGoldText = goldText;
      this.hudGoldText.setText(goldText);
    }

    if (p.level !== this.gs.localLevel) {
      this.gs.localLevel = p.level;
      if (p.isGM) {
        this.gs.localLabel.setText(`${this.gs.localNickname} [GM]`);
      } else {
        this.gs.localLabel.setText(`${this.gs.localNickname} [Lv.${p.level}]`);
        if (isTierBoundary(p.level)) {
          const newKey = skinKey(getSkinForLevel(this.gs.localSkin, p.level));
          if (this.scene.textures.exists(newKey) && this.gs.localSprite.texture.key !== newKey) {
            this.gs.localSprite.setTexture(newKey, DIR_TO_ROW[this.gs.localDirection as 0 | 1 | 2 | 3] * 9);
          }
        }
      }
    }
  }

  // ── Party HUD ───────────────────────────────────────────────────────────────

  createPartyHUD(): void {
    if (this.isRestrictedMap) return;
    const D       = 99998;
    const ROW_H   = 32;
    const ROW_GAP = 4;
    const HEADER_H = 18;
    const START_Y = 66 + HEADER_H + 2;

    this.partyHudHeaderBg = this.scene.add.graphics().setScrollFactor(0).setDepth(D);

    this.partyHudHeaderText = this.scene.add.text(12, 68, "◆ Party", {
      fontSize: "11px",
      color: "#c9a227",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setScrollFactor(0).setDepth(D + 1).setVisible(false);

    this.partyHudLeaveBtn = this.scene.add.text(210, 68, "Leave", {
      fontSize: "11px",
      color: "#c85050",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 1)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.partyHudLeaveBtn.on("pointerover", () => this.partyHudLeaveBtn.setColor("#ff6060"));
    this.partyHudLeaveBtn.on("pointerout",  () => this.partyHudLeaveBtn.setColor("#c85050"));
    this.partyHudLeaveBtn.on("pointerdown", () => {
      this.gs.ignoreNextMapClick = true;
      this.gs.room.send("party_leave");
    });

    this.partyHudRenameBtn = this.scene.add.text(150, 68, "✎", {
      fontSize: "12px",
      color: "#8b6914",
      stroke: "#000000",
      strokeThickness: 2,
      resolution: 2,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 1)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.partyHudRenameBtn.on("pointerover", () => this.partyHudRenameBtn.setColor("#c9a227"));
    this.partyHudRenameBtn.on("pointerout",  () => this.partyHudRenameBtn.setColor("#8b6914"));
    this.partyHudRenameBtn.on("pointerdown", () => {
      this.gs.ignoreNextMapClick = true;
      const current = this.gs.room.state.players.get(this.gs.mySessionId)?.partyName ?? "";
      const newName = window.prompt("Party name (max 20 characters):", current);
      if (newName !== null) {
        const trimmed = newName.trim().slice(0, 20);
        if (trimmed.length > 0) this.gs.room.send("party_rename", { name: trimmed });
      }
    });

    for (let i = 0; i < 4; i++) {
      const y = START_Y + i * (ROW_H + ROW_GAP);

      const bg    = this.scene.add.graphics().setScrollFactor(0).setDepth(D);
      const hpBar = this.scene.add.graphics().setScrollFactor(0).setDepth(D + 2);
      const xpBar = this.scene.add.graphics().setScrollFactor(0).setDepth(D + 2);

      const nameText = this.scene.add.text(14, y + 4, "", {
        fontSize: "11px",
        color: "#e8d5a0",
        stroke: "#000000",
        strokeThickness: 2,
        resolution: 2,
      }).setScrollFactor(0).setDepth(D + 3).setVisible(false);

      const kickBtn = this.scene.add.text(210, y + 4, "Kick", {
        fontSize: "10px",
        color: "#c85050",
        stroke: "#000000",
        strokeThickness: 2,
        resolution: 2,
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(D + 3).setVisible(false)
        .setInteractive({ useHandCursor: true });

      kickBtn.on("pointerover", () => kickBtn.setColor("#ff6060"));
      kickBtn.on("pointerout",  () => kickBtn.setColor("#c85050"));
      kickBtn.on("pointerdown", () => {
        this.gs.ignoreNextMapClick = true;
        const targetPid = kickBtn.getData("targetPid") as string;
        if (targetPid) this.gs.room.send("party_kick", { targetPid });
      });

      this.partyHudRows.push({ bg, hpBar, xpBar, nameText, kickBtn });
    }
  }

  updatePartyHUD(): void {
    if (this.isRestrictedMap) return;
    const ROW_H    = 32;
    const ROW_GAP  = 4;
    const HEADER_H = 18;
    const START_Y  = 66 + HEADER_H + 2;
    const PANEL_W  = 204;
    const BAR_W   = 192;

    const members: Array<{
      targetPid: string;
      nickname:  string;
      level:     number;
      hp:        number;
      maxHp:     number;
      isAway:    boolean;
    }> = [];
    const inParty = this.gs.myPartyId !== "";

    this.partyHudHeaderBg.clear();
    if (inParty) {
      this.partyHudHeaderBg.fillStyle(0x1a1208, 0.92).fillRect(8, 66, PANEL_W, HEADER_H);
      this.partyHudHeaderBg.lineStyle(1, 0x4a2e15, 0.6).strokeRect(8, 66, PANEL_W, HEADER_H);
    }
    const myPartyName = this.gs.room.state.players.get(this.gs.mySessionId)?.partyName ?? "Party";
    this.partyHudHeaderText
      .setText(`◆ ${myPartyName}`)
      .setVisible(inParty);
    this.partyHudLeaveBtn
      .setText(this.gs.myIsPartyOwner ? "Disband" : "Leave")
      .setVisible(inParty);
    this.partyHudRenameBtn.setVisible(inParty && this.gs.myIsPartyOwner);

    if (inParty) {
      const myState = this.gs.room.state.players.get(this.gs.mySessionId);
      if (myState && myState.partyRoster) {
        try {
          if (myState.partyRoster !== this.cachedRosterJson) {
            this.cachedRosterJson = myState.partyRoster;
            this.cachedRoster = JSON.parse(myState.partyRoster);
          }
          const roster = this.cachedRoster;

          roster.forEach((m) => {
            if (m.sessionId === this.gs.mySessionId) return;

            const liveState = m.sessionId
              ? this.gs.room.state.players.get(m.sessionId) ?? undefined
              : undefined;

            members.push({
              targetPid: m.pid,
              nickname:  m.nickname,
              level:     m.level,
              hp:        liveState ? liveState.hp : m.hp,
              maxHp:     liveState ? liveState.maxHp : m.maxHp,
              isAway:    !liveState,
            });
          });
        } catch (e) {
          console.error("Failed to parse party roster", e);
        }
      }
    }

    for (let i = 0; i < 4; i++) {
      const row = this.partyHudRows[i];
      const y   = START_Y + i * (ROW_H + ROW_GAP);

      row.bg.clear();
      row.hpBar.clear();
      row.xpBar.clear();

      if (i < members.length) {
        const m       = members[i];
        const hpRatio = Math.max(0, Math.min(1, m.hp / m.maxHp));

        row.bg.fillStyle(0x1a1208, 0.92).fillRect(8, y, PANEL_W, ROW_H);
        row.bg.lineStyle(1, 0x4a2e15, 0.5).strokeRect(8, y, PANEL_W, ROW_H);
        row.bg.fillStyle(0x2a0e0e, 1).fillRect(12, y + 20, BAR_W, 8);

        if (m.isAway) {
          row.hpBar.fillStyle(0x4a3a28, 1).fillRect(12, y + 20, BAR_W, 8);
        } else {
          row.hpBar.fillStyle(0xaa2020, 1).fillRect(12, y + 20, Math.floor(BAR_W * hpRatio), 8);
        }

        const nameLabel = m.isAway ? `${m.nickname} (Away)` : m.nickname;
        row.nameText
          .setText(nameLabel)
          .setPosition(14, y + 4)
          .setVisible(true);

        row.kickBtn
          .setData("targetPid", m.targetPid)
          .setVisible(this.gs.myIsPartyOwner);
      } else {
        row.nameText.setVisible(false);
        row.kickBtn.setVisible(false);
      }
    }

    // Refresh remote player label + partyLabel colors every frame
    this.gs.remoteMap.forEach((entity: any, sessionId: string) => {
      const rp = this.gs.room.state.players.get(sessionId);
      if (!rp) return;
      const inPartyColor = this.gs.myPartyId !== "" && rp.partyId === this.gs.myPartyId;
      const color = inPartyColor ? "#c9a227" : "#ffff44";
      entity.label.setColor(color);
      if (entity.partyLabel) entity.partyLabel.setColor(color);
    });
  }

  // ── Leaderboard ─────────────────────────────────────────────────────────────

  createLeaderboard(): void {
    const D = 99990;
    const camW = this.scene.cameras.main.width;
    const lbX = camW - 208;
    const lbY = 216;

    this.leaderboardRows = [];

    this.leaderboardBg = this.scene.add.graphics()
      .fillStyle(0x111111, 0.85)
      .fillRect(0, 0, MINIMAP_SIZE, 120)
      .lineStyle(1, 0x334433, 1)
      .strokeRect(0, 0, MINIMAP_SIZE, 120)
      .setScrollFactor(0)
      .setDepth(D)
      .setPosition(lbX, lbY)
      .setVisible(true);

    this.leaderboardHeader = this.scene.add.text(lbX + MINIMAP_SIZE / 2, lbY + 8, "🏆 Top Players", {
      fontSize: "13px",
      color: "#ffcc44",
      stroke: "#000000",
      strokeThickness: 2,
    })
    .setOrigin(0.5, 0)
    .setScrollFactor(0)
    .setDepth(D + 1)
    .setVisible(true);

    for (let i = 0; i < 5; i++) {
      const row = this.scene.add.text(lbX + 8, lbY + 32 + i * 16, "", {
        fontSize: "11px",
        color: i === 0 ? "#ffcc44" : "#cccccc",
        stroke: "#000000",
        strokeThickness: 1,
      })
      .setScrollFactor(0)
      .setDepth(D + 1)
      .setVisible(true);

      this.leaderboardRows.push(row);
    }
  }

  updateLeaderboard(): void {
    if (this.gs.currentMapName === "waitingArea") return; // quiz map leaderboard stays visible
    if (!this.leaderboardBg || !this.leaderboardBg.active) return;

    const camW = this.scene.cameras.main.width;
    const lbX = camW - 208;
    const lbY = this.gs.minimapOpen ? 216 : 64;

    this.leaderboardBg.setPosition(lbX, lbY);
    this.leaderboardHeader.setPosition(lbX + MINIMAP_SIZE / 2, lbY + 8);

    let top5: Array<{ nickname: string; level: number; xp: number; partyName: string }> = [];
    if (this.gs.globalLeaderboardData && this.gs.globalLeaderboardData.length > 0) {
      top5 = this.gs.globalLeaderboardData.slice(0, 5);
    } else {
      const allPlayers: Array<{ nickname: string; level: number; xp: number; partyName: string }> = [];
      this.gs.room.state.players.forEach((p: any) => {
        if (!p.isDead) {
          allPlayers.push({ nickname: p.nickname, level: p.level, xp: p.xp, partyName: p.partyName });
        }
      });
      top5 = sortLeaderboard(allPlayers).slice(0, 5);
    }

    if (top5.length === 0 && this.leaderboardRows.some(r => r.visible)) {
      return;
    }

    let currentY = lbY + 32;

    for (let i = 0; i < 5; i++) {
      const row = this.leaderboardRows[i];
      if (!row || !row.active) continue;

      if (i < top5.length) {
        row.setPosition(lbX + 8, currentY);
        const p = top5[i];
        const partyTag = p.partyName ? ` [${p.partyName}]` : "";
        const rawContent = `${p.nickname}${partyTag} Lv.${p.level}`;

        let text = `${i + 1}. ${rawContent}`;
        if (rawContent.length > 20) {
          text = `${i + 1}. ${rawContent.slice(0, 20)}\n   ${rawContent.slice(20)}`;
        }

        row.setText(text);
        row.setVisible(true);

        const h = row.height > 0 ? row.height : 18;
        currentY += h + 4;
      } else {
        row.setVisible(false);
      }
    }

    const totalHeight = Math.max(120, (currentY - lbY) + 4);
    if (this.leaderboardBg && this.leaderboardBg.active) {
      this.leaderboardBg.clear();
      this.leaderboardBg.fillStyle(0x111111, 0.85);
      this.leaderboardBg.fillRect(0, 0, MINIMAP_SIZE, totalHeight);
      this.leaderboardBg.lineStyle(1, 0x334433, 1);
      this.leaderboardBg.strokeRect(0, 0, MINIMAP_SIZE, totalHeight);
    }
  }

  // ── Death UI ────────────────────────────────────────────────────────────────

  createDeathUI(): void {
    const w = this.scene.cameras.main.width;
    const h = this.scene.cameras.main.height;

    this.diedOverlay = this.scene.add.rectangle(0, 0, w, h, 0x000000, 0.7)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(100010)
      .setVisible(false);

    this.diedText = this.scene.add.text(w / 2, h / 2 - 50, "YOU DIED", {
      fontSize: "56px",
      color: "#cc0000",
      stroke: "#000000",
      strokeThickness: 6,
      resolution: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(100011)
    .setVisible(false);

    this.countdownText = this.scene.add.text(w / 2, h / 2 + 24, "10", {
      fontSize: "38px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4,
      resolution: 2,
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(100011)
    .setVisible(false);
  }

  onLocalPlayerDied(): void {
    this.localGrave = this.scene.add.image(this.gs.localSprite.x, this.gs.localSprite.y, "grave");
    this.localGrave.setDisplaySize(32, 32);
    this.localGrave.setDepth(this.gs.localSprite.y + 32);

    this.gs.localLabel.setPosition(this.gs.localSprite.x, this.gs.localSprite.y - 42);
    this.gs.localPartyLabel?.setVisible(false);

    this.gs.localSprite.setVisible(false);
    this.gs.localWeapon.setVisible(false);
    this.gs.localSprite.setVelocity(0, 0);
    this.gs.localIsAttacking = false;

    this.diedOverlay?.setVisible(true);
    this.diedText?.setVisible(true);
    this.countdownText?.setText("10").setVisible(true);
    this.gs.localDeathTimer = 10;
  }

  onLocalPlayerRespawned(): void {
    this.localGrave?.destroy();
    this.localGrave = undefined;

    const p = this.gs.room.state.players.get(this.gs.mySessionId);
    if (p) {
      this.gs.localSprite.setPosition(p.x, p.y);
    }

    this.gs.localSprite.setVisible(true);

    this.diedOverlay?.setVisible(false);
    this.diedText?.setVisible(false);
    this.countdownText?.setVisible(false);

    this.gs.localDeathTimer = 0;
  }

  tickDeathTimer(delta: number): void {
    if (!this.gs.localIsDead || this.gs.localDeathTimer <= 0) return;
    this.gs.localDeathTimer -= delta / 1000;
    const secs = Math.max(1, Math.ceil(this.gs.localDeathTimer));
    this.countdownText?.setText(String(secs));

    const w = this.scene.cameras.main.width;
    const h = this.scene.cameras.main.height;
    this.diedOverlay?.setSize(w, h);
    this.diedText?.setPosition(w / 2, h / 2 - 50);
    this.countdownText?.setPosition(w / 2, h / 2 + 24);
  }

  // ── Weapon HUD ──────────────────────────────────────────────────────────────

  createWeaponHUD(): void {
    const D = 99994;
    const R = 32;

    this.weaponHudBg   = this.scene.add.graphics().setScrollFactor(0).setDepth(D);
    this.weaponHudIcon = this.scene.add.image(0, 0, "sword")
      .setScrollFactor(0).setDepth(D + 1);
    {
      const MAX_H = 64;
      const natW  = this.weaponHudIcon.width;
      const natH  = this.weaponHudIcon.height;
      if (natH > MAX_H) {
        this.weaponHudIcon.setDisplaySize(Math.round(natW * MAX_H / natH), MAX_H);
      }
    }
    this.weaponHudOverlay = this.scene.add.graphics().setScrollFactor(0).setDepth(D + 2);
    this.weaponHudBorder  = this.scene.add.graphics().setScrollFactor(0).setDepth(D + 3);

    const { width, height } = this.scene.scale;
    const cx = width  - R - 12;
    const cy = height - R - 12;

    this.weaponHudHitArea = this.scene.add.rectangle(cx, cy, R * 2, R * 2, 0x000000, 0)
      .setScrollFactor(0).setDepth(D + 4)
      .setInteractive({ useHandCursor: true });

    this.weaponHudHitArea.on("pointerover", () => {
      if (this.gs.localAttackCooldownTimer <= 0 && !this.gs.localIsAttacking) {
        this.weaponHudIcon.setTint(0xaaffaa);
      }
    });
    this.weaponHudHitArea.on("pointerout",  () => this.weaponHudIcon.clearTint());
    this.weaponHudHitArea.on("pointerdown", () => {
      this.gs.ignoreNextMapClick = true;
      this.gs.triggerAttack();
    });
  }

  updateWeaponHUD(): void {
    const R  = 32;
    const { width, height } = this.scene.scale;
    const cx = width  - R - 12;
    const cy = height - R - 12;

    this.weaponHudHitArea.setPosition(cx, cy);

    if (this.weaponHudIcon.texture.key !== this.gs.localWeaponKey) {
      this.weaponHudIcon.setTexture(this.gs.localWeaponKey);
      const MAX_H = 64;
      const natW  = this.weaponHudIcon.width;
      const natH  = this.weaponHudIcon.height;
      if (natH > MAX_H) {
        this.weaponHudIcon.setDisplaySize(Math.round(natW * MAX_H / natH), MAX_H);
      } else {
        this.weaponHudIcon.setDisplaySize(natW, natH);
      }
    }
    this.weaponHudIcon.setPosition(cx, cy);

    const progress = Math.min(1, Math.max(0, this.gs.localAttackCooldownTimer) / ATTACK_COOLDOWN_MS);
    const ready    = progress === 0 && !this.gs.localIsAttacking;

    this.weaponHudBg.clear()
      .fillStyle(0x111111, 0.85)
      .fillCircle(cx, cy, R);

    this.weaponHudIcon.setAlpha(ready ? 1 : 0.4);

    this.weaponHudOverlay.clear();
    if (progress > 0.01) {
      const clearedAngle = Math.PI * 2 * (1 - progress);
      const darkStart    = -Math.PI / 2 + clearedAngle;
      const darkEnd      = Math.PI * 3 / 2;
      this.weaponHudOverlay
        .fillStyle(0x000000, 0.72)
        .slice(cx, cy, R - 1, darkStart, darkEnd, false)
        .fillPath();
    }

    const borderColor = ready ? 0xbbaa44 : 0x555544;
    this.weaponHudBorder.clear()
      .lineStyle(2, borderColor, 1)
      .strokeCircle(cx, cy, R);
  }

  // ── Session timer display ────────────────────────────────────────────────────

  createTimerDisplay(): void {
    if (this.isRestrictedMap) return;
    if (this.timerText?.active) return; // already created

    const w = this.scene.cameras.main.width;
    const x = w / 2;
    // GM has a passcode badge at y=10 (~21px tall); push the timer below it
    const y = this.gs.localSkin === "gm" ? 38 : 12;

    this.timerBg = this.scene.add.graphics()
      .fillStyle(0x000000, 0.55)
      .fillRoundedRect(x - 52, y, 104, 28, 6)
      .setScrollFactor(0)
      .setDepth(99997);

    this.timerText = this.scene.add.text(x, y + 14, "00:00", {
      fontFamily: "Cinzel, serif",
      fontSize:   "16px",
      color:      "#c9a227",
    }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(99998);

    this.lastTimerSeconds = -1;
  }

  updateTimerDisplay(secondsLeft: number): void {
    if (!this.timerText?.active) return;
    if (secondsLeft === this.lastTimerSeconds) return;
    this.lastTimerSeconds = secondsLeft;

    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    const label = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    this.timerText.setText(label);

    let color = "#c9a227";
    if (secondsLeft <= 30)  color = "#cc2200";
    else if (secondsLeft <= 120) color = "#ff8800";
    this.timerText.setColor(color);
  }
}
