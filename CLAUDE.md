# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm start            # Build all + start server
npm run dev          # Watch mode: rebuild on change + auto-restart server
npm run build        # Build server (tsc) + client (esbuild)
npm run build:server # Compile TypeScript server to dist/
npm run build:client # Bundle client to public/bundle.js
```

Server runs on http://localhost:3000. Open in two browser tabs with different nicknames to test multiplayer.

## Architecture

**Tech stack:** Colyseus (multiplayer) + Phaser 3 (game engine) + TypeScript, served via Express.

**Server** (`src/server/`): Node.js + Express + Colyseus WebSocket room. `GameRoom.ts` holds all authoritative game state via Colyseus `@Schema` decorators. State is broadcast to clients at 20Hz.

**Client** (`src/client/`): Phaser 3 game bundled by esbuild into `public/bundle.js` (never edit this file directly). Two scenes:
- `HomeScene.ts` — avatar/skin picker + nickname input, joins the Colyseus "game" room
- `GameScene.ts` — gameplay loop: local player movement, remote player interpolation (LERP 0.18), collision physics, chat, weapon rendering

**State sync flow:**
1. Client sends messages (`move`, `chat`, `toggle_weapon`, `get_map`) over WebSocket
2. Server validates (e.g., speed clamped to 300px/s, bounds 0–2000), updates `@Schema` state
3. Colyseus automatically diffs and pushes state to all clients
4. `GameScene.ts` applies remote state via `onAdd`/`onChange` listeners with interpolation

**TypeScript compilation:** `tsconfig.json` only compiles `src/server/**/*`. Client code is bundled separately by esbuild (not tsc). Strict mode is enabled.

**Key schema types** (`src/server/GameRoom.ts`):
- `PlayerState`: x, y, nickname, skin, direction (0=down,1=left,2=up,3=right), showWeapon
- `GameState`: MapSchema of sessionId → PlayerState, plus tree layout

**Sprite format:** Player spritesheets are 576×256 (9 cols × 4 rows = 36 frames per sheet, 64×64 per frame). Weapon spritesheet is also 576×256. Skin definitions live in `src/client/skins.ts`.

**Movement:** Client uses WASD/Arrow keys with local prediction; server reconciles. Click-to-move uses A* pathfinding on a 16px nav grid.

**Chat:** Dual-layer — DOM-based global chat panel (5s fade) + Phaser world-space bubbles above players (10s auto-destroy). HTML `<textarea>` overlay captures input to prevent Phaser from intercepting keystrokes.
