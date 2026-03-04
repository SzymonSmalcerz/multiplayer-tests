# GEMINI.md - Project Context: Wantaja

This file provides high-level architectural context and development guidelines for the **Wantaja** multiplayer RPG project.

## Project Overview
**Wantaja** is a real-time, top-down multiplayer RPG. It follows a **server-authoritative** architecture using **Colyseus** for the backend and **Phaser 3** for the frontend.

- **Purpose:** Fast-paced multiplayer combat, exploration, and progression.
- **Core Technologies:** TypeScript, Node.js, Colyseus, Phaser 3, Express, esbuild, Vitest.
- **Architecture:**
    - **Backend (Server):** Authoritative game loop (20 Hz), state synchronization, physics validation, enemy AI, and persistent player profiles.
    - **Frontend (Client):** High-performance rendering, input handling, client-side movement prediction, and remote player interpolation.
    - **Shared Logic:** Pure, framework-agnostic modules used by both client and server to ensure consistency in formulas (XP, combat, economy).

## Building and Running
The project uses standard npm scripts for development and production.

| Command | Action |
|---|---|
| `npm install` | Install all dependencies. |
| `npm start` | Perform a full build and start the server at `http://localhost:3000`. |
| `npm run dev` | Start development mode with hot-reloading (rebuilds client/server on change). |
| `npm test` | Run all unit tests using Vitest. |
| `npm run build` | Compile the server (`tsc`) and bundle the client (`esbuild`). |
| `npx vitest run tests/<file>.test.ts` | Run a specific test file. |

## Project Structure
- `src/server/`: Colyseus rooms (`GameRoom.ts`), server entry point, and global event bus.
- `src/client/`: Phaser scenes (`GameScene.ts`, `HomeScene.ts`), UI managers, and client-side logic.
- `src/shared/`: **Crucial.** Shared constants, registries (weapons, enemies, objects), and pure functions for combat, economy, and leveling formulas.
- `tests/`: Vitest test suites for shared and client logic.
- `public/`: Static assets (sprites, tiles, sounds) and the bundled `bundle.js`.

## Development Conventions

### 1. Logic Separation
- **Pure Functions:** Business logic (XP calculation, pathfinding, hitbox detection) should be kept in pure functions within `src/shared/` or `src/client/logic.ts` to allow for easy unit testing.
- **HUD/UI:** All in-game HUD elements (bars, panels, rosters) should be managed by `UIManager.ts`, not directly within `GameScene.ts`.

### 2. Single Source of Truth
- Use the **registries** in `src/shared/` (`staticObjects.ts`, `enemies.ts`, `weapons.ts`) to define game entities.
- Shared formulas (like `xpForNextLevel`) must reside in `src/shared/` to prevent desync between client UI and server state.

### 3. Asset Standards
- **Player Sprites:** PNGs in `public/assets/player/` must follow a 36-frame layout (9 frames per direction: Down, Left, Up, Right).
- **Static Objects:** New objects must be added to the registry in `src/shared/staticObjects.ts` with their corresponding collision boxes.

### 4. Testing
- Always add unit tests in `tests/` for new shared logic or utility functions.
- Ensure `npm test` passes before committing significant changes to core game mechanics.

### 5. Scale & Refactoring
- `GameScene.ts` is the heart of the client. If it exceeds ~3,000 lines, consider refactoring specific sub-systems (like specialized UI or complex input logic) into separate managers.

## Key Constants
- **Tick Rate:** 20 Hz (50ms).
- **Map Size:** 2000 × 2000 pixels.
- **Max Player Speed:** 300 px/s (Server enforces 1.6× tolerance).
- **XP Formula:** `floor(100 * 1.1^(level-1))`.
- **Interpolation:** LERP factor 0.18 for remote entities.
