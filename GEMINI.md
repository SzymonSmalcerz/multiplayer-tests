# Gemini CLI Context: Multiplayer Top-Down Game

This project is a real-time multiplayer top-down game built with **Colyseus** (backend) and **Phaser 3** (frontend). It features server-authoritative movement, client prediction, and a shared persistent world with obstacles.

## Project Overview

- **Architecture**: Client-Server using WebSockets (via Colyseus).
- **Backend**: Node.js (Express + Colyseus) written in TypeScript.
    - **Room Logic**: `src/server/GameRoom.ts` manages state, movement validation (speed checks), and map data.
    - **State Sync**: Broadcasts state at 20Hz.
- **Frontend**: Phaser 3 (Arcade Physics) written in TypeScript.
    - **HomeScene**: UI overlay for nickname input and skin selection.
    - **GameScene**: Main game loop, rendering, client-side prediction, and remote player interpolation (LERP).
    - **Pathfinding**: Implements A* on a 16px grid for click-to-move functionality.
- **Assets**: Sprites and tiles are located in `public/assets/`. Player skins follow a specific 576x256 sprite sheet format (9 frames per direction).

## Tech Stack

- **Server**: Colyseus 0.15, Express, TypeScript.
- **Client**: Phaser 3.87, Colyseus.js, esbuild.
- **Tooling**: `nodemon` for server auto-restart, `esbuild` for fast client bundling.

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

- **Authoritative Server**: The server (`GameRoom.ts`) is the source of truth for positions. It validates movement messages and clamps positions to world bounds.
- **Client Prediction**: The client moves the local player immediately and sends the position to the server. If the server disagrees significantly (drift/cheat), the client reconciles by snapping to the server position.
- **Interpolation**: Remote players are not snapped; they are smoothly moved toward their target position using a LERP factor in `GameScene.ts`.
- **Typing**: Use the interfaces defined in `src/client/types.ts` for shared data structures between scenes or messages.
- **Physics**: Uses Phaser's Arcade Physics. Collision boxes for players and trees are manually offset to ensure natural depth sorting (Y-sorting).
- **Depth Sorting**: All entities (players, trees) have their `depth` set based on their `y` coordinate (plus half-height) to handle overlapping correctly.

## Key Files
- `src/server/GameRoom.ts`: Server-side state and message handling.
- `src/client/GameScene.ts`: Main client-side rendering and interaction logic.
- `src/client/skins.ts`: Central registry for player sprite sheets and frame geometry.
- `public/index.html`: Main entry point containing the UI overlay and game container.
