import Phaser from "phaser";
import { Client } from "colyseus.js";
import { GameSceneData } from "./types";
import {
  MALE_SKINS, FEMALE_SKINS,
  FRAME_W, FRAME_H, SHEET_W, SHEET_H, PREVIEW_ROW,
} from "./skins";

// ── Sprite frame geometry ────────────────────────────────────────────────────

/**
 * Pixel size of one displayed frame.
 * Must match the width/height of .avatar-thumb in index.html.
 */
const THUMB_PX = 80;

// Number of columns and rows in the sprite sheet
const SHEET_COLS = SHEET_W / FRAME_W; // 9
const SHEET_ROWS = SHEET_H / FRAME_H; // 4

/**
 * Scale the entire sprite sheet so that one frame = THUMB_PX × THUMB_PX.
 * This guarantees the full character is visible with no clipping.
 */
const BG_SIZE = `${SHEET_COLS * THUMB_PX}px ${SHEET_ROWS * THUMB_PX}px`;

/** Background-position Y for the preview row (row 2 = walk-down) */
const BG_POS_Y = -(PREVIEW_ROW * THUMB_PX);

// ── LocalStorage keys ────────────────────────────────────────────────────────

const LS_PLAYER_ID   = "playerId";
const LS_RECON_TOKEN = "reconnToken";
const LS_NICKNAME    = "playerNickname";
const LS_SKIN        = "playerSkin";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a persistent random UUID for this browser, creating one if absent. */
function getPersistentId(): string {
  let id = localStorage.getItem(LS_PLAYER_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LS_PLAYER_ID, id);
  }
  return id;
}

// ── HomeScene ────────────────────────────────────────────────────────────────

export class HomeScene extends Phaser.Scene {
  private selectedSkin = MALE_SKINS[0]; // default: male/1lvl
  private activeGender: "male" | "female" = "male";

  constructor() {
    super({ key: "HomeScene" });
  }

  create(): void {
    void this.tryReconnect();
  }

  // ── Reconnection ─────────────────────────────────────────────────────────

  private async tryReconnect(): Promise<void> {
    const token = localStorage.getItem(LS_RECON_TOKEN);

    if (token) {
      this.setReconnecting(true);
      try {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const client   = new Client(`${protocol}://${window.location.host}`);
        // reconnectionToken encodes the roomId — pass it alone
        const room     = await client.reconnect(token);

        // Update token with the fresh one returned after reconnect
        localStorage.setItem(LS_RECON_TOKEN, room.reconnectionToken);

        this.setReconnecting(false);
        const overlay = document.getElementById("overlay");
        if (overlay) overlay.style.display = "none";

        const data: GameSceneData = {
          room,
          nickname: localStorage.getItem(LS_NICKNAME) ?? "Player",
          skin:     localStorage.getItem(LS_SKIN)     ?? MALE_SKINS[0],
        };
        this.scene.start("GameScene", data);
        return;
      } catch {
        // Token expired or room gone — fall through to normal login
        localStorage.removeItem(LS_RECON_TOKEN);
        this.setReconnecting(false);
      }
    }

    this.showOverlay();
  }

  private setReconnecting(active: boolean): void {
    const banner  = document.getElementById("reconnecting-banner");
    const overlay = document.getElementById("overlay");
    if (banner)  banner.style.display  = active ? "flex" : "none";
    if (overlay) overlay.style.display = active ? "none" : "flex";
  }

  // ── Overlay ──────────────────────────────────────────────────────────────

  private showOverlay(): void {
    const overlay = document.getElementById("overlay");
    if (overlay) overlay.style.display = "flex";

    // Pre-fill skin from last session
    const savedSkin = localStorage.getItem(LS_SKIN);
    if (savedSkin) {
      const gender = savedSkin.startsWith("female/") ? "female" : "male";
      this.activeGender = gender;
      this.selectedSkin = savedSkin;
      // Sync the tab button highlight
      document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.gender === gender);
      });
    }

    this.buildAvatarGrid(this.activeGender);
    this.wireTabButtons();
    this.wireJoinButton();

    const input = document.getElementById("nickname") as HTMLInputElement | null;
    if (input) {
      // Pre-fill nickname from last session
      const savedNick = localStorage.getItem(LS_NICKNAME);
      input.value = savedNick ?? "";
      input.focus();
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.joinGame();
      });
    }
  }

  // ── Avatar picker ─────────────────────────────────────────────────────────

  private wireTabButtons(): void {
    document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const gender = btn.dataset.gender as "male" | "female";
        this.activeGender = gender;
        this.buildAvatarGrid(gender);
      });
    });
  }

  /** Rebuild the grid for the given gender and re-apply selection highlight. */
  private buildAvatarGrid(gender: "male" | "female"): void {
    const grid = document.getElementById("avatar-grid");
    if (!grid) return;

    const skins = gender === "male" ? MALE_SKINS : FEMALE_SKINS;

    // If current selection is from the other gender, pick the first of the new gender
    if (!skins.includes(this.selectedSkin)) {
      this.selectedSkin = skins[0];
    }

    grid.innerHTML = "";

    for (const skin of skins) {
      const thumb = document.createElement("div");
      thumb.className = "avatar-thumb";
      thumb.dataset.skin = skin;
      thumb.title = skin.split("/")[1]; // tooltip with variant name

      // Position the correct frame via CSS background
      const [g, variant] = skin.split("/");
      thumb.style.backgroundImage = `url('/assets/player/${g}/${variant}.png')`;
      thumb.style.backgroundSize = BG_SIZE;
      thumb.style.backgroundPosition = `0px ${BG_POS_Y}px`;

      if (skin === this.selectedSkin) thumb.classList.add("selected");

      thumb.addEventListener("click", () => this.selectAvatar(skin));
      grid.appendChild(thumb);
    }
  }

  /** Highlight the chosen avatar and store it. */
  private selectAvatar(skin: string): void {
    this.selectedSkin = skin;

    const grid = document.getElementById("avatar-grid");
    if (!grid) return;

    grid.querySelectorAll<HTMLElement>(".avatar-thumb").forEach((el) => {
      el.classList.toggle("selected", el.dataset.skin === skin);
    });
  }

  // ── Join ──────────────────────────────────────────────────────────────────

  private wireJoinButton(): void {
    const btn = document.getElementById("join-btn") as HTMLButtonElement | null;
    if (!btn) return;
    // Replace node to drop any stale listeners from a previous scene start
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.parentNode?.replaceChild(fresh, btn);
    fresh.addEventListener("click", () => void this.joinGame());
  }

  private async joinGame(): Promise<void> {
    const input   = document.getElementById("nickname") as HTMLInputElement | null;
    const joinBtn = document.getElementById("join-btn") as HTMLButtonElement | null;
    const errorEl = document.getElementById("error-msg");

    const nickname = input?.value.trim() ?? "";
    if (!nickname) { this.showError("Please enter a nickname!"); return; }

    if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = "Connecting…"; }
    if (errorEl) errorEl.style.display = "none";

    try {
      const protocol  = window.location.protocol === "https:" ? "wss" : "ws";
      const serverUrl = `${protocol}://${window.location.host}`;
      const client    = new Client(serverUrl);

      const room = await client.joinOrCreate("game", {
        nickname,
        skin:        this.selectedSkin,
        persistentId: getPersistentId(),
      });

      // Persist session info for reconnection
      localStorage.setItem(LS_RECON_TOKEN, room.reconnectionToken);
      localStorage.setItem(LS_NICKNAME,    nickname);
      localStorage.setItem(LS_SKIN,        this.selectedSkin);

      const overlay = document.getElementById("overlay");
      if (overlay) overlay.style.display = "none";

      const data: GameSceneData = { room, nickname, skin: this.selectedSkin };
      this.scene.start("GameScene", data);
    } catch (err) {
      console.error("Connection error:", err);
      this.showError("Failed to connect — is the server running?");
      if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = "Join Game"; }
    }
  }

  private showError(msg: string): void {
    const el = document.getElementById("error-msg");
    if (el) { el.textContent = msg; el.style.display = "block"; }
  }
}
