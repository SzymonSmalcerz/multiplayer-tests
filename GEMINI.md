# Gemini CLI Context: Multiplayer Top-Down Game

This project is a real-time multiplayer top-down game built with **Colyseus** (backend) and **Phaser 3** (frontend). It features server-authoritative movement, client prediction, enemy AI, and a shared persistent world.

## Project Overview

- **Architecture**: Client-Server using WebSockets (via Colyseus).
- **Backend**: Node.js (Express + Colyseus) written in TypeScript.
    - **Room Logic**: `src/server/GameRoom.ts` manages state, movement validation (speed checks), combat logic, and party systems.
    - **State Sync**: Broadcasts state at 20Hz using Colyseus Schema.
- **Frontend**: Phaser 3 (Arcade Physics) written in TypeScript.
    - **HomeScene**: UI overlay for nickname input and skin selection.
    - **GameScene**: Main game loop, rendering, client-side prediction, and remote player interpolation (LERP).
    - **Pathfinding**: Implements A* on a 16px grid for click-to-move functionality.
- **Assets**: Sprites and tiles are located in `public/assets/`. Player skins follow a specific 576x256 sprite sheet format (9 frames per direction, 4 rows).

## Tech Stack

- **Server**: Colyseus 0.15, Express, TypeScript.
- **Client**: Phaser 3.87, Colyseus.js, esbuild.
- **Tooling**: `nodemon` for server auto-restart, `esbuild` for fast client bundling, `vitest` for testing.

## Building and Running

### Development
Runs the server and client in watch mode with auto-rebuild:
```bash
npm run dev
```

### Production
Builds both server and client, then starts the server:
```bash
npm start
```

### Manual Build Steps
- **Build All**: `npm run build`
- **Server Only**: `npm run build:server` (compiles to `dist/`)
- **Client Only**: `npm run build:client` (bundles to `public/bundle.js`)

## Development Conventions

- **Authoritative Server**: The server (`GameRoom.ts`) is the source of truth for positions and combat. It validates movement messages and clamps positions to world bounds.
- **Client Prediction**: The client moves the local player immediately and sends the position to the server. If the server disagrees significantly (drift), the client reconciles by snapping to the server position.
- **Interpolation**: Remote players and enemies are smoothly moved toward their target position using a LERP factor in `GameScene.ts`.
- **Combat System**: Hits are detected using server-side hitboxes based on player direction and proximity.
- **Depth Sorting (Y-sorting)**: All entities (players, enemies, trees) have their `depth` set based on their `y` coordinate to handle overlapping correctly.
- **Typing**: Shared data structures are defined in `src/client/types.ts` or derived from the Colyseus Schema.

## Key Files
- `src/server/GameRoom.ts`: Server-side state, AI, and message handling.
- `src/client/GameScene.ts`: Main client-side rendering and interaction logic.
- `src/client/skins.ts`: Central registry for player sprite sheets and frame geometry.
- `public/index.html`: Main entry point containing the UI overlay and game container.
