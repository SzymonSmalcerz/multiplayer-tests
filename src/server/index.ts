import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import { createServer } from "http";
import path from "path";
import { GameRoom } from "./GameRoom";

const PORT = Number(process.env.PORT ?? 3000);

// ── HTTP server (serves the Phaser client) ────────────────────────────────────
const app = express();
const httpServer = createServer(app);

// Resolve the public directory relative to the compiled output location
// (dist/server/index.js → ../../public)
const publicDir = path.resolve(__dirname, "../../public");
app.use(express.static(publicDir));

// Catch-all: always serve index.html for unknown routes
app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// ── Colyseus game server ──────────────────────────────────────────────────────
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

// ── Start ─────────────────────────────────────────────────────────────────────
gameServer
  .listen(PORT)
  .then(() => {
    console.log(`Game server running → http://localhost:${PORT}`);
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
