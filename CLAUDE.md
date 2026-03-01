# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm start            # build everything then run server at http://localhost:3000
npm run build        # compile server (tsc → dist/) + bundle client (esbuild → public/bundle.js)
npm run build:server # compile server TypeScript only
npm run build:client # bundle client TypeScript only
npm run dev          # watch-mode: auto-rebuild + auto-restart (uses concurrently)
npm test             # run unit tests with vitest (vitest run)
```

There is no lint script. TypeScript strict mode serves as the primary static check.

To run a single test file: `npx vitest run tests/logic.test.ts`

## Architecture

Real-time multiplayer top-down RPG — server-authoritative Colyseus backend + Phaser 3 browser client.

### Shared (`src/shared/`)
Pure modules with no Phaser or Colyseus dependencies — imported by both client and server.
- **`formulas.ts`** — `xpForNextLevel` (single source of truth, previously duplicated)
- **`combat.ts`** — `getHitbox`, `isInsideHitbox` (melee hit detection geometry)
- **`economy.ts`** — `findNearestPlayers`, `getShareRecipients` (gold/XP distribution)
- **`staticObjects.ts`** — `StaticObjectDef` interface + `STATIC_OBJECT_REGISTRY`: single source of truth for every placeable static object (trees, buildings). Each entry declares `imageWidth`, `imageHeight`, and a collision rectangle in image-local pixel coordinates. Adding a new object type = add one entry here + drop the image in `public/assets/entities/`.

### Server (`src/server/`)
- **`index.ts`** — Express static file server + Colyseus WebSocket server setup
- **`GameRoom.ts`** — All authoritative game logic: player movement validation, enemy AI, combat, XP/leveling, party system, tree placement. Runs a 20 Hz simulation loop (50 ms ticks). State is replicated to all clients via Colyseus schema (`@schema.type` decorators on `MapSchema<PlayerState>` and `MapSchema<EnemyState>`).

### Client (`src/client/`)
- **`main.ts`** — Phaser 3 game config, registers scenes
- **`HomeScene.ts`** — Avatar picker (skin selection) + nickname input UI before joining
- **`GameScene.ts`** — Main game scene: connects to Colyseus room, handles WASD/arrow input, client-side movement prediction, renders and interpolates remote players (LERP factor 0.18), manages animations and combat visuals. **Split threshold: open a refactor issue when this file exceeds ~3 000 lines.**
- **`managers/UIManager.ts`** — All HUD rendering: HP/XP/gold bars, party roster panel, leaderboard, death screen, weapon cooldown HUD. Instantiated as `this.ui` in `GameScene.create()`; GameScene delegates all HUD calls to it.
- **`logic.ts`** — Pure functions extracted for testability: XP formula (re-exported from shared), minimap coordinate transforms, leaderboard sort, A* pathfinding
- **`types.ts`** — Shared TypeScript interfaces
- **`skins.ts`** — Player skin/avatar definitions (7 male × 5 variants, 6 female × 5 variants)
- **`ui/ShopUI.ts`** — Self-contained trader shop panel (extracted from GameScene)

### Tests (`tests/`)
- **`logic.test.ts`** — XP progression, minimap transforms, leaderboard sorting, A* pathfinding
- **`combat.test.ts`** — `getHitbox` all four directions + expand, `isInsideHitbox` boundary cases
- **`economy.test.ts`** — `findNearestPlayers` range/epsilon/tie-break, `getShareRecipients` range/dead-filter
- **`GlobalBus.test.ts`** — Session isolation: party scoping, chat broadcast boundaries, `destroySession` cleanup

### Build output
- `dist/` — compiled server (TypeScript → CommonJS, excluded from git)
- `public/bundle.js` — esbuild-bundled client (excluded from git, do not edit directly)

## Key Game Constants (GameRoom.ts)

| Constant | Value |
|---|---|
| Map size | 2000 × 2000 px |
| Max speed | 300 px/s (server validates with 1.6× tolerance for lag) |
| Tick rate | 20 Hz (50 ms) |
| Max players | 50 per room |
| Enemy count | 10 enemies, respawn after 10 s |
| Tree count | ~150 randomly placed |
| Aggro range | 320 px |
| Party XP share radius | 640 px |
| XP formula | `floor(100 * 1.1^(level-1))` per level |
| Level-up bonuses | +10 max HP, full heal, +0.5 attack damage |

## Network Model

Colyseus handles WebSocket state sync. The server is authoritative: it validates movement, applies physics, and runs enemy AI. The client predicts movement locally and interpolates remote player positions. State patches broadcast at 20 Hz.

## Player Sprites

Each PNG under `public/assets/player/{gender}/` is 576 × 256 px (36 frames, 9 columns × 4 rows):
- Row 0 (frames 0–8): walk down
- Row 1 (frames 9–17): walk left
- Row 2 (frames 18–26): walk up
- Row 3 (frames 27–35): walk right

When adding new game logic that can be expressed as pure functions (no Phaser/Colyseus dependencies):
- If it is needed by **both** client and server → put it in `src/shared/` and add tests in `tests/`.
- If it is client-only → put it in `src/client/logic.ts` and add tests in `tests/logic.test.ts`.
