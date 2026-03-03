# GEMINI.md

## Project Overview
A real-time multiplayer top-down RPG built with **Colyseus** (Node.js) for the authoritative backend and **Phaser 3** (TypeScript) for the client-side rendering. The game features combat, leveling, gold collection, equipment/shops, and a party system.

### Architecture
-   **`src/server/`**: Authoritative game logic, room management (`GameRoom.ts`), and state synchronization via Colyseus.
-   **`src/client/`**: Phaser 3 scenes, UI components (Action Bar, Equipment, Shop), and client-side systems (MobSystem).
-   **`src/shared/`**: Shared constants, registries (enemies, items, objects), and utility logic (formulas, combat math) used by both client and server.
-   **`public/assets/`**: Game assets including spritesheets, tiles, and map definitions in JSON format.

### Key Technologies
-   **Backend**: Node.js, Colyseus (v0.15), Express.
-   **Frontend**: Phaser 3, esbuild (bundler).
-   **Language**: TypeScript.
-   **Testing**: Vitest.

---

## Building and Running

### Prerequisites
-   Node.js (v20+ recommended)
-   npm

### Key Commands
-   **`npm install`**: Install dependencies.
-   **`npm start`**: Build both client and server, then start the server.
-   **`npm run dev`**: Start development mode with hot-reloading for both client (esbuild watch) and server (nodemon).
-   **`npm run build`**: Build both client (`public/bundle.js`) and server (`dist/`).
-   **`npm test`**: Run unit tests using Vitest.

### Local Development
1.  Run `npm run dev`.
2.  Open `http://localhost:3000` in multiple tabs to test multiplayer interactions.

---

## Development Conventions

### Code Structure
-   **Authoritative Server**: All critical state (HP, XP, Gold, Position validation) must be handled in `GameRoom.ts`.
-   **Shared Registries**: Definitions for enemies, weapons, and static objects should be placed in `src/shared/` to ensure consistency between client and server.
-   **Type Safety**: Use the interfaces defined in `src/client/types.ts` (which often mirror server schemas) for consistency.

### Map & Asset Workflow
-   **Maps**: Located in `public/assets/maps/placement/*.json`. These files define tiles, static objects, NPC positions, and enemy spawn points.
-   **Sprites**: Player sprites follow a specific 4-directional 9-frame walk cycle layout (576x256 total).
-   **Registries**: Adding new items or enemies requires updating the corresponding JSON/TS files in `src/shared/` (e.g., `enemies.ts`, `weapons.ts`).

### Testing
-   Logic that is independent of Phaser or Colyseus should be extracted to `src/client/logic.ts` or `src/shared/` and covered by unit tests in the `tests/` directory.
-   Run `npm test` before committing significant changes to logic or formulas.

### Communication
-   **Messages**: Colyseus messages are used for ephemeral actions (chat, emotes, UI triggers).
-   **State**: Use Colyseus `@type` schema for synchronizing persistent entity data (players, enemies).
