import Phaser from "phaser";
import { Client } from "colyseus.js";
import { GameSceneData } from "./types";
import {
  MALE_SKINS, FEMALE_SKINS,
  FRAME_W, FRAME_H, SHEET_W, SHEET_H, PREVIEW_ROW,
} from "./skins";

// ── Skin migration ─────────────────────────────────────────────────────────────

/**
 * Converts an old-format skin string (e.g. "male/5lvl_blond", "male/1lvl")
 * to the new hairstyle-identifier format (e.g. "male/blond").
 * New-format strings (no "lvl" in variant) are returned unchanged.
 */
function migrateSkin(stored: string): string {
  const slash = stored.indexOf("/");
  if (slash === -1) return MALE_SKINS[0];
  const gender  = stored.slice(0, slash);
  const variant = stored.slice(slash + 1);

  if (!variant.includes("lvl")) return stored; // already new format

  // "{N}lvl" → default, "{N}lvl_{hairstyle}" → "{gender}/{hairstyle}"
  const match = variant.match(/^\d+lvl_?(\w+)?$/);
  if (!match || !match[1]) return gender === "female" ? FEMALE_SKINS[0] : MALE_SKINS[0];
  return `${gender}/${match[1]}`;
}

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
const LS_PASSCODE    = "roomPasscode";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a persistent random UUID for this browser, creating one if absent. */
function getPersistentId(): string {
  let id = localStorage.getItem(LS_PLAYER_ID);
  if (!id) {
    id = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
        });
    localStorage.setItem(LS_PLAYER_ID, id);
  }
  return id;
}

// ── HomeScene ────────────────────────────────────────────────────────────────

export class HomeScene extends Phaser.Scene {
  private selectedSkin = MALE_SKINS[0]; // default: male/blond
  private activeGender: "male" | "female" = "male";

  /** Passcode confirmed valid in Step 1 — used when submitting Step 2. */
  private confirmedPasscode = "";

  constructor() {
    super({ key: "HomeScene" });
  }

  create(): void {
    void this.tryReconnect();
  }

  // ── Reconnection ─────────────────────────────────────────────────────

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
          passcode: localStorage.getItem(LS_PASSCODE) ?? "",
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

    const regularForm      = document.getElementById("regular-form");
    const gmForm           = document.getElementById("gm-form");
    const roomCreatedPanel = document.getElementById("room-created-panel");
    const isLoginPage      = window.location.pathname === "/login";

    if (isLoginPage) {
      // Show only the GM login form
      if (regularForm)      regularForm.style.display      = "none";
      if (gmForm)           gmForm.style.display           = "block";
      if (roomCreatedPanel) roomCreatedPanel.style.display = "none";
      this.wireGMLoginButton();
      const gmLoginInput = document.getElementById("gm-login") as HTMLInputElement | null;
      if (gmLoginInput) gmLoginInput.focus();
      return;
    }

    // ── Regular player flow ───────────────────────────────────────────────────
    if (regularForm)      regularForm.style.display      = "block";
    if (gmForm)           gmForm.style.display           = "none";
    if (roomCreatedPanel) roomCreatedPanel.style.display = "none";

    // Restore skin preference
    const savedSkin = localStorage.getItem(LS_SKIN);
    if (savedSkin && savedSkin !== "gm") {
      const migrated = migrateSkin(savedSkin);
      if (migrated !== savedSkin) localStorage.setItem(LS_SKIN, migrated);
      const gender = migrated.startsWith("female/") ? "female" : "male";
      this.activeGender = gender;
      this.selectedSkin = migrated;
    }

    // Always start at Step 1. If URL has ?code=XYZ, pre-fill and auto-validate.
    this.showStep(1);

    const passcodeInput = document.getElementById("passcode") as HTMLInputElement | null;
    if (passcodeInput) {
      passcodeInput.addEventListener("input", () => {
        passcodeInput.value = passcodeInput.value.toUpperCase();
      });
      passcodeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.checkCode();
      });
    }

    this.wireCheckCodeButton();

    // Support ?code=ABC123 direct links (e.g. shared by GM)
    const urlCode = new URLSearchParams(window.location.search).get("code");
    if (urlCode && passcodeInput) {
      passcodeInput.value = urlCode.toUpperCase().slice(0, 6);
      void this.checkCode();
    } else if (passcodeInput) {
      passcodeInput.focus();
    }
  }

  // ── GM Login ──────────────────────────────────────────────────────────────

  private wireGMLoginButton(): void {
    const backBtn = document.getElementById("gm-back-btn");
    if (backBtn) {
      const fresh = backBtn.cloneNode(true) as HTMLElement;
      backBtn.parentNode?.replaceChild(fresh, backBtn);
      fresh.addEventListener("click", () => {
        window.location.href = "/";
      });
    }

    const submitBtn = document.getElementById("gm-submit-btn") as HTMLButtonElement | null;
    if (submitBtn) {
      const fresh = submitBtn.cloneNode(true) as HTMLButtonElement;
      submitBtn.parentNode?.replaceChild(fresh, submitBtn);
      fresh.addEventListener("click", () => void this.createGMSession());
    }

    const pwInput = document.getElementById("gm-password") as HTMLInputElement | null;
    if (pwInput) {
      pwInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.createGMSession();
      });
    }
  }

  /** Step 1 of GM flow: call REST to generate a passcode, then show the "Room Created" panel. */
  private async createGMSession(): Promise<void> {
    const loginInput    = document.getElementById("gm-login")     as HTMLInputElement    | null;
    const pwInput       = document.getElementById("gm-password")  as HTMLInputElement    | null;
    const roomNameInput = document.getElementById("gm-room-name") as HTMLInputElement    | null;
    const submitBtn     = document.getElementById("gm-submit-btn") as HTMLButtonElement  | null;
    const errorEl       = document.getElementById("gm-error-msg");

    const login    = loginInput?.value.trim()    ?? "";
    const password = pwInput?.value.trim()       ?? "";
    const roomName = roomNameInput?.value.trim() ?? "";

    if (!login || !password) {
      if (errorEl) { errorEl.textContent = "Please enter login and password."; errorEl.style.display = "block"; }
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Creating…"; }
    if (errorEl)   errorEl.style.display = "none";

    try {
      const resp = await fetch("/api/create-room", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ login, password, roomName }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        const msg = resp.status === 401 ? "Invalid credentials." : (body.error ?? "Server error.");
        if (errorEl) { errorEl.textContent = msg; errorEl.style.display = "block"; }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Create Session"; }
        return;
      }

      const { passcode, name } = await resp.json() as { passcode: string; name: string };

      // Show the room-created panel
      const gmForm           = document.getElementById("gm-form");
      const roomCreatedPanel = document.getElementById("room-created-panel");
      const passcodeDisplay  = document.getElementById("passcode-display");
      const roomNameDisplay  = document.getElementById("room-name-display");

      if (gmForm)           gmForm.style.display           = "none";
      if (roomCreatedPanel) roomCreatedPanel.style.display = "block";
      if (passcodeDisplay)  passcodeDisplay.textContent    = passcode;
      if (roomNameDisplay)  roomNameDisplay.textContent    = name !== "Unnamed Session" ? `"${name}"` : "";

      this.wireEnterWorldButton(login, password, passcode);
    } catch (err) {
      console.error("GM session creation error:", err);
      if (errorEl) { errorEl.textContent = "Connection failed — is the server running?"; errorEl.style.display = "block"; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Create Session"; }
    }
  }

  /** Step 2 of GM flow: join the Colyseus room with the generated passcode. */
  private wireEnterWorldButton(login: string, password: string, passcode: string): void {
    const btn = document.getElementById("enter-world-btn") as HTMLButtonElement | null;
    if (!btn) return;

    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.parentNode?.replaceChild(fresh, btn);

    fresh.addEventListener("click", () => void this.joinAsGM(login, password, passcode));
  }

  private async joinAsGM(login: string, password: string, passcode: string): Promise<void> {
    const btn     = document.getElementById("enter-world-btn") as HTMLButtonElement | null;
    const errorEl = document.getElementById("enter-world-error");

    if (btn)     { btn.disabled = true; btn.textContent = "Connecting…"; }
    if (errorEl) errorEl.style.display = "none";

    try {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const client   = new Client(`${protocol}://${window.location.host}`);

      const room = await client.joinOrCreate("game", {
        login,
        password,
        passcode,
        persistentId: getPersistentId(),
        mapName:      "m1",
      });

      localStorage.setItem(LS_RECON_TOKEN, room.reconnectionToken);
      localStorage.setItem(LS_NICKNAME,    "admin");
      localStorage.setItem(LS_SKIN,        "gm");
      localStorage.setItem(LS_PASSCODE,    passcode);

      // Move away from /login so a page reload reconnects from /
      history.replaceState({}, "", "/");

      const overlay = document.getElementById("overlay");
      if (overlay) overlay.style.display = "none";

      const data: GameSceneData = { room, nickname: "admin", skin: "gm", passcode };
      this.scene.start("GameScene", data);
    } catch (err) {
      console.error("GM join error:", err);
      if (errorEl) { errorEl.textContent = "Connection failed — try again."; errorEl.style.display = "block"; }
      if (btn) { btn.disabled = false; btn.textContent = "Enter World"; }
    }
  }

  // ── Step management ───────────────────────────────────────────────────────

  /** Show step 1 (passcode entry) or step 2 (avatar + nickname). */
  private showStep(step: 1 | 2, sessionName = ""): void {
    const s1 = document.getElementById("step-passcode");
    const s2 = document.getElementById("step-avatar");
    if (step === 1) {
      if (s1) s1.style.display = "block";
      if (s2) s2.style.display = "none";
    } else {
      if (s1) s1.style.display = "none";
      if (s2) s2.style.display = "block";

      // Show session name banner
      const banner = document.getElementById("session-banner");
      if (banner) {
        banner.textContent = sessionName
          ? `Joining: "${sessionName}" — Code: ${this.confirmedPasscode}`
          : `Room code: ${this.confirmedPasscode}`;
      }

      // Build avatar picker + wire nickname now that step 2 is visible
      document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.gender === this.activeGender);
      });
      this.buildAvatarGrid(this.activeGender);
      this.wireTabButtons();
      this.wireJoinButton();
      this.wireChangeCodeButton();

      const nickInput = document.getElementById("nickname") as HTMLInputElement | null;
      if (nickInput) {
        const savedNick = localStorage.getItem(LS_NICKNAME);
        nickInput.value = (savedNick && savedNick !== "admin") ? savedNick : "";
        nickInput.focus();
        nickInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") void this.joinGame();
        });
      }
    }
  }

  // ── Code check ────────────────────────────────────────────────────────────

  private wireCheckCodeButton(): void {
    const btn = document.getElementById("check-code-btn") as HTMLButtonElement | null;
    if (!btn) return;
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.parentNode?.replaceChild(fresh, btn);
    fresh.addEventListener("click", () => void this.checkCode());
  }

  private async checkCode(): Promise<void> {
    const input   = document.getElementById("passcode") as HTMLInputElement | null;
    const btn     = document.getElementById("check-code-btn") as HTMLButtonElement | null;
    const errorEl = document.getElementById("passcode-error");

    const code = (input?.value.trim() ?? "").toUpperCase();

    if (!code) {
      if (errorEl) errorEl.textContent = "Please enter a room code.";
      return;
    }

    if (btn)     { btn.disabled = true; btn.textContent = "Checking…"; }
    if (errorEl) errorEl.textContent = "";

    try {
      const resp = await fetch(`/api/check-session/${encodeURIComponent(code)}`);
      const data = await resp.json() as { valid: boolean; name?: string };

      if (!data.valid) {
        if (errorEl) errorEl.textContent = "Room not found — check the code and try again.";
        if (btn) { btn.disabled = false; btn.textContent = "Check Code"; }
        return;
      }

      this.confirmedPasscode = code;
      this.showStep(2, data.name ?? "");
    } catch {
      if (errorEl) errorEl.textContent = "Connection failed — is the server running?";
      if (btn) { btn.disabled = false; btn.textContent = "Check Code"; }
    }
  }

  private wireChangeCodeButton(): void {
    const btn = document.getElementById("change-code-btn") as HTMLButtonElement | null;
    if (!btn) return;
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.parentNode?.replaceChild(fresh, btn);
    fresh.addEventListener("click", () => {
      this.confirmedPasscode = "";
      const checkBtn = document.getElementById("check-code-btn") as HTMLButtonElement | null;
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = "Check Code"; }
      const errorEl = document.getElementById("passcode-error");
      if (errorEl) errorEl.textContent = "";
      this.showStep(1);
      const passcodeInput = document.getElementById("passcode") as HTMLInputElement | null;
      if (passcodeInput) { passcodeInput.value = ""; passcodeInput.focus(); }
    });
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

      // Position the correct frame via CSS background (use 5lvl sprite as preview)
      const [g, hairstyle] = skin.split("/");
      thumb.style.backgroundImage = `url('/assets/player/${g}/5lvl_${hairstyle}.png')`;
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
    const passcode = this.confirmedPasscode;

    if (!passcode) { this.showError("Room code lost — please go back and re-enter it."); return; }
    if (!nickname) { this.showError("Please enter a nickname!"); return; }

    if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = "Connecting…"; }
    if (errorEl) errorEl.style.display = "none";

    try {
      const protocol  = window.location.protocol === "https:" ? "wss" : "ws";
      const serverUrl = `${protocol}://${window.location.host}`;
      const client    = new Client(serverUrl);

      const room = await client.joinOrCreate("game", {
        nickname,
        skin:         this.selectedSkin,
        persistentId: getPersistentId(),
        mapName:      "m1",
        passcode,
      });

      // Persist session info for reconnection
      localStorage.setItem(LS_RECON_TOKEN, room.reconnectionToken);
      localStorage.setItem(LS_NICKNAME,    nickname);
      localStorage.setItem(LS_SKIN,        this.selectedSkin);
      localStorage.setItem(LS_PASSCODE,    passcode);

      const overlay = document.getElementById("overlay");
      if (overlay) overlay.style.display = "none";

      const data: GameSceneData = { room, nickname, skin: this.selectedSkin, passcode };
      this.scene.start("GameScene", data);
    } catch (err) {
      console.error("Connection error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = msg.includes("Invalid Room Code")
        ? "This session has ended — ask your host to create a new room."
        : "Failed to connect — is the server running?";
      this.showError(friendly);
      if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = "Join Game"; }
    }
  }

  private showError(msg: string): void {
    const el = document.getElementById("error-msg");
    if (el) { el.textContent = msg; el.style.display = "block"; }
  }
}
